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
