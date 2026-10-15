import { expect, test } from "@playwright/test";

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

test("every control on the component page has a hit area of at least 44 pixels", async ({ page }) => {
  await page.goto("/dev/components?mode=light");
  await expect(page.getByRole("main")).toBeVisible();
  const { checked, small } = await page.evaluate(() => {
    const controls = document.querySelectorAll<HTMLElement>(
      "main button, main [role='checkbox'], main [role='radio'], main [role='switch'], main [role='tab'], main [role='combobox']",
    );
    const found = Array.from(controls).flatMap((control) => {
      const area = (control.matches("input") && control.closest<HTMLElement>("[data-hit-area]")) || control;
      const box = area.getBoundingClientRect();
      if (box.width === 0 || box.height === 0 || control.closest("[aria-hidden='true']")) return [];
      const after = getComputedStyle(area, "::after");
      const extended = after.position === "absolute";
      const width = Math.max(box.width, extended ? Number.parseFloat(after.width) || 0 : 0);
      const height = Math.max(box.height, extended ? Number.parseFloat(after.height) || 0 : 0);
      if (width >= 44 && height >= 44) return [];
      const name = control.getAttribute("aria-label") ?? control.textContent?.trim() ?? control.tagName;
      return [`${name} (${Math.round(width)} × ${Math.round(height)})`];
    });
    return { checked: controls.length, small: found };
  });
  expect(checked).toBeGreaterThan(30);
  expect(small).toEqual([]);
});
