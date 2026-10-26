import { type Browser, type BrowserContext, expect, type Page } from "@playwright/test";
import type { Organization } from "./fixtures.js";
import { liveUpdatesConnected } from "./helpers.js";
import { forwardFrom, type StorageState } from "./people.js";

type Level = "instance" | "organization" | "user";
export type SharedLevel = "instance" | "organization";

interface Session {
  context: BrowserContext;
  page: Page;
}

function isLock(value: unknown): value is { locked: boolean } {
  return typeof value === "object" && value !== null && "locked" in value;
}

export async function change(
  page: Page,
  organizationId: string,
  level: Level,
  key: string,
  value: unknown,
): Promise<void> {
  const path =
    level === "user"
      ? `/api/v1/account/preferences/${key}`
      : level === "instance"
        ? `/api/v1/instance/settings/${key}`
        : `/api/v1/organizations/${organizationId}/settings/${key}`;
  const response = await page.request.put(path, {
    data: value === undefined ? { clear: true } : isLock(value) ? value : { value },
    headers: { "X-Lunedo-Request": "1", origin: new URL(page.url()).origin },
  });
  expect(response.status(), `${level} ${key}`).toBeLessThan(300);
}

async function organizationSetting(page: Page, organizationId: string, key: string): Promise<unknown> {
  const response = await page.request.get(`/api/v1/organizations/${organizationId}/settings?limit=200`);
  const { items } = (await response.json()) as { items: { key: string; value: unknown; source: string }[] };
  const entry = items.find((item) => item.key === key);
  return entry?.source === "organization" ? entry.value : undefined;
}

export async function preferences(browser: Browser, storageState: StorageState): Promise<Session> {
  const context = await forwardFrom(await browser.newContext({ storageState }));
  const page = await context.newPage();
  const connected = liveUpdatesConnected(page);
  await page.goto("/settings/preferences");
  await expect(page.getByRole("heading", { name: "Preferences", level: 1 })).toBeVisible();
  await connected;
  return { context, page };
}

async function memberPreferences(organization: Organization): Promise<Session> {
  const session = await organization.signIn(await organization.invite("Max"));
  const connected = liveUpdatesConnected(session.page);
  await session.page.goto("/settings/preferences");
  await expect(session.page.getByRole("heading", { name: "Preferences", level: 1 })).toBeVisible();
  await connected;
  await session.page.getByRole("button", { name: "Customize" }).click();
  return session;
}

function combobox(page: Page, name: string) {
  return page.getByRole("combobox", { name, exact: true });
}

export async function switchesOpenSessions(
  browser: Browser,
  organization: Organization,
  level: SharedLevel,
): Promise<void> {
  const set = (page: Page, at: Level, key: string, value: unknown) =>
    change(page, organization.id, at, key, value);
  const owner = await preferences(browser, organization.adminState);
  await set(owner.page, "user", "locale.language", "en");
  const organizationLanguage = await organizationSetting(owner.page, organization.id, "locale.language");
  if (level === "instance") await set(owner.page, "organization", "locale.language", undefined);
  const member = await memberPreferences(organization);
  try {
    await set(owner.page, level, "locale.language", "de");
    await expect(
      member.page.getByRole("heading", { name: "Darstellung und Sprache", level: 1 }),
    ).toBeVisible();
    await expect(member.page.locator("html")).toHaveAttribute("lang", "de");
    await expect(member.page.getByRole("navigation", { name: "Einstellungen" })).toBeVisible();
    await expect(owner.page.getByRole("heading", { name: "Preferences", level: 1 })).toBeVisible();
    await expect(owner.page.locator("html")).toHaveAttribute("lang", "en");

    await set(owner.page, level, "locale.language", undefined);
    await expect(member.page.getByRole("heading", { name: "Preferences", level: 1 })).toBeVisible();
  } finally {
    await set(owner.page, level, "locale.language", undefined);
    await set(owner.page, "user", "locale.language", undefined);
    await set(owner.page, "organization", "locale.language", organizationLanguage);
    await member.context.close();
    await owner.context.close();
  }
}

export async function appliesLockedValues(
  browser: Browser,
  organization: Organization,
  level: SharedLevel,
): Promise<void> {
  const set = (page: Page, at: Level, key: string, value: unknown) =>
    change(page, organization.id, at, key, value);
  const owner = await preferences(browser, organization.adminState);
  const member = await memberPreferences(organization);
  try {
    await set(owner.page, "user", "locale.language", "en");
    await set(member.page, "user", "locale.language", "en");
    await set(member.page, "user", "locale.timeZone", "Europe/Vienna");
    await set(owner.page, level, "locale.language", "de");
    await set(owner.page, level, "locale.timeZone", "Pacific/Auckland");
    await expect(member.page.getByRole("heading", { name: "Preferences", level: 1 })).toBeVisible();

    await set(owner.page, level, "locale.language", { locked: true });
    await set(owner.page, level, "locale.timeZone", { locked: true });
    await expect(
      member.page.getByRole("heading", { name: "Darstellung und Sprache", level: 1 }),
    ).toBeVisible();
    await expect(combobox(member.page, "Zeitzone")).toHaveValue(/Auckland/);
    await expect(
      owner.page.getByRole("heading", { name: "Darstellung und Sprache", level: 1 }),
    ).toBeVisible();

    await set(owner.page, level, "locale.language", "en");
    await expect(member.page.getByRole("heading", { name: "Preferences", level: 1 })).toBeVisible();
    await set(owner.page, level, "locale.language", "de");
    await expect(
      member.page.getByRole("heading", { name: "Darstellung und Sprache", level: 1 }),
    ).toBeVisible();
  } finally {
    for (const key of ["locale.language", "locale.timeZone"]) {
      await set(owner.page, level, key, { locked: false });
      await set(owner.page, level, key, undefined);
      await set(member.page, "user", key, undefined);
    }
    await set(owner.page, "user", "locale.language", undefined);
    await member.context.close();
    await owner.context.close();
  }
}

const FORMATS: { key: string; field: string; choices: [string, RegExp][] }[] = [
  {
    key: "locale.dateFormat",
    field: "Date format",
    choices: [
      ["YYYY-MM-DD", /\d{4}-\d{2}-\d{2}/],
      ["DD.MM.YYYY", /\d{2}\.\d{2}\.\d{4}/],
    ],
  },
  {
    key: "locale.timeFormat",
    field: "Time format",
    choices: [
      ["24h", /^14:30$/],
      ["12h", /2:30\s?PM/],
    ],
  },
  {
    key: "locale.numberFormat",
    field: "Number format",
    choices: [
      ["de-CH", /1'234'567/],
      ["fr-FR", /567,89/],
    ],
  },
  {
    key: "locale.firstDayOfWeek",
    field: "First day of the week",
    choices: [
      ["saturday", /Saturday/],
      ["sunday", /Sunday/],
    ],
  },
  {
    key: "locale.timeZone",
    field: "Time zone",
    choices: [
      ["Pacific/Auckland", /Auckland/],
      ["Asia/Tokyo", /Tokyo/],
    ],
  },
];

export async function appliesFormats(browser: Browser, organization: Organization): Promise<void> {
  const set = (page: Page, key: string, value: unknown) =>
    change(page, organization.id, "organization", key, value);
  const owner = await preferences(browser, organization.adminState);
  const organizationValues = new Map<string, unknown>();
  for (const format of FORMATS) {
    organizationValues.set(format.key, await organizationSetting(owner.page, organization.id, format.key));
  }
  const member = await memberPreferences(organization);
  try {
    for (const format of FORMATS) {
      const control = combobox(member.page, format.field);
      const shown =
        (await control.evaluate((element) =>
          element instanceof HTMLInputElement ? element.value : (element.textContent ?? ""),
        )) ?? "";
      const [value, expected] = format.choices.find(([, pattern]) => !pattern.test(shown)) ?? [];
      await set(owner.page, format.key, value);
      await expect
        .poll(
          () =>
            control.evaluate((element) =>
              element instanceof HTMLInputElement ? element.value : (element.textContent ?? ""),
            ),
          { message: format.key },
        )
        .toMatch(expected ?? /.^/);
    }
  } finally {
    for (const format of FORMATS) await set(owner.page, format.key, organizationValues.get(format.key));
    await member.context.close();
    await owner.context.close();
  }
}

export async function appliesAccentColor(browser: Browser, organization: Organization): Promise<void> {
  const owner = await preferences(browser, organization.adminState);
  const member = await memberPreferences(organization);
  try {
    await change(owner.page, organization.id, "instance", "branding.accentColor", "violet");
    await expect(member.page.locator("html")).toHaveAttribute("data-accent", "violet");
  } finally {
    await change(owner.page, organization.id, "instance", "branding.accentColor", undefined);
    await member.context.close();
    await owner.context.close();
  }
}
