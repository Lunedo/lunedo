import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.js";
import { callApi } from "../support/helpers.js";
import { createPage, place } from "../support/places.js";
import { sweepAppearances } from "../support/sweeps.js";

function paragraph(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

async function meeting(page: Page, spaceId: string, parentId: string, title: string, decision: string) {
  const created = (await callApi(page, "POST", `/api/v1/spaces/${spaceId}/items`, {
    kind: "page",
    title,
    parentId,
    mode: "live",
  })) as { id: string };
  await callApi(page, "PUT", `/api/v1/pages/${created.id}/content`, {
    document: {
      type: "doc",
      content: [
        { type: "decision", attrs: { id: randomUUID() }, content: [paragraph(decision)] },
        {
          type: "taskList",
          content: [
            { type: "taskItem", attrs: { id: randomUUID() }, content: [paragraph(`Follow up on ${title}`)] },
          ],
        },
      ],
    },
  });
  await callApi(page, "POST", `/api/v1/pages/${created.id}/labels`, { label: "project-atlas" });
  return created.id;
}

test("page reports, decision reports and template buttons pass the review in both languages and themes, wide and narrow", async ({
  page,
  organization,
}) => {
  test.slow();
  const { spaceId, spaceKey, pageId, pagePath } = await place(page, organization, "Project Atlas");
  await meeting(
    page,
    spaceId,
    pageId,
    "Kick-off meeting with the hosting provider and the branch offices",
    "Move the branch offices to the new hosting provider before the end of the second quarter",
  );
  await meeting(page, spaceId, pageId, "Weekly status", "Keep the old firewall until March");
  await callApi(page, "PUT", `/api/v1/pages/${pageId}/content`, {
    document: {
      type: "doc",
      content: [
        {
          type: "templateButton",
          attrs: {
            templateId: "builtin:meeting-notes",
            label: "New meeting note",
            title: "{date} Atlas meeting",
          },
        },
        { type: "pageReport", attrs: { spaceId, labels: ["project-atlas"], sort: "title", limit: 20 } },
        { type: "decisionReport", attrs: { spaceId, labels: ["project-atlas"], parentId: pageId } },
        { type: "taskReport", attrs: { pageIds: [pageId], labels: ["project-atlas"], status: "all" } },
      ],
    },
  });
  const empty = await createPage(page, spaceId, spaceKey, "Archive");
  await callApi(page, "PUT", `/api/v1/pages/${empty.id}/content`, {
    document: {
      type: "doc",
      content: [
        { type: "pageReport", attrs: { spaceId, labels: ["nothing-here"], sort: "modified", limit: 5 } },
        { type: "decisionReport", attrs: { spaceId, labels: ["nothing-here"], order: "oldest" } },
        { type: "templateButton", attrs: { templateId: randomUUID(), label: "" } },
      ],
    },
  });
  const editor = page.getByRole("textbox", { name: /^(Page content|Seiteninhalt)$/ });

  await sweepAppearances(page, "reports", async () => {
    await page.goto(pagePath);
    await expect(page.getByRole("link", { name: "Weekly status" }).first()).toBeVisible();
    await expect(page.getByText("Keep the old firewall until March")).toBeVisible();
    await expect(page.getByRole("button", { name: "New meeting note" })).toBeVisible();
  });
  await sweepAppearances(page, "reports-empty", async () => {
    await page.goto(empty.path);
    await expect(
      page.getByText(
        /^(No decisions you can see match the filters\.|Keine Entscheidung, die du sehen kannst, passt zu den Filtern\.)$/,
      ),
    ).toBeVisible();
    await expect(
      page.getByText(/^(The template of this button|Die Vorlage dieser Schaltfläche)/),
    ).toBeVisible();
  });
  await sweepAppearances(page, "reports-settings", async () => {
    await page.goto(`${pagePath}?edit=true`);
    await expect(editor).toHaveAttribute("contenteditable", "true");
    await expect(editor.getByRole("link", { name: "Weekly status" }).first()).toBeVisible();
    await expect(editor.getByLabel(/^(Title of new pages|Titel neuer Seiten)$/)).toBeVisible();
    await expect(editor.getByLabel(/^(Below page|Unter der Seite)$/)).toBeVisible();
  });
  await sweepAppearances(page, "template-button-title-error", async () => {
    await page.goto(`${pagePath}?edit=true`);
    await expect(editor).toHaveAttribute("contenteditable", "true");
    const title = editor.getByLabel(/^(Title of new pages|Titel neuer Seiten)$/);
    await title.fill("{project} meeting");
    await title.press("Enter");
    await expect(editor.getByText(/\{project\} (is not an input field|ist kein Eingabefeld)/)).toBeVisible();
  });
  await sweepAppearances(page, "template-button-dialog", async () => {
    await page.goto(pagePath);
    await page.getByRole("button", { name: "New meeting note" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByRole("dialog").getByRole("button", { name: /^(Create page|Seite erstellen)$/ }),
    ).toBeVisible();
  });
});
