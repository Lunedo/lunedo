import { type Browser, expect, type Page, test } from "@playwright/test";
import { BASE_URL, OWNER_STORAGE, readState } from "../support/environment.js";
import { callApi, expectAccessible, linkFrom, signInWithPassword, waitForMail } from "../support/helpers.js";

test.describe.configure({ mode: "serial" });
test.use({ storageState: OWNER_STORAGE });

const SPACE_KEY = "RN";
let spaceId = "";
let pagePath = "";
let reader = { email: "", password: "" };

async function organizationId(page: Page): Promise<string> {
  const stored = readState().organizationId;
  if (stored) return stored;
  const response = await page.request.get("/api/v1/organizations?limit=10");
  return ((await response.json()) as { items: { id: string }[] }).items[0]?.id ?? "";
}

async function invite(page: Page, browser: Browser, name: string) {
  const email = `${name.toLowerCase().replace(/\s+/g, ".")}.${Date.now()}@pagehall.test`;
  const password = `${name} passphrase for reading`;
  await callApi(page, "POST", `/api/v1/organizations/${await organizationId(page)}/invitations`, {
    email,
    kind: "member",
  });
  const token = /#token=([\w-]+)/.exec(linkFrom((await waitForMail(email, /invit/i)).text))?.[1] ?? "";
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const response = await anonymous.request.post(`${BASE_URL}/api/v1/invitations/accept`, {
      data: { token, name, password },
      headers: { "X-Pagehall-Request": "1", origin: BASE_URL },
    });
    expect(response.status(), await response.text()).toBeLessThan(300);
    const { accountId } = (await response.json()) as { accountId: string };
    return { id: accountId, email, password };
  } finally {
    await anonymous.close();
  }
}

function editor(page: Page) {
  return page.getByRole("textbox", { name: "Page content" });
}

test("creates a page from a template and publishes it while readers keep the published version", async ({
  page,
  browser,
}) => {
  await page.goto("/spaces");
  const person = await invite(page, browser, "Rita Reader");
  reader = person;
  const created = (await callApi(page, "POST", `/api/v1/organizations/${await organizationId(page)}/spaces`, {
    name: "Release Notes",
    key: SPACE_KEY,
    visibility: "private",
    grants: [{ principalKind: "account", principalId: person.id, role: "reader" }],
  })) as { id: string };
  spaceId = created.id;
  await callApi(page, "PUT", `/api/v1/spaces/${spaceId}/settings/pages.defaultMode`, { value: "publish" });

  await page.goto(`/spaces/${SPACE_KEY}`);
  await page.getByRole("button", { name: "Create in this space" }).click();
  await page.getByRole("menuitem", { name: "New page" }).click();
  const gallery = page.getByRole("dialog", { name: "Create in Release Notes" });
  await gallery.getByRole("button", { name: /Meeting notes/ }).click();
  await expect(gallery.getByRole("region", { name: "Preview" })).toBeVisible();
  await expectAccessible(page, "template gallery with a template");
  await gallery.getByRole("button", { name: "Create from Meeting notes" }).click();
  await expect(editor(page)).toBeVisible();
  await expect(page.getByText("Not published yet").first()).toBeVisible();
  pagePath = new URL(page.url()).pathname;

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

  await editor(page).click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Secret draft sentence.");
  await expect(page.getByRole("status").getByText("Saved to draft", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText(/changes? since version 1/).first()).toBeVisible();

  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const other = await context.newPage();
    await other.goto("/sign-in");
    await signInWithPassword(other, reader.email, reader.password);
    await expect(other.getByRole("heading", { name: "Spaces", level: 1 })).toBeVisible();
    await other.goto(pagePath);
    await expect(other.getByText("First published sentence.")).toBeVisible();
    await expect(other.getByText("Secret draft sentence.")).toHaveCount(0);
    await expect(other.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expectAccessible(other, "read view of a published page");
  } finally {
    await context.close();
  }
});

test("compares versions and restores an earlier one into the draft", async ({ page }) => {
  await page.goto(`${pagePath}?edit=true`);
  await expect(editor(page)).toBeVisible();
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

test("deletes a page to the trash, restores it and archives it", async ({ page }) => {
  await page.goto(pagePath);
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Move to trash" }).click();
  await expect(page.getByText(/moved to the trash/).first()).toBeVisible();
  await page.goto(`/spaces/${SPACE_KEY}/trash`);
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

test("passes the accessibility check on the new settings screens", async ({ page }) => {
  await page.goto(`/spaces/${SPACE_KEY}/settings/content`);
  await expect(page.getByRole("heading", { name: "Pages and trash", level: 1 })).toBeVisible();
  await expectAccessible(page, "space pages and trash");
  await page.goto(`/spaces/${SPACE_KEY}/settings/templates`);
  await expect(page.getByRole("heading", { name: "Templates", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Create template" }).first().click();
  await expect(page.getByRole("dialog", { name: "New template" })).toBeVisible();
  await expectAccessible(page, "template editor");
  await page.keyboard.press("Escape");
  const organization = await organizationId(page);
  await page.goto(`/settings/organizations/${organization}/content`);
  await expect(page.getByRole("heading", { name: "Pages and trash", level: 1 })).toBeVisible();
  await expectAccessible(page, "organization pages and trash");
  await page.goto(`/settings/organizations/${organization}/templates`);
  await expectAccessible(page, "organization templates");
  await page.goto("/settings/instance/content");
  await expectAccessible(page, "instance pages and trash");
  await page.goto("/settings/instance/templates");
  await expectAccessible(page, "instance templates");
});
