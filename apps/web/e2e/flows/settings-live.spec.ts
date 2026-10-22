import { expect, test } from "../support/fixtures.js";
import {
  appliesFormats,
  appliesLockedValues,
  change,
  preferences,
  switchesOpenSessions,
} from "../support/live-settings.js";

test("switches the whole interface at once when the own language changes", async ({
  browser,
  organization,
}) => {
  const { context, page } = await preferences(browser, organization.adminState);
  const settings = page.getByRole("navigation", { name: "Settings" });
  await expect(settings.getByRole("link", { name: "Security" }).first()).toBeVisible();
  const englishDate = await page.getByRole("combobox", { name: "Date format", exact: true }).textContent();
  await expect(page.getByRole("group", { name: "Text size" })).toContainText("100%");

  await page.getByRole("combobox", { name: "Language", exact: true }).click();
  await page.getByRole("option", { name: "Deutsch" }).click();

  await expect(page.getByRole("heading", { name: "Darstellung und Sprache", level: 1 })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Einstellungen" }).getByRole("link", { name: "Sicherheit" }).first(),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "Textgröße" })).toContainText(/100\s%/);
  const sample = /\d{2}[./-]\d{2}[./-]\d{4}/.exec(englishDate ?? "")?.[0] ?? "missing";
  await expect(page.getByRole("combobox", { name: "Datumsformat", exact: true })).toContainText(sample);
  await expect(page.locator("html")).toHaveAttribute("lang", "de");

  await page.getByRole("combobox", { name: "Sprache", exact: true }).click();
  await page.getByRole("option", { name: /Standard/ }).click();
  await expect(page.getByRole("heading", { name: "Preferences", level: 1 })).toBeVisible();
  await expect(settings.getByRole("link", { name: "Security" }).first()).toBeVisible();
  await context.close();
});

test("switches open sessions when the organization language changes", async ({ browser, organization }) => {
  await switchesOpenSessions(browser, organization, "organization");
});

test("applies a locked organization language and time zone to people with their own values", async ({
  browser,
  organization,
}) => {
  await appliesLockedValues(browser, organization, "organization");
});

test("applies organization formats, time zone and accent color to open sessions", async ({
  browser,
  organization,
}) => {
  await appliesFormats(browser, organization, "organization");
});

test("applies appearance changes to the other open sessions of the same person", async ({
  browser,
  organization,
}) => {
  const first = await preferences(browser, organization.adminState);
  const second = await preferences(browser, organization.adminState);
  const set = (key: string, value: unknown) => change(first.page, organization.id, "user", key, value);
  const html = second.page.locator("html");
  try {
    await set("appearance.colorMode", "dark");
    await expect(html).toHaveAttribute("data-theme", "dark");
    await set("appearance.highContrast", true);
    await expect(html).toHaveAttribute("data-contrast", "high");
    await set("appearance.density", "compact");
    await expect(html).toHaveAttribute("data-density", "compact");
    await set("appearance.font", "readable");
    await expect(html).toHaveAttribute("data-font", "readable");
    await set("appearance.textSize", 1.125);
    await expect
      .poll(() =>
        second.page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue("--ld-text-scale").trim(),
        ),
      )
      .toBe("1.125");
    await set("locale.language", "de");
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
      await set(key, undefined);
    }
    await first.context.close();
    await second.context.close();
  }
});
