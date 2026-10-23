import type { Page } from "@playwright/test";
import { expect, type Organization, test } from "../support/fixtures.js";
import { callApi, expectAccessible } from "../support/helpers.js";
import { type Person, unique } from "../support/people.js";

test.use({ instanceAdministrator: true });

interface Handbook {
  spaceId: string;
  spaceKey: string;
  pagePath: string;
}

const WRITTEN_PAGE = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Set up a new device" }] },
    { type: "paragraph", content: [{ type: "text", text: "Install the client from the company portal." }] },
  ],
};

async function handbook(page: Page, organization: Organization, document?: unknown): Promise<Handbook> {
  await page.goto("/spaces");
  const spaceKey = `TH${unique()}`;
  const space = (await callApi(page, "POST", `/api/v1/organizations/${organization.id}/spaces`, {
    name: "Team Handbook",
    key: spaceKey,
    visibility: "organization",
    grants: [{ principalKind: "organizationMembers", principalId: null, role: "editor" }],
  })) as { id: string };
  const created = (await callApi(page, "POST", `/api/v1/spaces/${space.id}/items`, {
    kind: "page",
    title: "VPN access",
    parentId: null,
    mode: "live",
  })) as { id: string };
  if (document) await callApi(page, "PUT", `/api/v1/pages/${created.id}/content`, { document });
  return { spaceId: space.id, spaceKey, pagePath: `/spaces/${spaceKey}/pages/${created.id}/vpn-access` };
}

async function editors(page: Page, spaceId: string, people: Person[]): Promise<void> {
  for (const person of people) {
    await callApi(page, "POST", `/api/v1/spaces/${spaceId}/permissions`, {
      action: "grant",
      principalKind: "account",
      principalId: person.id,
      role: "editor",
    });
  }
}

function editor(page: Page) {
  return page.getByRole("textbox", { name: "Page content" });
}

async function documentText(page: Page): Promise<string> {
  return editor(page).evaluate((element) => {
    const copy = element.cloneNode(true) as HTMLElement;
    for (const caret of copy.querySelectorAll(".ld-remote-caret-anchor")) caret.remove();
    return (copy.textContent ?? "").replace(/[\u2060\s]+/g, " ").trim();
  });
}

async function openEditor(page: Page, path: string) {
  await page.goto(`${path}?edit=true`);
  await expect(editor(page)).toBeEditable();
  await expect(editor(page)).toHaveAttribute("contenteditable", "true");
  await expect(page.getByText("Saved").or(page.getByText("Editing")).first()).toBeVisible();
}

async function waitSaved(page: Page) {
  await expect(page.getByRole("status").getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 });
}

test("creates a space and arranges pages, folders and links", async ({ page, organization }) => {
  await page.goto("/spaces");
  await callApi(page, "PUT", `/api/v1/organizations/${organization.id}/settings/pages.defaultMode`, {
    value: "live",
  });
  await expect(page.getByRole("heading", { name: "Spaces", level: 1 })).toBeVisible();
  await expectAccessible(page, "spaces list");
  await page.getByRole("button", { name: "Create space" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Create a space" });
  await dialog.getByLabel("Name").fill("Team Handbook");
  await expect(dialog.getByLabel("Key")).toHaveValue(/^TH\d*$/);
  const spaceKey = await dialog.getByLabel("Key").inputValue();
  await expect(dialog.getByText("Who gets access")).toBeVisible();
  await expectAccessible(page, "create space");
  await dialog.getByRole("button", { name: "Create space" }).click();
  await expect(page).toHaveURL(new RegExp(`/spaces/${spaceKey}/pages/`));
  const tree = page.getByRole("tree", { name: "Page tree" });
  await expect(page.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  await expect(tree).not.toHaveAttribute("aria-busy", "true");
  await expect(tree.getByRole("treeitem", { name: "Team Handbook" })).toHaveCount(0);

  await page.getByRole("button", { name: "Create in this space" }).click();
  await page.getByRole("menuitem", { name: "New folder" }).click();
  const folderDialog = page.getByRole("dialog", { name: "New folder" });
  await folderDialog.getByLabel("Title", { exact: true }).fill("Runbooks");
  await folderDialog.getByRole("button", { name: "Create folder" }).click();
  await expect(page.getByRole("heading", { name: "Runbooks" })).toBeVisible();
  await expectAccessible(page, "folder");

  await page.getByRole("button", { name: "Create in this space" }).click();
  await page.getByRole("menuitem", { name: "New page" }).click();
  const gallery = page.getByRole("dialog", { name: "Create in Team Handbook" });
  await expectAccessible(page, "template gallery");
  await gallery.getByRole("button", { name: "Create blank page" }).click();
  const title = page.getByRole("textbox", { name: "Page title" });
  await expect(title).toBeFocused();
  await title.fill("VPN access");
  await title.press("Enter");
  await expect(tree.getByRole("treeitem", { name: "VPN access" })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();

  const vpn = tree.getByRole("treeitem", { name: "VPN access" });
  const runbooks = tree.getByRole("treeitem", { name: "Runbooks" });
  await vpn.dragTo(runbooks);
  await expect(runbooks).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("VPN access moved", { exact: true }).first()).toBeVisible();
  await page.getByRole("region", { name: "Notifications" }).getByRole("button", { name: "Undo" }).click();
  await expect(runbooks).not.toHaveAttribute("aria-expanded", "true");

  await vpn.focus();
  await page.keyboard.press("Shift+F10");
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Move…" }).click();
  const move = page.getByRole("dialog", { name: "Move VPN access" });
  await expectAccessible(page, "move dialog");
  await move.getByRole("combobox", { name: "Place below" }).click();
  await page.keyboard.type("Runbooks");
  await page.getByRole("option", { name: /Runbooks/ }).click();
  await move.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByText("VPN access moved", { exact: true }).first()).toBeVisible();
  await expect(tree.getByRole("treeitem", { name: "VPN access" })).toHaveAttribute("aria-level", "2");

  await page.getByRole("button", { name: "Create in this space" }).click();
  await page.getByRole("menuitem", { name: "New link" }).click();
  const linkDialog = page.getByRole("dialog", { name: "New link" });
  await linkDialog.getByRole("radio", { name: "Web address" }).click();
  await linkDialog.getByLabel("Address", { exact: true }).fill("https://status.example.org");
  await linkDialog.getByLabel("Title", { exact: true }).fill("Status page");
  await linkDialog.getByRole("button", { name: "Create link" }).click();
  await expect(tree.getByRole("treeitem", { name: "Status page" })).toBeVisible();
});

test("writes a page with blocks and shows it in the read view", async ({ page, organization }) => {
  await openEditor(page, (await handbook(page, organization)).pagePath);
  await expectAccessible(page, "editor");
  const content = editor(page);
  await content.click();
  await page.keyboard.type("## Set up a new device");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Install the client from the ");
  await page.keyboard.press("Control+b");
  await page.keyboard.type("company portal");
  await page.keyboard.press("Control+b");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- Create a tunnel");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Copy its public key");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/info");
  await expect(page.getByRole("option", { name: /Info panel/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.type("Never send a private key by e-mail.");
  await waitSaved(page);
  await expect(page.locator(".ld-callout-label").filter({ hasText: "Info" })).toBeVisible();
  const editing = await content.locator("p").first().boundingBox();
  const bar = await page.getByRole("toolbar", { name: "Formatting" }).boundingBox();
  const middle = (box: { x: number; width: number } | null) => (box ? box.x + box.width / 2 : -1);
  expect(Math.abs(middle(bar) - middle(editing))).toBeLessThan(40);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Set up a new device", level: 2 })).toBeVisible();
  const reading = await page.locator(".ld-read-view p").first().boundingBox();
  expect(editing).not.toBeNull();
  expect(reading?.x).toBeCloseTo(editing?.x ?? -1, 0);
  expect(reading?.width).toBeCloseTo(editing?.width ?? -1, 0);
  await expect(page.locator(".ld-read-view .ld-callout-label")).toHaveText("Info");
  await expect(page.locator("strong", { hasText: "company portal" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Copy its public key" })).toBeVisible();
  await expect(page.getByRole("note", { name: "Info" })).toContainText("Never send a private key by e-mail.");
  await expectAccessible(page, "read view");
});

test("works the toolbar by keyboard alone", async ({ page, organization }) => {
  await openEditor(page, (await handbook(page, organization, WRITTEN_PAGE)).pagePath);
  await editor(page).click();
  await page.keyboard.press("Alt+F10");
  const toolbar = page.getByRole("toolbar", { name: "Formatting" });
  await expect(toolbar.getByRole("button", { name: /Undo/ })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(toolbar.getByRole("button", { name: /Redo/ })).toBeFocused();
  await page.keyboard.press("End");
  await expect(toolbar.locator(":focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(editor(page)).toBeFocused();
});

test("lets three people edit one page at the same time without conflicts", async ({ page, organization }) => {
  const { spaceId, pagePath } = await handbook(page, organization, WRITTEN_PAGE);
  const people = [await organization.invite("Ada"), await organization.invite("Ben")];
  await editors(page, spaceId, people);
  const sessions = [
    { context: page.context(), page },
    ...(await Promise.all(people.map((person) => organization.signIn(person)))),
  ];
  try {
    await Promise.all(sessions.map((session) => openEditor(session.page, pagePath)));
    for (const session of sessions) {
      await expect(session.page.getByRole("list", { name: "3 people on this page" })).toBeVisible({
        timeout: 15_000,
      });
    }
    await Promise.all(
      sessions.map(async (session, index) => {
        await editor(session.page).click();
        await session.page.keyboard.press("Control+End");
        await session.page.keyboard.press("Enter");
        for (let round = 0; round < 3; round++) {
          await session.page.keyboard.type(`Writer ${index + 1} line ${round + 1} `, { delay: 15 });
        }
      }),
    );
    for (const session of sessions) {
      for (let index = 1; index <= 3; index++) {
        await expect.poll(() => documentText(session.page)).toContain(`Writer ${index} line 3`);
      }
    }
    const formatting = sessions[1]?.page ?? page;
    await formatting.keyboard.press("Shift+Home");
    await formatting.keyboard.press("Control+i");
    await Promise.all(sessions.map((session) => waitSaved(session.page)));
    const texts = await Promise.all(sessions.map((session) => documentText(session.page)));
    expect(texts[1]).toBe(texts[0]);
    expect(texts[2]).toBe(texts[0]);
    for (let index = 1; index <= 3; index++) expect(texts[0]).toContain(`Writer ${index} line 3`);
    const stored = await page.request.get(`/api/v1/items?q=VPN&spaceId=${spaceId}`);
    const pageId = ((await stored.json()) as { id: string }[])[0]?.id ?? "";
    const markdown = (await (await page.request.get(`/api/v1/pages/${pageId}/markdown`)).json()) as {
      markdown: string;
    };
    expect(markdown.markdown).toMatch(/\*[^*]*Writer/);
    const plain = markdown.markdown.replace(/[*_]/g, "");
    for (let index = 1; index <= 3; index++) expect(plain).toContain(`Writer ${index} line 3`);
  } finally {
    for (const session of sessions.slice(1)) await session.context.close();
  }
});

test("keeps offline changes across leaving the page and brings them in when it reconnects", async ({
  page,
  organization,
}) => {
  const { spaceId, pagePath } = await handbook(page, organization, WRITTEN_PAGE);
  const person = await organization.invite("Ada");
  await editors(page, spaceId, [person]);
  const other = await organization.signIn(person);
  try {
    await openEditor(page, pagePath);
    await openEditor(other.page, pagePath);
    await other.context.setOffline(true);
    await expect(other.page.getByText("Offline, changes are kept in this tab")).toBeVisible({
      timeout: 20_000,
    });
    await editor(other.page).click();
    await other.page.keyboard.press("Control+End");
    await other.page.keyboard.type(" Written while offline.");
    await other.page.getByRole("link", { name: "Overview" }).click();
    await expect(other.page).not.toHaveURL(new RegExp(pagePath));
    await expect(editor(other.page)).toBeHidden();
    await other.page.goBack();
    await expect(editor(other.page)).toContainText("Written while offline.");
    await editor(page).click();
    await page.keyboard.press("Control+Home");
    await page.keyboard.type("Written online meanwhile. ");
    await waitSaved(page);
    await other.context.setOffline(false);
    await waitSaved(other.page);
    await waitSaved(page);
    await expect
      .poll(async () => documentText(page), { timeout: 20_000 })
      .toContain("Written while offline.");
    expect(await documentText(other.page)).toBe(await documentText(page));
  } finally {
    await other.context.close();
  }
});

test("disconnects a person at once when they lose the edit permission", async ({ page, organization }) => {
  const { spaceId, pagePath } = await handbook(page, organization, WRITTEN_PAGE);
  const person = await organization.invite("Ben");
  await editors(page, spaceId, [person]);
  const other = await organization.signIn(person);
  try {
    await openEditor(other.page, pagePath);
    await page.goto("/spaces");
    const permissions = (await (await page.request.get(`/api/v1/spaces/${spaceId}/permissions`)).json()) as {
      id: string;
      principalKind: string;
      principalId: string | null;
    }[];
    const members = permissions.find((entry) => entry.principalKind === "organizationMembers");
    await callApi(page, "POST", `/api/v1/spaces/${spaceId}/permissions`, {
      action: "remove",
      permissionId: members?.id ?? "",
    });
    await expect(editor(other.page)).toBeVisible();
    const own = permissions.find((entry) => entry.principalId === person.id);
    await callApi(page, "POST", `/api/v1/spaces/${spaceId}/permissions`, {
      action: "change",
      permissionId: own?.id ?? "",
      role: "reader",
    });
    await expect(other.page.getByText("You can no longer edit this page")).toBeVisible({ timeout: 10_000 });
    await expect(other.page.getByRole("status").getByText("Saved", { exact: true })).toBeHidden();
  } finally {
    await other.context.close();
  }
});

test("loads the organization settings for Spaces from the organization settings navigation", async ({
  page,
  organization,
}) => {
  await page.goto(`/settings/organizations/${organization.id}/spaces`);
  await expect(page.getByRole("heading", { name: "Spaces", level: 1 })).toBeVisible();
  await expect(page.getByText("This page could not be loaded")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Default permissions for new spaces" })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Settings", exact: true });
  await expect(navigation.getByRole("link", { name: "Spaces", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(navigation.getByRole("link", { name: "Personal spaces" })).toHaveCount(0);
  await navigation.getByRole("link", { name: "Pages and trash" }).click();
  await expect(page.getByRole("heading", { name: "Pages and trash", level: 1 })).toBeVisible();
  await navigation.getByRole("link", { name: "Spaces", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Spaces", level: 1 })).toBeVisible();
  await expect(page.getByText("This page could not be loaded")).toHaveCount(0);
});

test("passes the accessibility check on the space settings", async ({ page, organization }) => {
  const { spaceKey } = await handbook(page, organization);
  await page.goto(`/spaces/${spaceKey}/settings/general`);
  await expect(page.getByRole("heading", { name: "General", level: 1 })).toBeVisible();
  await expectAccessible(page, "space general settings");
  await page.goto(`/spaces/${spaceKey}/settings/permissions`);
  await expect(page.getByRole("heading", { name: "Permissions", level: 1 })).toBeVisible();
  await expectAccessible(page, "space permissions");
  await page.goto(`/settings/organizations/${organization.id}/spaces`);
  await expect(page.getByRole("heading", { name: "Spaces", level: 1 })).toBeVisible();
  await expectAccessible(page, "organization spaces settings");
  await page.goto("/settings/instance/personal-spaces");
  await expect(page.getByRole("heading", { name: "Personal spaces", level: 1 })).toBeVisible();
  await expectAccessible(page, "personal spaces review");
});
