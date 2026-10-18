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

async function openEditor(page: Page, path: string, intro: string) {
  await page.goto(`${path}?edit=true`);
  await expect(content(page)).toBeEditable();
  await expect(content(page)).toHaveAttribute("contenteditable", "true");
  await expect(page.getByText("Saved").or(page.getByText("Editing")).first()).toBeVisible();
  await content(page).click();
  await page.keyboard.type(intro);
  await page.keyboard.press("Enter");
}

async function insert(page: Page, query: string, option: RegExp) {
  await page.keyboard.type(`/${query}`);
  const choice = page.getByRole("option", { name: option });
  await expect(choice).toBeVisible();
  await choice.click();
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
  await openEditor(page, created.path, `${title} in short`);
  await insert(page, "properties", /^Page properties\s*Names and values/);
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
  await openEditor(page, sites.path, "Our sites");
  await insert(page, "properties", /^Page properties report/);
  const report = page.locator(".ph-properties-report-block");
  await expect(report.getByRole("link", { name: "Site Graz" })).toBeVisible();
  await expect(report.getByRole("link", { name: "Site Linz" })).toBeVisible();
  await page.keyboard.press("Control+End");
  await insert(page, "einbinden", /^Include excerpt/);
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

test("renders a page for a reader who cannot see the pages and whiteboard it includes", async ({
  page,
  organization,
}) => {
  await page.goto("/spaces");
  const space = async (name: string, visibility: string, grants: unknown[]) => {
    const key = `IN${unique()}`;
    const created = (await callApi(page, "POST", `/api/v1/organizations/${organization.id}/spaces`, {
      name,
      key,
      visibility,
      grants,
    })) as { id: string };
    return { id: created.id, key };
  };
  const operations = await space("IT Operations", "organization", [
    { principalKind: "organizationMembers", principalId: null, role: "reader" },
  ]);
  const security = await space("Security", "private", []);
  const published = async (spaceId: string, title: string, content: unknown[]) => {
    const created = (await callApi(page, "POST", `/api/v1/spaces/${spaceId}/items`, {
      kind: "page",
      title,
      parentId: null,
      mode: "publish",
    })) as { id: string };
    await callApi(page, "PUT", `/api/v1/pages/${created.id}/content`, { document: { type: "doc", content } });
    await callApi(page, "POST", `/api/v1/pages/${created.id}/publish`, {});
    return created.id;
  };
  const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
  const incident = await published(security.id, "Incident response", [
    {
      type: "excerpt",
      attrs: { name: null, hidden: false },
      content: [paragraph("Call the security lead.")],
    },
  ]);
  const board = (await callApi(page, "POST", `/api/v1/spaces/${security.id}/items`, {
    kind: "whiteboard",
    title: "Threat model",
    parentId: null,
  })) as { id: string };
  const sites = await published(operations.id, "Network sites", [
    paragraph("Every site has two uplinks."),
    { type: "includeExcerpt", attrs: { pageId: incident, name: null, panel: true } },
    { type: "includePage", attrs: { pageId: incident } },
    { type: "whiteboard", attrs: { whiteboardId: board.id } },
    paragraph("Ask the network team for changes."),
  ]);

  const reader = await organization.invite("Chris");
  const second = await organization.signIn(reader);
  try {
    await second.page.goto(`/spaces/${operations.key}/pages/${sites}/network-sites`);
    await expect(second.page.getByText("Every site has two uplinks.")).toBeVisible();
    await expect(second.page.getByText("Ask the network team for changes.")).toBeVisible();
    await expect(second.page.getByText("Page not found")).toHaveCount(0);
    await expect(second.page.getByText("Call the security lead.")).toHaveCount(0);
    await expect(second.page.getByText("Incident response")).toHaveCount(0);
    await expect(second.page.getByText("Threat model")).toHaveCount(0);
  } finally {
    await second.context.close();
  }

  await page.goto(`/spaces/${operations.key}/pages/${sites}/network-sites`);
  await expect(page.getByText("Call the security lead.").first()).toBeVisible();
});

test("inserts blocks whose names have spaces from the slash menu", async ({ page, organization }) => {
  const { spaceId, spaceKey } = await sitesSpace(page, organization);
  const created = await createPage(page, spaceId, spaceKey, "Slash names");
  await openEditor(page, created.path, "Blocks by name");
  await page.keyboard.type("/page properties report");
  await expect(page.getByRole("option").first()).toHaveAccessibleName(/^Page properties report/);
  await page.keyboard.press("Enter");
  await expect(page.locator(".ph-properties-report-block")).toBeVisible();
  await expect(content(page)).not.toContainText("/page properties report");

  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/include excerpt");
  await page.keyboard.press("Enter");
  await expect(page.locator(".ph-include-block")).toBeVisible();

  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/ and then we went home");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(content(page)).toContainText("/ and then we went home");
});
