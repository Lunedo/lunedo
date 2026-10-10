import type { Page } from "@playwright/test";
import type { Organization } from "./fixtures.js";
import { callApi } from "./helpers.js";
import { unique } from "./people.js";

export interface Place {
  spaceId: string;
  spaceKey: string;
  pageId: string;
  pagePath: string;
}

function slug(title: string): string {
  return title.toLowerCase().split(" ").join("-");
}

export async function createPage(page: Page, spaceId: string, spaceKey: string, title: string) {
  const created = (await callApi(page, "POST", `/api/v1/spaces/${spaceId}/items`, {
    kind: "page",
    title,
    parentId: null,
    mode: "live",
  })) as { id: string };
  return { id: created.id, path: `/spaces/${spaceKey}/pages/${created.id}/${slug(title)}` };
}

export async function place(page: Page, organization: Organization, title = "Network plan"): Promise<Place> {
  await page.goto("/spaces");
  const spaceKey = `F${unique()}`;
  const space = (await callApi(page, "POST", `/api/v1/organizations/${organization.id}/spaces`, {
    name: `Files and access ${spaceKey}`,
    key: spaceKey,
    visibility: "private",
    grants: [],
  })) as { id: string };
  const created = await createPage(page, space.id, spaceKey, title);
  return { spaceId: space.id, spaceKey, pageId: created.id, pagePath: created.path };
}
