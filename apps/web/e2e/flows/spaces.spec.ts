import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import { BASE_URL, OWNER_STORAGE, readState } from "../support/environment.js";
import { callApi, expectAccessible, linkFrom, signInWithPassword, waitForMail } from "../support/helpers.js";

test.describe.configure({ mode: "serial" });
test.use({ storageState: OWNER_STORAGE });

interface Person {
  id: string;
  name: string;
  email: string;
  password: string;
}

const people: Person[] = [];
let spaceId = "";
let spaceKey = "";
let sharedPage = "";

async function organizationId(page: Page): Promise<string> {
  const stored = readState().organizationId;
  if (stored) return stored;
  const response = await page.request.get("/api/v1/organizations?limit=10");
  return ((await response.json()) as { items: { id: string }[] }).items[0]?.id ?? "";
}

async function invite(page: Page, browser: Browser, name: string): Promise<Person> {
  const email = `${name.toLowerCase().replace(/\s+/g, ".")}.${Date.now()}@pagehall.test`;
  const password = `${name} passphrase for editing`;
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
    return { id: accountId, name, email, password };
  } finally {
    await anonymous.close();
  }
}

async function signedIn(browser: Browser, person: Person): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  await page.goto("/sign-in");
  await signInWithPassword(page, person.email, person.password);
  await expect(page.getByRole("heading", { name: "Spaces", level: 1 })).toBeVisible();
  return { context, page };
}

function editor(page: Page) {
  return page.getByRole("textbox", { name: "Page content" });
}

async function documentText(page: Page): Promise<string> {
  return editor(page).evaluate((element) => {
    const copy = element.cloneNode(true) as HTMLElement;
    for (const caret of copy.querySelectorAll(".ph-remote-caret-anchor")) caret.remove();
    return (copy.textContent ?? "").replace(/[\u2060\s]+/g, " ").trim();
  });
}

async function openEditor(page: Page, path: string) {
  await page.goto(`${path}?edit=true`);
  await expect(editor(page)).toBeEditable();
  await expect(page.getByText("Saved").or(page.getByText("Editing")).first()).toBeVisible();
}

async function waitSaved(page: Page) {
  await expect(page.getByRole("status").getByText("Saved", { exact: true })).toBeVisible({ timeout: 20_000 });
}

test("creates a space and arranges pages, folders and links", async ({ page }) => {
  await page.goto("/spaces");
  await callApi(
    page,
    "PUT",
    `/api/v1/organizations/${await organizationId(page)}/settings/pages.defaultMode`,
    {
      value: "live",
    },
  );
  await expect(page.getByRole("heading", { name: "Spaces", level: 1 })).toBeVisible();
  await expectAccessible(page, "spaces list");
  await page.getByRole("button", { name: "Create space" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Create a space" });
  await dialog.getByLabel("Name").fill("Team Handbook");
  await expect(dialog.getByLabel("Key")).toHaveValue(/^TH\d*$/);
  spaceKey = await dialog.getByLabel("Key").inputValue();
  await expect(dialog.getByText("Who gets access")).toBeVisible();
  await expectAccessible(page, "create space");
  await dialog.getByRole("button", { name: "Create space" }).click();
  await expect(page).toHaveURL(new RegExp(`/spaces/${spaceKey}/pages/`));
  const resolved = (await (await page.request.get(`/api/v1/space-keys/${spaceKey}`)).json()) as {
    space: { id: string };
  };
  spaceId = resolved.space.id;
  const tree = page.getByRole("tree", { name: "Page tree" });
  await expect(tree.getByRole("treeitem", { name: "Team Handbook" })).toBeVisible();

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
  sharedPage = new URL(page.url()).pathname;
  await page.getByRole("button", { name: "Done" }).click();

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

test("writes a page with blocks and shows it in the read view", async ({ page }) => {
  await openEditor(page, sharedPage);
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
  await expect(page.locator(".ph-callout-label").filter({ hasText: "Info" })).toBeVisible();
  const editing = await content.locator("p").first().boundingBox();
  const bar = await page.locator(".ph-editor-bar").boundingBox();
  expect(bar?.x).toBeCloseTo(editing?.x ?? -1, 0);
  expect(bar?.width).toBeCloseTo(editing?.width ?? -1, 0);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("heading", { name: "Set up a new device", level: 2 })).toBeVisible();
  const reading = await page.locator(".ph-read-view p").first().boundingBox();
  expect(editing).not.toBeNull();
  expect(reading?.x).toBeCloseTo(editing?.x ?? -1, 0);
  expect(reading?.width).toBeCloseTo(editing?.width ?? -1, 0);
  await expect(page.locator(".ph-read-view .ph-callout-label")).toHaveText("Info");
  await expect(page.locator("strong", { hasText: "company portal" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Copy its public key" })).toBeVisible();
  await expect(page.getByRole("note", { name: "Info" })).toContainText("Never send a private key by e-mail.");
  await expectAccessible(page, "read view");
});

test("works the toolbar by keyboard alone", async ({ page }) => {
  await openEditor(page, sharedPage);
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

test("lets three people edit one page at the same time without conflicts", async ({ page, browser }) => {
  await page.goto("/spaces");
  for (const name of ["Ada Editor", "Ben Editor"]) people.push(await invite(page, browser, name));
  for (const person of people) {
    await callApi(page, "POST", `/api/v1/spaces/${spaceId}/permissions`, {
      action: "grant",
      principalKind: "account",
      principalId: person.id,
      role: "editor",
    });
  }
  const sessions = [
    { context: page.context(), page },
    ...(await Promise.all(people.map((person) => signedIn(browser, person)))),
  ];
  try {
    await Promise.all(sessions.map((session) => openEditor(session.page, sharedPage)));
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
        if (index === 1) {
          await session.page.keyboard.press("Shift+Home");
          await session.page.keyboard.press("Control+i");
        }
      }),
    );
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
  browser,
}) => {
  const other = await signedIn(browser, people[0] as Person);
  try {
    await openEditor(page, sharedPage);
    await openEditor(other.page, sharedPage);
    await other.context.setOffline(true);
    await expect(other.page.getByText("Offline, changes are kept in this tab")).toBeVisible({
      timeout: 20_000,
    });
    await editor(other.page).click();
    await other.page.keyboard.press("Control+End");
    await other.page.keyboard.type(" Written while offline.");
    await other.page.getByRole("link", { name: "Overview" }).click();
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

test("disconnects a person at once when they lose the edit permission", async ({ page, browser }) => {
  const person = people[1] as Person;
  const other = await signedIn(browser, person);
  try {
    await openEditor(other.page, sharedPage);
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

test("loads the organization settings for Spaces with the whole settings navigation", async ({ page }) => {
  await page.goto(`/settings/organizations/${await organizationId(page)}/spaces`);
  await expect(page.getByRole("heading", { name: "Spaces", level: 1 })).toBeVisible();
  await expect(page.getByText("This page could not be loaded")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Default permissions for new spaces" })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Settings", exact: true });
  await expect(navigation.getByRole("link", { name: "Personal spaces" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Spaces", exact: true })).toBeVisible();
  await navigation.getByRole("link", { name: "Personal spaces" }).click();
  await expect(page.getByRole("heading", { name: "Personal spaces", level: 1 })).toBeVisible();
  await navigation.getByRole("link", { name: "Spaces", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Spaces", level: 1 })).toBeVisible();
  await expect(page.getByText("This page could not be loaded")).toHaveCount(0);
});

test("passes the accessibility check on the space settings", async ({ page }) => {
  await page.goto(`/spaces/${spaceKey}/settings/general`);
  await expect(page.getByRole("heading", { name: "General", level: 1 })).toBeVisible();
  await expectAccessible(page, "space general settings");
  await page.goto(`/spaces/${spaceKey}/settings/permissions`);
  await expect(page.getByRole("heading", { name: "Permissions", level: 1 })).toBeVisible();
  await expectAccessible(page, "space permissions");
  await page.goto(`/settings/organizations/${await organizationId(page)}/spaces`);
  await expect(page.getByRole("heading", { name: "Spaces", level: 1 })).toBeVisible();
  await expectAccessible(page, "organization spaces settings");
  await page.goto("/settings/instance/personal-spaces");
  await expect(page.getByRole("heading", { name: "Personal spaces", level: 1 })).toBeVisible();
  await expectAccessible(page, "personal spaces review");
});
