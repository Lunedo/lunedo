import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import { callApi } from "../support/helpers.js";
import { createPage, place } from "../support/places.js";
import { sweepAppearances } from "../support/sweeps.js";

async function childPage(page: Page, spaceId: string, parentId: string, title: string) {
  return (await callApi(page, "POST", `/api/v1/spaces/${spaceId}/items`, {
    kind: "page",
    title,
    parentId,
    mode: "live",
  })) as { id: string };
}

async function attach(page: Page, pageId: string, name: string, bytes: number) {
  const response = await page.request.post(
    `/api/v1/pages/${pageId}/attachments?name=${encodeURIComponent(name)}`,
    {
      data: Buffer.alloc(bytes, 7),
      headers: {
        "X-Pagehall-Request": "1",
        origin: new URL(page.url()).origin,
        "content-type": "application/octet-stream",
      },
    },
  );
  expect(response.status(), await response.text()).toBe(201);
}

test("child pages and attachment lists pass the review in both languages and themes, wide and narrow", async ({
  page,
  organization,
}) => {
  test.slow();
  const { spaceId, spaceKey, pageId, pagePath } = await place(page, organization, "Runbook");
  const network = await childPage(page, spaceId, pageId, "Network and remote access for branch offices");
  await childPage(page, spaceId, network.id, "Firewall rules");
  await childPage(page, spaceId, pageId, "Backup");
  await attach(page, pageId, "handbook.pdf", 2_621_440);
  await attach(page, pageId, "maintenance-contract-with-the-hosting-provider-2026.pdf", 48_000);
  await attach(page, pageId, "budget.xlsx", 512);
  await callApi(page, "PUT", `/api/v1/pages/${pageId}/content`, {
    document: {
      type: "doc",
      content: [
        { type: "childPages", attrs: { depth: 2, sort: "title" } },
        { type: "attachmentList", attrs: { fileTypes: ["pdf"] } },
      ],
    },
  });
  const settings = await createPage(page, spaceId, spaceKey, "Overview");
  await callApi(page, "PUT", `/api/v1/pages/${settings.id}/content`, {
    document: {
      type: "doc",
      content: [
        { type: "childPages", attrs: { pageId, depth: null, sort: "modified", reverse: true } },
        { type: "attachmentList", attrs: { fileTypes: [] } },
      ],
    },
  });
  const editor = page.getByRole("textbox", { name: /^(Page content|Seiteninhalt)$/ });

  await sweepAppearances(page, "child-pages-and-attachments", async () => {
    await page.goto(pagePath);
    await expect(page.getByRole("link", { name: "Firewall rules" })).toBeVisible();
    await expect(page.getByRole("link", { name: "handbook.pdf" }).first()).toBeVisible();
  });
  await sweepAppearances(page, "child-pages-settings", async () => {
    await page.goto(`${settings.path}?edit=true`);
    await expect(editor).toHaveAttribute("contenteditable", "true");
    await expect(editor.getByRole("link", { name: "Backup" })).toBeVisible();
    await expect(
      editor.getByText(/^(No attachments on this page\.|Diese Seite hat keine Anhänge\.)$/),
    ).toBeVisible();
  });
  await sweepAppearances(page, "attachment-list-file-types-error", async () => {
    await page.goto(`${pagePath}?edit=true`);
    await expect(editor).toHaveAttribute("contenteditable", "true");
    const field = page.getByLabel(/^(File types|Dateitypen)$/);
    await field.fill("pdf, report-2024");
    await field.press("Enter");
    await expect(editor.getByText(/^(Enter up to 20|Gib bis zu 20)/)).toBeVisible();
  });
});
