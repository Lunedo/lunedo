import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import { callApi } from "../support/helpers.js";
import { unique } from "../support/people.js";
import { place } from "../support/places.js";

async function expectInSpace(page: Page, key: string, name: string): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`/spaces/${key}(/|$)`));
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }).getByText(name).first(),
  ).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(new RegExp(`/spaces/${key}(/|$)`));
}

test("opens another space from a page in the current space by every way there is", async ({
  page,
  organization,
}) => {
  const first = await place(page, organization, "Start page");
  const firstName = `Files and access ${first.spaceKey}`;
  const secondKey = `B${unique()}`;
  const secondName = `Second space ${secondKey}`;
  await callApi(page, "POST", `/api/v1/organizations/${organization.id}/spaces`, {
    name: secondName,
    key: secondKey,
    visibility: "private",
    grants: [],
  });

  await page.goto(first.pagePath);
  await expect(page.getByRole("heading", { name: "Start page", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Spaces", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Spaces" });
  await panel.getByRole("searchbox", { name: "Search spaces" }).fill(secondKey);
  await panel.getByRole("link", { name: new RegExp(secondName) }).click();
  await expectInSpace(page, secondKey, secondName);

  await page.goBack();
  await expect(page.getByRole("heading", { name: "Start page", level: 1 })).toBeVisible();
  await expectInSpace(page, first.spaceKey, firstName);
  await page.goForward();
  await expectInSpace(page, secondKey, secondName);

  await page.goto(first.pagePath);
  await expect(page.getByRole("heading", { name: "Start page", level: 1 })).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog", { name: "Search" })).toBeVisible();
  await page.keyboard.type(secondKey);
  await page.getByRole("option", { name: `${secondName} ${secondKey}`, exact: true }).click();
  await expectInSpace(page, secondKey, secondName);

  await page.goto(first.pagePath);
  await expect(page.getByRole("heading", { name: "Start page", level: 1 })).toBeVisible();
  await page.goto(`/spaces/${secondKey}`);
  await expectInSpace(page, secondKey, secondName);
});
