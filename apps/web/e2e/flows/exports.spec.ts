import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { ChromiumRenderer, createRenderServer } from "@pagehall/render";
import { chromium, type Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import { callApi, expectAccessible } from "../support/helpers.js";
import { unique } from "../support/people.js";

const VIEWER = fileURLToPath(new URL("../../dist", import.meta.url));
const RENDER_TOKEN = "e2e-render-token-".padEnd(48, "x");

async function handbook(page: Page, organizationId: string, readerId?: string) {
  const key = `EX${unique()}`;
  await page.goto("/spaces");
  const space = (await callApi(page, "POST", `/api/v1/organizations/${organizationId}/spaces`, {
    name: "Export handbook",
    key,
    visibility: "private",
    grants: readerId ? [{ principalKind: "account", principalId: readerId, role: "reader" }] : [],
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
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Tunnel" }] },
        { type: "paragraph", content: [{ type: "text", text: "Connect through WireGuard." }] },
      ],
    },
  });
  const child = (await callApi(page, "POST", `/api/v1/spaces/${space.id}/items`, {
    kind: "page",
    title: "Firewall rules",
    parentId: created.id,
    mode: "live",
  })) as { id: string };
  return {
    id: space.id,
    key,
    pageId: created.id,
    childId: child.id,
    pagePath: `/spaces/${key}/pages/${created.id}/network-guide`,
  };
}

async function openExport(page: Page, path: string) {
  await page.goto(path);
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Export" }).click();
  return page.getByRole("dialog", { name: "Export “Network guide”" });
}

test("exports a page at once and a space in the background, and stops when export is turned off", async ({
  page,
  organization,
}) => {
  const space = await handbook(page, organization.id);

  const dialog = await openExport(page, space.pagePath);
  await dialog.getByRole("radio", { name: /^HTML/ }).check();
  await dialog.getByRole("switch", { name: "Include attachments" }).click();
  await expectAccessible(page, "export dialog");
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download" }).click();
  expect((await download).suggestedFilename()).toBe("Network guide.html");

  await page.getByRole("button", { name: "Space options" }).click();
  await page.getByRole("menuitem", { name: "Export space" }).click();
  const spaceDialog = page.getByRole("dialog", { name: "Export “Export handbook”" });
  await spaceDialog.getByRole("radio", { name: /^Markdown/ }).check();
  await spaceDialog.getByRole("button", { name: "Start export" }).click();
  await expect(page.getByText("Export started", { exact: true })).toBeVisible();

  await page.goto("/settings/exports");
  const list = page.getByRole("list", { name: "Your exports" });
  await expect(list.getByText("Ready")).toBeVisible({ timeout: 30_000 });
  await expect(list.getByText(/^Markdown · Space/)).toBeVisible();
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

test("shows readers that only space admins export several pages, and lets them download Word", async ({
  page,
  organization,
}) => {
  const reader = await organization.invite("Rita");
  const space = await handbook(page, organization.id, reader.id);
  const session = await organization.signIn(reader);

  const dialog = await openExport(session.page, space.pagePath);
  await expect(dialog.getByRole("radio", { name: /This page and its subpages/ })).toBeDisabled();
  await expect(dialog.getByRole("radio", { name: /The whole space/ })).toBeDisabled();
  await expect(
    dialog.getByText(
      "Only space admins can export several pages at once. Ask a space admin of Export handbook.",
    ),
  ).toHaveCount(2);
  await dialog.getByRole("radio", { name: /^Word/ }).check();
  const download = session.page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Download" }).click();
  expect((await download).suggestedFilename()).toBe("Network guide.docx");
  await expectAccessible(session.page, "export dialog for readers");
});

test("lets space admins export a page with its subpages as Word in the background", async ({
  page,
  organization,
}) => {
  const space = await handbook(page, organization.id);
  const dialog = await openExport(page, space.pagePath);
  await dialog.getByRole("radio", { name: /^Word/ }).check();
  await dialog.getByRole("radio", { name: /This page and its subpages/ }).check();
  await expect(dialog.getByText("2 pages you can read")).toBeVisible();
  await expect(dialog.getByText(/Runs in the background/)).toBeVisible();
  await dialog.getByRole("button", { name: "Start export" }).click();
  await expect(page.getByText("Export started", { exact: true })).toBeVisible();

  await page.goto("/settings/exports");
  const list = page.getByRole("list", { name: "Your exports" });
  await expect(list.getByText(/^Word · Page with subpages/)).toBeVisible();
  await expect(list.getByText("Ready")).toBeVisible({ timeout: 30_000 });
  const file = page.waitForEvent("download");
  await list.getByRole("link", { name: "Download" }).click();
  expect((await file).suggestedFilename()).toMatch(/^Network guide \d{4}-\d{2}-\d{2}\.docx$/);
});

test("lays out the print view of a page and opens the print dialog", async ({ page, organization }) => {
  await page.addInitScript(() => {
    const target = window.top as Window & { printed?: number };
    window.print = () => {
      target.printed = (target.printed ?? 0) + 1;
    };
  });
  const space = await handbook(page, organization.id);
  const dialog = await openExport(page, space.pagePath);
  await expect(dialog.getByText("Your browser opens the print dialog — choose “Save as PDF”.")).toBeVisible();
  await dialog.getByRole("radio", { name: "Landscape" }).click();
  await dialog.getByRole("button", { name: "Open print view" }).click();

  await expect(page).toHaveURL(/\/print\?/);
  await expect(page.getByRole("heading", { name: "Print view · Network guide" })).toBeVisible();
  await expect(page.getByText("A4 · Landscape · 2 sheets")).toBeVisible({ timeout: 30_000 });
  const sheets = page.frameLocator('iframe[title="Print preview of Network guide"]');
  await expect(sheets.locator("[data-vivliostyle-page-container]")).toHaveCount(2);
  await expect(sheets.getByText("Connect through WireGuard.")).toBeVisible();
  await expect(sheets.getByText("Page 2 of 2")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as Window & { printed?: number }).printed)).toBe(1);
  await page.getByRole("button", { name: "Print again" }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { printed?: number }).printed)).toBe(2);
  await expectAccessible(page, "print view");
});

test("turns print HTML into a PDF in the render service without reaching other hosts", async ({
  page,
  organization,
}) => {
  const space = await handbook(page, organization.id);
  const response = await page.request.get(`/api/v1/pages/${space.pageId}/export?format=print`);
  expect(response.status()).toBe(200);
  let hits = 0;
  const bait = createServer((_request, reply) => {
    hits += 1;
    reply.end("x");
  });
  await new Promise<void>((resolve) => bait.listen(0, "127.0.0.1", resolve));
  const baitUrl = `http://127.0.0.1:${(bait.address() as AddressInfo).port}`;
  const html = (await response.text()).replace(
    "</body>",
    `<img src="${baitUrl}/image.png" alt=""><link rel="stylesheet" href="${baitUrl}/style.css"><script>fetch("${baitUrl}/script")</script></body>`,
  );
  const blocked: string[] = [];
  const renderer = new ChromiumRenderer({
    executablePath: chromium.executablePath(),
    viewerDirectory: VIEWER,
    sandbox: false,
    onBlocked: (url) => blocked.push(url),
  });
  const start = async (limits: { maxBytes: number; timeoutSeconds: number }) => {
    const server = createRenderServer({
      token: RENDER_TOKEN,
      version: "e2e",
      renderer,
      concurrency: 1,
      maxWaiting: 1,
      ...limits,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
  };
  const send = (url: string, token: string, body: unknown) =>
    fetch(`${url}/v1/pdf`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const regular = await start({ maxBytes: 20 * 1024 * 1024, timeoutSeconds: 60 });
  const small = await start({ maxBytes: 1024, timeoutSeconds: 60 });
  const hasty = await start({ maxBytes: 20 * 1024 * 1024, timeoutSeconds: 0.05 });
  try {
    const job = { html, baseUrl: new URL(page.url()).origin, assets: [] };
    expect((await send(regular.url, "wrong-token".padEnd(48, "x"), job)).status).toBe(401);
    const rendered = await send(regular.url, RENDER_TOKEN, job);
    expect(rendered.status).toBe(200);
    const pdf = Buffer.from(await rendered.arrayBuffer());
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdf.toString("latin1")).toMatch(/\/Type\s*\/Page[^s]/);
    expect(hits).toBe(0);
    expect((await send(small.url, RENDER_TOKEN, job)).status).toBe(413);
    expect((await send(hasty.url, RENDER_TOKEN, job)).status).toBe(504);
  } finally {
    for (const { server } of [regular, small, hasty]) server.close();
    bait.close();
    await renderer.close();
  }
});
