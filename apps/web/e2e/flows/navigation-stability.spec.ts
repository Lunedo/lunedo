import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import { callApi, openSettingsArea, setAppearance } from "../support/helpers.js";
import { forwardFrom } from "../support/people.js";
import { place } from "../support/places.js";

interface Problem {
  path: string;
  missing: string[];
}

async function watchFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    const problems: Problem[] = [];
    const check = () => {
      const missing: string[] = [];
      if (!document.querySelector("[data-top-bar]")) missing.push("top bar");
      const sidebar = [...document.querySelectorAll("nav")].some((nav) => !nav.closest("[data-top-bar]"));
      if (!sidebar && !document.querySelector("[data-settings-pending]")) missing.push("sidebar");
      const main = document.querySelector("[data-content-area] main");
      if (!main || main.childElementCount === 0) missing.push("content");
      if (missing.length > 0) problems.push({ path: location.pathname, missing });
    };
    new MutationObserver(check).observe(document.body, { childList: true, subtree: true });
    const frame = () => {
      check();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    (window as unknown as { navigationProblems: Problem[] }).navigationProblems = problems;
  });
}

function problems(page: Page): Promise<Problem[]> {
  return page.evaluate(() => (window as unknown as { navigationProblems: Problem[] }).navigationProblems);
}

test("keeps the top bar, the sidebar and the content area in every frame while moving between screens", async ({
  page,
  organization,
}) => {
  const target = await place(page, organization, "Stable page");
  await callApi(page, "PUT", `/api/v1/starred/spaces/${target.spaceId}`);
  const spaceName = `Files and access ${target.spaceKey}`;

  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "For you", level: 1 })).toBeVisible();
  await watchFrames(page);

  await page.getByRole("link", { name: spaceName }).first().click();
  await expect(page).toHaveURL(new RegExp(`/spaces/${target.spaceKey}`));
  const tree = page.getByRole("tree", { name: "Page tree" });
  await expect(tree).toBeVisible();

  await tree.getByRole("link", { name: "Stable page" }).click();
  await expect(page.getByRole("heading", { name: "Stable page", level: 1 })).toBeVisible();

  await page.getByRole("link", { name: /^My tasks/ }).click();
  await expect(page.getByRole("heading", { name: "My tasks", level: 1 })).toBeVisible();

  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Search" });
  await expect(palette).toBeVisible();
  await page.keyboard.type("Stable");
  await palette.getByRole("link", { name: "All results for “Stable”" }).click();
  await expect(page).toHaveURL(/\/search\?/);
  await expect(page.getByRole("heading", { name: "Search", level: 1 })).toBeAttached();

  await page.getByRole("button", { name: /^Notifications/ }).click();
  await page.getByRole("dialog", { name: "Notifications" }).getByRole("link", { name: "Show all" }).click();
  await expect(page.getByRole("heading", { name: "Notifications", level: 1 })).toBeVisible();

  await openSettingsArea(page, "My account");
  await expect(page.getByRole("heading", { name: "Profile", level: 1 })).toBeVisible();

  await page.getByRole("link", { name: /^Back to/ }).click();
  await expect(page.getByRole("heading", { name: "Notifications", level: 1 })).toBeVisible();

  await page.getByRole("link", { name: "For you" }).click();
  await expect(page.getByRole("heading", { name: "For you", level: 1 })).toBeVisible();

  expect(await problems(page)).toEqual([]);
});

test("paints the remembered dark appearance and the shell outline before the application runs", async ({
  page,
  browser,
}) => {
  await page.goto("/home");
  await setAppearance(page, { colorMode: "dark" });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("heading", { name: "For you", level: 1 })).toBeVisible();
  const darkBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const storage = await page.context().storageState();

  const context = await forwardFrom(
    await browser.newContext({ storageState: storage, colorScheme: "light" }),
  );
  const first = await context.newPage();
  await first.route(/\/assets\/main-[^/]+\.js$/, (route) => route.abort());
  await first.goto("/home");
  await expect(first.locator("#boot-shell")).toBeVisible();
  expect(await first.locator("html").getAttribute("data-theme")).toBe("dark");
  expect(await first.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(darkBackground);
  expect(await first.locator("#root").innerHTML()).toBe("");
  await context.close();
});
