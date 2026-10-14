import { expect, type Page } from "@playwright/test";
import { paragraph } from "./collaboration.js";
import type { Organization } from "./fixtures.js";
import { callApi } from "./helpers.js";
import { unique } from "./people.js";

export interface SearchWorld {
  word: string;
  operations: { id: string; key: string; name: string };
  security: { id: string; key: string; name: string };
  gatewayPath: string;
}

async function page(
  browserPage: Page,
  spaceId: string,
  title: string,
  text: string,
  labels: string[] = [],
): Promise<string> {
  const created = (await callApi(browserPage, "POST", `/api/v1/spaces/${spaceId}/items`, {
    kind: "page",
    title,
    parentId: null,
    mode: "publish",
  })) as { id: string };
  await callApi(browserPage, "PUT", `/api/v1/pages/${created.id}/content`, {
    document: { type: "doc", content: [paragraph(text)] },
  });
  for (const label of labels)
    await callApi(browserPage, "POST", `/api/v1/pages/${created.id}/labels`, { label });
  await callApi(browserPage, "POST", `/api/v1/pages/${created.id}/publish`, {});
  return created.id;
}

export async function searchWorld(browserPage: Page, organization: Organization): Promise<SearchWorld> {
  await browserPage.goto("/spaces");
  const word = `gateway${unique()
    .toLowerCase()
    .replace(/[^a-z]/g, "")}`;
  const space = async (name: string, prefix: string) => {
    const key = `${prefix}${unique()}`;
    const created = (await callApi(browserPage, "POST", `/api/v1/organizations/${organization.id}/spaces`, {
      name,
      key,
      visibility: "organization",
      grants: [],
    })) as { id: string };
    return { id: created.id, key, name };
  };
  const operations = await space("IT Operations", "OP");
  const security = await space("Security", "SE");
  const gateway = await page(
    browserPage,
    operations.id,
    "Restart the VPN gateway",
    `When the ${word} stops accepting connections, check the tunnel status first, then restart the service on both nodes.`,
    ["runbook"],
  );
  await page(
    browserPage,
    operations.id,
    "Network overview",
    `The ${word} sits in the DMZ next to the reverse proxy.`,
    ["network"],
  );
  await page(
    browserPage,
    security.id,
    "VPN access for contractors",
    `Contractors reach the ${word} with a token.`,
  );
  await expect
    .poll(
      async () => {
        const response = await browserPage.request.get(
          `/api/v1/organizations/${organization.id}/search?q=${encodeURIComponent(word)}`,
        );
        return ((await response.json()) as { total: number }).total;
      },
      { timeout: 30_000 },
    )
    .toBe(3);
  return { word, operations, security, gatewayPath: `/spaces/${operations.key}/pages/${gateway}` };
}
