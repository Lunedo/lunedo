import { expect, test } from "@playwright/test";
import { OWNER, OWNER_STORAGE, readState } from "../support/environment.js";
import { expectAccessible, freshTotp, setAppearance } from "../support/helpers.js";

test.describe.configure({ mode: "serial" });
test.use({ storageState: OWNER_STORAGE });

test("delivers a notification live to an open page", async ({ page, browser }) => {
  await page.goto("/settings/preferences");
  await expect(page.getByRole("button", { name: /^Notifications/ })).toBeVisible();
  const before = await page.getByRole("button", { name: /^Notifications/ }).getAttribute("aria-label");

  const elsewhere = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0",
  });
  const other = await elsewhere.newPage();
  await other.goto("/sign-in");
  await other.getByLabel("E-mail").fill(OWNER.email);
  await other.getByLabel("Password", { exact: true }).fill(OWNER.password);
  await other.getByRole("button", { name: "Sign in", exact: true }).click();
  await other
    .getByLabel("Code from your authenticator app")
    .fill(await freshTotp(readState().ownerSecret ?? ""));
  await other.getByRole("button", { name: "Verify" }).click();
  await expect(other.getByRole("heading", { name: "Preferences" })).toBeVisible();
  await elsewhere.close();

  await expect(page.getByRole("button", { name: /Notifications, \d+ unread/ })).toBeVisible({
    timeout: 20_000,
  });
  expect(await page.getByRole("button", { name: /^Notifications/ }).getAttribute("aria-label")).not.toBe(
    before,
  );
  await page.getByRole("button", { name: /Notifications, \d+ unread/ }).click();
  const panel = page.getByRole("complementary", { name: "Notifications" });
  await expect(panel.getByRole("listitem").first()).toBeVisible();
  await expectAccessible(page, "notification panel");
  await panel.getByRole("button", { name: "Mark all as read" }).click();
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
});

test("opens the command palette with the keyboard and navigates", async ({ page }) => {
  await page.goto("/settings/preferences");
  await expect(page.locator("#main h1")).toBeVisible();
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await page.keyboard.type("Security");
  await page.keyboard.press("Enter");
  await expect(palette).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Security" })).toBeVisible();

  await page.keyboard.press("Control+k");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Command palette" })).toHaveCount(0);
});

test("lists keyboard shortcuts and moves between screens with them", async ({ page }) => {
  await page.goto("/settings/security");
  await expect(page.locator("#main h1")).toBeVisible();
  await page.locator("body").press("?");
  const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Open the command palette")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.locator("body").press("g");
  await page.locator("body").press("p");
  await expect(page.getByRole("heading", { name: "Preferences" })).toBeVisible();
});

test("reaches the content with the skip link and keeps focus inside dialogs", async ({ page }) => {
  await page.goto("/settings/security");
  await expect(page.locator("#main h1")).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();

  const trigger = page.getByRole("button", { name: "Change password" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Change password" });
  await expect(dialog).toBeVisible();
  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("switches language, color mode and text size immediately", async ({ page }) => {
  await page.goto("/settings/preferences");
  await page
    .getByRole("radio", { name: "Dark" })
    .or(page.getByRole("button", { name: "Dark" }))
    .first()
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("combobox", { name: "Language" }).click();
  await page.getByRole("option", { name: "Deutsch" }).click();
  await expect(page.getByRole("heading", { name: "Darstellung und Sprache" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await page.getByRole("combobox", { name: "Sprache" }).click();
  await page.getByRole("option", { name: "Standard verwenden" }).click();
  await expect(page.getByRole("heading", { name: "Preferences" })).toBeVisible();
  await setAppearance(page, { colorMode: "light", textSize: 1 });
});

for (const appearance of [
  { name: "light", colorMode: "light" as const, highContrast: false, textSize: 1 },
  { name: "dark", colorMode: "dark" as const, highContrast: false, textSize: 1 },
  { name: "high contrast", colorMode: "light" as const, highContrast: true, textSize: 1 },
  { name: "smallest text", colorMode: "light" as const, highContrast: false, textSize: 0.875 },
  { name: "largest text", colorMode: "dark" as const, highContrast: true, textSize: 1.25 },
]) {
  test(`has no accessibility violations in ${appearance.name}`, async ({ page }) => {
    await page.goto("/settings/preferences");
    await setAppearance(page, appearance);
    for (const path of ["/settings/preferences", "/settings/security", "/settings/notifications"]) {
      await page.goto(path);
      await expect(page.locator("#main h1")).toBeVisible();
      await expectAccessible(page, `${path} in ${appearance.name}`);
    }
    const organizationId = readState().organizationId;
    for (const screen of ["members", "groups", "roles", "security", "audit-log"]) {
      await page.goto(`/settings/organizations/${organizationId}/${screen}`);
      await expect(page.locator("#main h1")).toBeVisible();
      await expectAccessible(page, `${screen} in ${appearance.name}`);
    }
    for (const screen of ["general", "organizations", "mail", "break-glass"]) {
      await page.goto(`/settings/instance/${screen}`);
      await expect(page.locator("#main h1")).toBeVisible();
      await expectAccessible(page, `instance ${screen} in ${appearance.name}`);
    }
    await setAppearance(page, { colorMode: "light", highContrast: false, textSize: 1 });
  });
}

test("works on a phone without horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  const organizationId = readState().organizationId;
  for (const path of [
    "/settings/preferences",
    "/settings/security",
    `/settings/organizations/${organizationId}/members`,
  ]) {
    await page.goto(path);
    await expect(page.locator("#main h1")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Settings section" })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
