import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import { OWNER_STORAGE, readState } from "../support/environment.js";

test.describe.configure({ mode: "serial" });

type Level = "instance" | "organization" | "user";

function isLock(value: unknown): value is { locked: boolean } {
  return typeof value === "object" && value !== null && "locked" in value;
}

async function change(page: Page, level: Level, key: string, value: unknown): Promise<void> {
  const organizationId = readState().organizationId ?? "";
  const path =
    level === "user"
      ? `/api/v1/account/preferences/${key}`
      : level === "instance"
        ? `/api/v1/instance/settings/${key}`
        : `/api/v1/organizations/${organizationId}/settings/${key}`;
  const response = await page.request.put(path, {
    data: value === undefined ? { clear: true } : isLock(value) ? value : { value },
    headers: { "X-Pagehall-Request": "1", origin: new URL(page.url()).origin },
  });
  expect(response.status(), `${level} ${key}`).toBeLessThan(300);
}

async function setting(page: Page, level: "organization", key: string): Promise<unknown> {
  const organizationId = readState().organizationId ?? "";
  const response = await page.request.get(`/api/v1/organizations/${organizationId}/settings?limit=200`);
  const { items } = (await response.json()) as { items: { key: string; value: unknown; source: string }[] };
  const entry = items.find((item) => item.key === key);
  return entry?.source === level ? entry.value : undefined;
}

async function ownerPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ storageState: OWNER_STORAGE });
  const page = await context.newPage();
  await page.goto("/settings/preferences");
  await expect(page.getByRole("heading", { name: "Preferences", level: 1 })).toBeVisible();
  return { context, page };
}

async function memberPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const { memberEmail, memberPassword } = readState();
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await page.getByLabel("E-mail").fill(memberEmail ?? "");
  await page.getByLabel("Password", { exact: true }).fill(memberPassword ?? "");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Preferences", level: 1 })).toBeVisible();
  return { context, page };
}

function combobox(page: Page, name: string) {
  return page.getByRole("combobox", { name, exact: true });
}

test("switches the whole interface at once when the own language changes", async ({ browser }) => {
  const { context, page } = await ownerPage(browser);
  const settings = page.getByRole("navigation", { name: "Settings" });
  await expect(settings.getByRole("link", { name: "Security" }).first()).toBeVisible();
  const englishDate = await combobox(page, "Date format").textContent();
  await expect(page.getByRole("group", { name: "Text size" })).toContainText("100%");

  await combobox(page, "Language").click();
  await page.getByRole("option", { name: "Deutsch" }).click();

  await expect(page.getByRole("heading", { name: "Darstellung und Sprache", level: 1 })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Einstellungen" }).getByRole("link", { name: "Sicherheit" }).first(),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "Textgröße" })).toContainText(/100\s%/);
  await expect(combobox(page, "Datumsformat")).not.toHaveText(englishDate ?? "");
  await expect(combobox(page, "Datumsformat")).toContainText(/Automatisch/);
  await expect(page.locator("html")).toHaveAttribute("lang", "de");

  await combobox(page, "Sprache").click();
  await page.getByRole("option", { name: /^Standard:/ }).click();
  await expect(page.getByRole("heading", { name: "Preferences", level: 1 })).toBeVisible();
  await expect(settings.getByRole("link", { name: "Security" }).first()).toBeVisible();
  await context.close();
});

for (const level of ["instance", "organization"] as const) {
  test(`switches open sessions when the ${level} language changes`, async ({ browser }) => {
    const owner = await ownerPage(browser);
    await change(owner.page, "user", "locale.language", "en");
    const organizationLanguage = await setting(owner.page, "organization", "locale.language");
    if (level === "instance") await change(owner.page, "organization", "locale.language", undefined);
    const member = await memberPage(browser);
    try {
      await change(owner.page, level, "locale.language", "de");
      await expect(
        member.page.getByRole("heading", { name: "Darstellung und Sprache", level: 1 }),
      ).toBeVisible();
      await expect(member.page.locator("html")).toHaveAttribute("lang", "de");
      await expect(member.page.getByRole("navigation", { name: "Einstellungen" })).toBeVisible();
      await expect(owner.page.getByRole("heading", { name: "Preferences", level: 1 })).toBeVisible();
      await expect(owner.page.locator("html")).toHaveAttribute("lang", "en");

      await change(owner.page, level, "locale.language", undefined);
      await expect(member.page.getByRole("heading", { name: "Preferences", level: 1 })).toBeVisible();
    } finally {
      await change(owner.page, level, "locale.language", undefined);
      await change(owner.page, "user", "locale.language", undefined);
      await change(owner.page, "organization", "locale.language", organizationLanguage);
      await member.context.close();
      await owner.context.close();
    }
  });
}

for (const level of ["instance", "organization"] as const) {
  test(`applies a locked ${level} language and time zone to people with their own values`, async ({
    browser,
  }) => {
    const owner = await ownerPage(browser);
    const member = await memberPage(browser);
    try {
      await change(owner.page, "user", "locale.language", "en");
      await change(member.page, "user", "locale.language", "en");
      await change(member.page, "user", "locale.timeZone", "Europe/Vienna");
      await change(owner.page, level, "locale.language", "de");
      await change(owner.page, level, "locale.timeZone", "Pacific/Auckland");
      await expect(member.page.getByRole("heading", { name: "Preferences", level: 1 })).toBeVisible();

      await change(owner.page, level, "locale.language", { locked: true });
      await change(owner.page, level, "locale.timeZone", { locked: true });
      await expect(
        member.page.getByRole("heading", { name: "Darstellung und Sprache", level: 1 }),
      ).toBeVisible();
      await expect(combobox(member.page, "Zeitzone")).toContainText(/Auckland/);
      await expect(
        owner.page.getByRole("heading", { name: "Darstellung und Sprache", level: 1 }),
      ).toBeVisible();

      await change(owner.page, level, "locale.language", "en");
      await expect(member.page.getByRole("heading", { name: "Preferences", level: 1 })).toBeVisible();
      await change(owner.page, level, "locale.language", "de");
      await expect(
        member.page.getByRole("heading", { name: "Darstellung und Sprache", level: 1 }),
      ).toBeVisible();
    } finally {
      for (const key of ["locale.language", "locale.timeZone"]) {
        await change(owner.page, level, key, { locked: false });
        await change(owner.page, level, key, undefined);
        await change(member.page, "user", key, undefined);
      }
      await change(owner.page, "user", "locale.language", undefined);
      await member.context.close();
      await owner.context.close();
    }
  });
}

const FORMATS = [
  { key: "locale.dateFormat", value: "YYYY-MM-DD", field: "Date format", expected: /\d{4}-\d{2}-\d{2}/ },
  { key: "locale.timeFormat", value: "12h", field: "Time format", expected: /AM|PM/ },
  { key: "locale.numberFormat", value: "de-CH", field: "Number format", expected: /1'234'567/ },
  { key: "locale.firstDayOfWeek", value: "saturday", field: "First day of the week", expected: /Saturday/ },
  { key: "locale.timeZone", value: "Pacific/Auckland", field: "Time zone", expected: /Auckland/ },
];

for (const level of ["instance", "organization"] as const) {
  test(`applies ${level} formats, time zone and accent color to open sessions`, async ({ browser }) => {
    const owner = await ownerPage(browser);
    const member = await memberPage(browser);
    try {
      for (const format of FORMATS) {
        await expect(combobox(member.page, format.field)).not.toContainText(format.expected);
        await change(owner.page, level, format.key, format.value);
        await expect(combobox(member.page, format.field), format.key).toContainText(format.expected);
      }
      await change(owner.page, level, "branding.accentColor", "violet");
      await expect(member.page.locator("html")).toHaveAttribute("data-accent", "violet");
    } finally {
      for (const format of FORMATS) await change(owner.page, level, format.key, undefined);
      await change(owner.page, level, "branding.accentColor", undefined);
      await member.context.close();
      await owner.context.close();
    }
  });
}

test("applies appearance changes to the other open sessions of the same person", async ({ browser }) => {
  const first = await ownerPage(browser);
  const second = await ownerPage(browser);
  const html = second.page.locator("html");
  try {
    await change(first.page, "user", "appearance.colorMode", "dark");
    await expect(html).toHaveAttribute("data-theme", "dark");
    await change(first.page, "user", "appearance.highContrast", true);
    await expect(html).toHaveAttribute("data-contrast", "high");
    await change(first.page, "user", "appearance.density", "compact");
    await expect(html).toHaveAttribute("data-density", "compact");
    await change(first.page, "user", "appearance.font", "readable");
    await expect(html).toHaveAttribute("data-font", "readable");
    await change(first.page, "user", "appearance.textSize", 1.125);
    await expect
      .poll(() =>
        second.page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue("--ph-text-scale").trim(),
        ),
      )
      .toBe("1.125");
    await change(first.page, "user", "locale.language", "de");
    await expect(
      second.page.getByRole("heading", { name: "Darstellung und Sprache", level: 1 }),
    ).toBeVisible();
  } finally {
    for (const key of [
      "appearance.colorMode",
      "appearance.highContrast",
      "appearance.density",
      "appearance.font",
      "appearance.textSize",
      "locale.language",
    ]) {
      await change(first.page, "user", key, undefined);
    }
    await first.context.close();
    await second.context.close();
  }
});
