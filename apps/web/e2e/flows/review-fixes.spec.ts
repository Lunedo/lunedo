import { expect, test } from "../support/fixtures.js";
import { callApi } from "../support/helpers.js";
import { place } from "../support/places.js";

test.use({ instanceAdministrator: true });

test("a label chip is as tall as the button beside it", async ({ page, organization }) => {
  const { pageId, pagePath } = await place(page, organization, "Rotate certificates");
  await callApi(page, "POST", `/api/v1/pages/${pageId}/labels`, { label: "security-runbook" });
  await page.goto(pagePath);
  const chip = page.getByRole("list", { name: "Labels" }).getByRole("listitem").first();
  const add = page.getByRole("button", { name: "Add label" });
  await expect(chip).toBeVisible();
  const chipBox = await chip.boundingBox();
  const addBox = await add.boundingBox();
  expect(Math.round(chipBox?.height ?? 0)).toBe(Math.round(addBox?.height ?? -1));
});

test("a dialog opened from a menu starts in its first field and returns the focus to the menu button", async ({
  page,
  organization,
}) => {
  const { pagePath } = await place(page, organization, "Move me");
  await page.goto(pagePath);
  const more = page.getByRole("button", { name: "More actions" });
  await more.click();
  await page.getByRole("menuitem", { name: "Move…", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close" })).not.toBeFocused();
  await expect(dialog.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(more).toBeFocused();
});

test("the shortcut to the audit log leads to the audit log from a space", async ({ page, organization }) => {
  const { spaceKey } = await place(page, organization, "Shortcut");
  await page.goto(`/spaces/${spaceKey}/meetings`);
  await expect(page.getByRole("main")).toBeVisible();
  await page.keyboard.press("g");
  await page.keyboard.press("a");
  await expect(page).toHaveURL(new RegExp(`/settings/organizations/${organization.id}/audit-log$`));
});
