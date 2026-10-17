import type { Page } from "@playwright/test";
import { expect, type Organization, test } from "../support/fixtures.js";
import { callApi } from "../support/helpers.js";
import { unique } from "../support/people.js";
import { createPage } from "../support/places.js";

test.use({ instanceAdministrator: true });

async function sitesSpace(page: Page, organization: Organization) {
  await page.goto("/spaces");
  const spaceKey = `PP${unique()}`;
  const space = (await callApi(page, "POST", `/api/v1/organizations/${organization.id}/spaces`, {
    name: `Sites ${spaceKey}`,
    key: spaceKey,
    visibility: "organization",
    grants: [{ principalKind: "organizationMembers", principalId: null, role: "editor" }],
  })) as { id: string };
  return { spaceId: space.id, spaceKey };
}

function content(page: Page) {
  return page.getByRole("textbox", { name: "Page content" });
}

async function openEditor(page: Page, path: string) {
  await page.goto(`${path}?edit=true`);
  await expect(content(page)).toBeEditable();
  await content(page).focus();
}

async function insert(page: Page, query: string, option: RegExp) {
  await page.keyboard.type(`/${query}`);
  await expect(page.getByRole("option", { name: option })).toBeVisible();
  await page.keyboard.press("Enter");
}

async function waitSaved(page: Page) {
  await expect(page.getByRole("status").getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 });
}

async function siteWithProperties(
  page: Page,
  spaceId: string,
  spaceKey: string,
  title: string,
  uplink: string,
) {
  const created = await createPage(page, spaceId, spaceKey, title);
  await callApi(page, "POST", `/api/v1/pages/${created.id}/labels`, { label: "site" });
  await openEditor(page, created.path);
  await insert(page, "key value", /^Page properties/);
  const keys = page.locator('[data-type="pagePropertyKey"]');
  await expect(keys).toHaveCount(2);
  await keys.first().click();
  await page.keyboard.type("Uplink");
  await page.keyboard.press("Enter");
  await page.keyboard.type(uplink);
  await waitSaved(page);
  return created;
}

test("collects page properties of two pages in a report on a third page and includes an excerpt", async ({
  page,
  organization,
}) => {
  const { spaceId, spaceKey } = await sitesSpace(page, organization);
  const graz = await siteWithProperties(page, spaceId, spaceKey, "Site Graz", "1 Gbit/s fibre");
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await insert(page, "zusammenfassung", /^Excerpt/);
  await page.keyboard.type("Graz is the main site.");
  await waitSaved(page);
  await siteWithProperties(page, spaceId, spaceKey, "Site Linz", "500 Mbit/s cable");

  const sites = await createPage(page, spaceId, spaceKey, "All sites");
  await openEditor(page, sites.path);
  await insert(page, "details summary", /^Page properties report/);
  const report = page.locator(".ph-properties-report-block");
  await expect(report.getByRole("link", { name: "Site Graz" })).toBeVisible();
  await expect(report.getByRole("link", { name: "Site Linz" })).toBeVisible();
  await page.keyboard.press("Control+End");
  await insert(page, "auszug einbinden", /^Include excerpt/);
  const include = page.locator(".ph-include-block");
  await include.getByRole("combobox", { name: "Page" }).fill("Site Graz");
  await page.getByRole("option", { name: /^Site Graz/ }).click();
  await expect(include.getByText("Graz is the main site.")).toBeVisible();
  await waitSaved(page);

  await page.goto(sites.path);
  const table = page.getByRole("table", { name: "Page properties report" });
  await expect(table.getByRole("link", { name: "Site Graz" })).toBeVisible();
  await expect(table.getByRole("row", { name: /Site Linz.*500 Mbit\/s cable/ })).toBeVisible();
  await expect(table.getByRole("row", { name: /Site Graz.*1 Gbit\/s fibre/ })).toBeVisible();
  await expect(page.getByText("Graz is the main site.")).toBeVisible();
  await table.getByRole("link", { name: "Site Graz" }).click();
  await expect(page).toHaveURL(new RegExp(graz.id));
});
