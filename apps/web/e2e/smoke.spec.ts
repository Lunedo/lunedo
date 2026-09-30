import { expect, test } from "@playwright/test";

test("shows the application frame in light mode", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");

  await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Pagehall home" }).locator("img:visible")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Create" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
});

test("follows the dark system preference", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(21, 22, 23)");
});

test("uses the Geist font", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toHaveCSS("font-family", /Geist/);
});
