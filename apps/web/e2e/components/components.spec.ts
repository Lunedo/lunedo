import { expect, test } from "@playwright/test";
import { expectAccessible } from "../support/helpers.js";

const VARIANTS = [
  { name: "light", query: "mode=light" },
  { name: "dark", query: "mode=dark" },
  { name: "light-high-contrast", query: "mode=light&contrast=high" },
  { name: "dark-high-contrast", query: "mode=dark&contrast=high" },
  { name: "light-small-compact", query: "mode=light&size=0.875&density=compact" },
  { name: "dark-large", query: "mode=dark&size=1.25" },
  { name: "light-accent-violet", query: "mode=light&accent=violet" },
  { name: "light-de", query: "mode=light&lang=de" },
  { name: "dark-de", query: "mode=dark&lang=de" },
  { name: "light-large-de", query: "mode=light&size=1.25&lang=de" },
];

for (const variant of VARIANTS) {
  test(`components in ${variant.name} are accessible`, async ({ page }) => {
    await page.goto(`/dev/components?${variant.query}`);
    await expect(page.getByRole("main")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expectAccessible(page, variant.name);
  });

  test(`components in ${variant.name} look as before`, async ({ page }) => {
    test.skip(process.platform !== "linux", "Screenshots are compared on Linux, where they were recorded");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/dev/components?${variant.query}`);
    await expect(page.getByRole("main")).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot(`${variant.name}.png`, { fullPage: true });
  });
}

test("the password toggle sits inside its field with a 44 pixel hit area", async ({ page }) => {
  await page.goto("/dev/components?mode=light");
  const field = page.locator("[data-password-field]").first();
  const input = field.locator("input");
  const toggle = field.getByRole("button", { name: "Show password" });
  const inputBox = await input.boundingBox();
  const toggleBox = await toggle.boundingBox();
  if (!inputBox || !toggleBox) throw new Error("The password field is not visible");
  expect(toggleBox.y).toBeGreaterThanOrEqual(inputBox.y);
  expect(toggleBox.y + toggleBox.height).toBeLessThanOrEqual(inputBox.y + inputBox.height);
  expect(toggleBox.x + toggleBox.width).toBeLessThanOrEqual(inputBox.x + inputBox.width);
  const hit = await toggle.evaluate((element) => {
    const after = getComputedStyle(element, "::after");
    return { width: Number.parseFloat(after.width), height: Number.parseFloat(after.height) };
  });
  expect(hit.width).toBeGreaterThanOrEqual(44);
  expect(hit.height).toBeGreaterThanOrEqual(44);
});

for (const { width, edge } of [
  { width: 1280, edge: "bottom right" },
  { width: 390, edge: "top" },
]) {
  test(`toasts appear at the ${edge} at ${width} pixels`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/dev/components?mode=light");
    await page.getByRole("button", { name: "Show toast" }).click();
    const toast = page.locator("li[data-variant]").filter({ hasText: "Token created" });
    await expect(toast).toBeVisible();
    const box = await toast.boundingBox();
    if (!box) throw new Error("The toast is not visible");
    if (width === 1280) {
      expect(box.x + box.width).toBeGreaterThan(width - 40);
      expect(box.y + box.height).toBeGreaterThan(800 - 40);
    } else {
      expect(box.y).toBeLessThan(40);
    }
  });
}

test("the component page does not scroll sideways at 390 pixels in German", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/dev/components?mode=light&lang=de");
  await expect(page.getByRole("main")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
