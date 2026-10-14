import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import { callApi, expectAccessible } from "../support/helpers.js";
import { unique } from "../support/people.js";

async function handbook(page: Page, organizationId: string) {
  const key = `EX${unique()}`;
  await page.goto("/spaces");
  const space = (await callApi(page, "POST", `/api/v1/organizations/${organizationId}/spaces`, {
    name: "Export handbook",
    key,
    visibility: "private",
    grants: [],
  })) as { id: string };
  const created = (await callApi(page, "POST", `/api/v1/spaces/${space.id}/items`, {
    kind: "page",
    title: "Network guide",
    parentId: null,
    mode: "live",
  })) as { id: string };
  await callApi(page, "PUT", `/api/v1/pages/${created.id}/content`, {
    document: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Connect through WireGuard." }] }],
    },
  });
  return { id: space.id, key, pagePath: `/spaces/${key}/pages/${created.id}/network-guide` };
}

async function openExport(page: Page, path: string) {
  await page.goto(path);
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Export" }).click();
  return page.getByRole("dialog", { name: "Export page" });
}

test("exports a page at once and a space in the background, and stops when export is turned off", async ({
  page,
  organization,
}) => {
  const space = await handbook(page, organization.id);

  const dialog = await openExport(page, space.pagePath);
  await dialog.getByRole("radio", { name: /^HTML/ }).check();
  await expectAccessible(page, "page export dialog");
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download" }).click();
  expect((await download).suggestedFilename()).toBe("Network guide.html");

  await page.getByRole("button", { name: "Space options" }).click();
  await page.getByRole("menuitem", { name: "Export space" }).click();
  const spaceDialog = page.getByRole("dialog", { name: "Export Export handbook" });
  await spaceDialog.getByRole("button", { name: "Export space" }).click();
  await expect(page.getByText("Export started", { exact: true })).toBeVisible();

  await page.goto("/settings/exports");
  const list = page.getByRole("list", { name: "Your exports" });
  await expect(list.getByText("Ready")).toBeVisible({ timeout: 30_000 });
  await expectAccessible(page, "exports screen");
  const archive = page.waitForEvent("download");
  await list.getByRole("link", { name: "Download" }).click();
  expect((await archive).suggestedFilename()).toMatch(/^Export handbook \d{4}-\d{2}-\d{2}\.zip$/);

  await page.goto(`/spaces/${space.key}/settings/export`);
  await page.getByRole("switch", { name: "Allow export" }).click();
  await expect(page.getByText("Export is turned off for this space").first()).toBeVisible();
  await expectAccessible(page, "space export settings");

  const turnedOff = await openExport(page, space.pagePath);
  await expect(turnedOff.getByText("Export is turned off for this space")).toBeVisible();
  await expect(turnedOff.getByRole("button", { name: "Download" })).toHaveCount(0);
});
