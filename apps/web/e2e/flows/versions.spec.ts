import type { Page } from "@playwright/test";
import { expect, type Organization, test } from "../support/fixtures.js";
import { callApi, expectAccessible } from "../support/helpers.js";
import { type Person, unique } from "../support/people.js";

test.use({ instanceAdministrator: true });

interface Space {
  id: string;
  key: string;
}

function editor(page: Page) {
  return page.getByRole("textbox", { name: "Page content" });
}

function paragraphs(...texts: string[]) {
  return {
    type: "doc",
    content: texts.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
  };
}

async function releaseNotes(page: Page, organization: Organization, readers: Person[] = []): Promise<Space> {
  const key = `RN${unique()}`;
  await page.goto("/spaces");
  const created = (await callApi(page, "POST", `/api/v1/organizations/${organization.id}/spaces`, {
    name: "Release Notes",
    key,
    visibility: "private",
    grants: readers.map((reader) => ({ principalKind: "account", principalId: reader.id, role: "reader" })),
  })) as { id: string };
  await callApi(page, "PUT", `/api/v1/spaces/${created.id}/settings/pages.defaultMode`, { value: "publish" });
  return { id: created.id, key };
}

async function publishedPage(page: Page, space: Space, draft?: string): Promise<string> {
  const created = (await callApi(page, "POST", `/api/v1/spaces/${space.id}/items`, {
    kind: "page",
    title: "Meeting notes",
    parentId: null,
    mode: "publish",
  })) as { id: string };
  await callApi(page, "PUT", `/api/v1/pages/${created.id}/content`, {
    document: paragraphs("First published sentence."),
  });
  await callApi(page, "POST", `/api/v1/pages/${created.id}/publish`, {});
  if (draft) {
    await callApi(page, "PUT", `/api/v1/pages/${created.id}/content`, {
      document: paragraphs("First published sentence.", draft),
    });
  }
  return `/spaces/${space.key}/pages/${created.id}/meeting-notes`;
}

test("creates a page from a template and publishes it while readers keep the published version", async ({
  page,
  organization,
}) => {
  const reader = await organization.invite("Rita");
  const space = await releaseNotes(page, organization, [reader]);

  await page.goto(`/spaces/${space.key}`);
  await page.getByRole("button", { name: "Create in this space" }).click();
  await page.getByRole("menuitem", { name: "New page" }).click();
  const gallery = page.getByRole("dialog", { name: "Create in Release Notes" });
  await gallery.getByRole("button", { name: /Meeting notes/ }).click();
  await expect(gallery.getByRole("region", { name: "Preview" })).toBeVisible();
  await expectAccessible(page, "template gallery with a template");
  await gallery.getByRole("button", { name: "Create from Meeting notes" }).click();
  await expect(editor(page)).toBeEditable();
  await expect(editor(page)).toHaveAttribute("contenteditable", "true");
  await expect(page.getByText("Not published yet").first()).toBeVisible();
  const pagePath = new URL(page.url()).pathname;

  await editor(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("First published sentence.");
  await expect(page.getByRole("status").getByText("Saved to draft", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expectAccessible(page, "editor in publish mode");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("textbox", { name: "What changed?" }).fill("First version");
  await page.getByRole("button", { name: "Publish version 1" }).click();
  await expect(page.getByText("Published as version 1. Readers see it now.").first()).toBeVisible();

  await expect(editor(page)).toBeEditable();
  await expect(editor(page)).toHaveAttribute("contenteditable", "true");
  await editor(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Secret draft sentence.");
  await expect(page.getByRole("status").getByText("Saved to draft", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/changes? since version 1/).first()).toBeVisible();

  const { page: other } = await organization.signIn(reader);
  await other.goto(pagePath);
  await expect(other.getByText("First published sentence.")).toBeVisible();
  await expect(other.getByText("Secret draft sentence.")).toHaveCount(0);
  await expect(other.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expectAccessible(other, "read view of a published page");
});

test("compares versions and restores an earlier one into the draft", async ({ page, organization }) => {
  const pagePath = await publishedPage(
    page,
    await releaseNotes(page, organization),
    "Secret draft sentence.",
  );
  await page.goto(`${pagePath}?edit=true`);
  await expect(editor(page)).toBeEditable();
  await expect(editor(page)).toHaveAttribute("contenteditable", "true");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByRole("button", { name: "Publish version 2" }).click();
  await expect(page.getByText("Published as version 2. Readers see it now.").first()).toBeVisible();

  await page.getByRole("button", { name: "Version history" }).first().click();
  await expect(page.getByRole("heading", { name: "History", level: 1 })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Changes" }).locator('[data-change="added"], ins').first(),
  ).toContainText("Secret draft");
  await expectAccessible(page, "version history");
  await page.getByRole("radio", { name: "Side by side" }).click();
  await expect(page.getByRole("region", { name: "Version 1" })).toBeVisible();
  await expectAccessible(page, "version comparison side by side");
  await page.getByRole("button", { name: /^Version 1/ }).click();
  await page.getByRole("button", { name: "Restore version 1" }).click();
  const dialog = page.getByRole("dialog", { name: "Restore version 1?" });
  await expectAccessible(page, "restore dialog");
  await dialog.getByRole("button", { name: "Restore version 1" }).click();
  await expect(
    page.getByText("Version 1 is now the draft. Publish it to show it to readers.").first(),
  ).toBeVisible();
  await expect(editor(page)).not.toContainText("Secret draft sentence.");
});

test("deletes a page to the trash, restores it and archives it", async ({ page, organization }) => {
  const space = await releaseNotes(page, organization);
  const pagePath = await publishedPage(page, space);
  await page.goto(pagePath);
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Move to trash" }).click();
  await expect(page.getByText(/moved to the trash/).first()).toBeVisible();
  await page.goto(`/spaces/${space.key}/trash`);
  await expect(page.getByRole("heading", { name: "Trash", level: 1 })).toBeVisible();
  await expectAccessible(page, "trash");
  await page.getByRole("button", { name: "Restore" }).first().click();
  await expect(page.getByText(/restored/).first()).toBeVisible();

  await page.goto(pagePath);
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expect(page.getByText("Archived", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expectAccessible(page, "archived page");
  await page.getByRole("button", { name: "Bring back from the archive" }).first().click();
  await expect(page.getByRole("button", { name: "Edit" })).toBeVisible();
});

test("passes the accessibility check on the new settings screens", async ({ page, organization }) => {
  const space = await releaseNotes(page, organization);
  await page.goto(`/spaces/${space.key}/settings/content`);
  await expect(page.getByRole("heading", { name: "Pages and trash", level: 1 })).toBeVisible();
  await expectAccessible(page, "space pages and trash");
  await page.goto(`/spaces/${space.key}/settings/templates`);
  await expect(page.getByRole("heading", { name: "Templates", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Create template" }).first().click();
  await expect(page.getByRole("dialog", { name: "New template" })).toBeVisible();
  await expectAccessible(page, "template editor");
  await page.keyboard.press("Escape");
  await page.goto(`/settings/organizations/${organization.id}/content`);
  await expect(page.getByRole("heading", { name: "Pages and trash", level: 1 })).toBeVisible();
  await expectAccessible(page, "organization pages and trash");
  await page.goto(`/settings/organizations/${organization.id}/templates`);
  await expectAccessible(page, "organization templates");
  await page.goto("/settings/instance/content");
  await expectAccessible(page, "instance pages and trash");
  await page.goto("/settings/instance/templates");
  await expectAccessible(page, "instance templates");
});
