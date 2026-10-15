import { paragraph } from "../support/collaboration.js";
import { expect, test } from "../support/fixtures.js";
import { callApi } from "../support/helpers.js";
import { unique } from "../support/people.js";
import { place } from "../support/places.js";

test("closing the notification center returns the focus to the bell", async ({ page }) => {
  await page.goto("/");
  const bell = page.getByRole("button", { name: /^Notifications/ });
  await bell.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Notifications", level: 2 })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Notifications", level: 2 })).toBeHidden();
  await expect(bell).toBeFocused();
});

test("closing the status picker returns the focus to the status button", async ({ page, organization }) => {
  const { pagePath } = await place(page, organization, "Status focus");
  await page.goto(pagePath);
  const status = page.getByRole("button", { name: /Set status/ });
  await status.click();
  await expect(page.getByRole("dialog", { name: "Page status" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Page status" })).toBeHidden();
  await expect(status).toBeFocused();

  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "In progress" }).click();
  const changed = page.getByRole("button", { name: /In progress/ });
  await expect(page.getByRole("dialog", { name: "Page status" })).toBeHidden();
  await expect(changed).toBeFocused();
});

test("showing and dismissing a banner keeps the focus on the page", async ({ page, organization }) => {
  await page.goto(`/settings/organizations/${organization.id}/announcements`);
  await page.getByRole("textbox", { name: "Text", exact: true }).fill(`Maintenance tonight ${unique()}`);
  await page.getByRole("button", { name: "Show banner" }).click();
  const save = page.getByRole("button", { name: "Save changes" });
  await expect(save).toBeVisible();
  await expect(save).toBeFocused();

  const dismiss = page.getByRole("button", { name: "Dismiss announcement" });
  await dismiss.click();
  await expect(dismiss).toBeHidden();
  await expect(page.getByRole("heading", { name: "Announcements", level: 1 })).toBeFocused();
});

test("loading more search results moves the focus to the first new result", async ({
  page,
  organization,
}) => {
  const { spaceId } = await place(page, organization, "Search focus");
  const word = `beacon${unique().toLowerCase()}`;
  for (let index = 0; index < 22; index += 1) {
    const created = (await callApi(page, "POST", `/api/v1/spaces/${spaceId}/items`, {
      kind: "page",
      title: `Beacon ${String(index).padStart(2, "0")}`,
      parentId: null,
      mode: "publish",
    })) as { id: string };
    await callApi(page, "PUT", `/api/v1/pages/${created.id}/content`, {
      document: { type: "doc", content: [paragraph(`The ${word} runbook`)] },
    });
    await callApi(page, "POST", `/api/v1/pages/${created.id}/publish`, {});
  }
  await expect(async () => {
    await page.goto(`/search?q=${word}`);
    await expect(page.getByRole("button", { name: "Load more results" })).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  const results = page.getByRole("region", { name: "Results" });
  const before = await results.getByRole("link").count();
  await page.getByRole("button", { name: "Load more results" }).click();
  await expect(results.getByRole("link").nth(before)).toBeFocused();
});
