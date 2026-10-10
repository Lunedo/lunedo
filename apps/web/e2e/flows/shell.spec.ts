import { expect, test } from "../support/fixtures.js";
import {
  callApi,
  expectAccessible,
  freshTotp,
  setAppearance,
  signInWithPassword,
} from "../support/helpers.js";
import { addAuthenticator, forwardFrom, SIGNED_OUT } from "../support/people.js";

test.use({ instanceAdministrator: true });

test("delivers a notification live to an open page", async ({ page, browser, organization }) => {
  const { secret } = await addAuthenticator(browser, organization.adminState);
  await page.goto("/settings/preferences");
  await callApi(page, "POST", "/api/v1/notifications/read-all", {});
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
  const before = await page.getByRole("button", { name: /^Notifications/ }).getAttribute("aria-label");

  const elsewhere = await forwardFrom(
    await browser.newContext({
      storageState: SIGNED_OUT,
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0",
    }),
  );
  const other = await elsewhere.newPage();
  await other.goto("/sign-in");
  await signInWithPassword(other, organization.admin.email, organization.admin.password);
  await other.getByLabel("Code from your authenticator app").fill(await freshTotp(secret));
  await other.getByRole("button", { name: "Verify" }).click();
  await expect(other.getByRole("heading", { name: "For you", level: 1 })).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Security", level: 1 })).toBeVisible();

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
  const textSize = page.getByRole("group", { name: "Text size" });
  await textSize.getByRole("button", { name: "Increase" }).click();
  await expect(textSize.getByText("112.5%")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--ph-text-scale").trim(),
      ),
    )
    .toBe("1.125");
  await textSize.getByRole("button", { name: "Default" }).click();
  await expect(textSize.getByText("100%")).toBeVisible();
  await expect(textSize.getByRole("button", { name: "Default" })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Language" }).click();
  await page.getByRole("option", { name: "Deutsch" }).click();
  await expect(page.getByRole("heading", { name: "Darstellung und Sprache" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await page.getByRole("combobox", { name: "Sprache" }).click();
  await page.getByRole("option", { name: /Standard/ }).click();
  await expect(page.getByRole("heading", { name: "Preferences" })).toBeVisible();
  await setAppearance(page, { colorMode: "light", textSize: 1 });
});

test("keeps long German labels inside the layout at desktop width", async ({ page, organization }) => {
  await page.goto("/settings/preferences");
  await setAppearance(page, { language: "de", textSize: 1.25 });
  await page.setViewportSize({ width: 1280, height: 900 });
  const organizationId = organization.id;
  for (const path of [
    "/settings/preferences",
    `/settings/organizations/${organizationId}/general`,
    `/settings/organizations/${organizationId}/security`,
    "/settings/instance/security",
  ]) {
    await page.goto(path);
    await expect(page.locator("#main h1")).toBeVisible();
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll("#main button, #main label, #main h1, #main h2, nav a")]
        .filter((element) => {
          const style = getComputedStyle(element);
          return (
            style.textOverflow !== "ellipsis" &&
            style.overflow !== "visible" &&
            element.scrollWidth > element.clientWidth + 1
          );
        })
        .map((element) => element.textContent?.trim()),
    );
    expect(clipped, path).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
  await setAppearance(page, { language: "en", textSize: 1 });
});
