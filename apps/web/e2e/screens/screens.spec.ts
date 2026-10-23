import { stripVTControlCharacters } from "node:util";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { BASE_URL, OWNER, OWNER_STORAGE } from "../support/environment.js";
import { callApi, setAppearance } from "../support/helpers.js";
import { writeSourceFile } from "../support/imports.js";
import { SIGNED_OUT } from "../support/people.js";
import { type PersonKey, personState, readWorld, type ScreenWorld } from "../support/screen-world.js";
import { capture, type Device, type Language, record, type Screen } from "../support/screens.js";

type Role = "owner" | PersonKey | "signed out";
type Open = (page: Page, language: Language, device: Device) => Promise<void>;

const ROLE_NAMES: Record<Role, string> = {
  owner: "owner and instance administrator",
  lena: "member (Lena Hofer)",
  jonas: "member (Jonas Berger)",
  aylin: "member (Aylin Demir)",
  mateo: "member (Mateo Rossi)",
  sophie: "member (Sophie Wagner)",
  "signed out": "signed out",
};

let cachedWorld: ScreenWorld | undefined;
const world = () => {
  cachedWorld ??= readWorld();
  return cachedWorld;
};
const pages: Page[] = [];

async function pageFor(browser: Browser, role: Role): Promise<Page> {
  const storageState =
    role === "owner" ? OWNER_STORAGE : role === "signed out" ? SIGNED_OUT : personState(role);
  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState,
    locale: "de-DE",
    timezoneId: "Europe/Vienna",
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  pages.push(page);
  return page;
}

function shot(screen: Omit<Screen, "role">, role: Role, open: Open, after?: (page: Page) => Promise<void>) {
  test(`${screen.number} ${screen.title}`, async ({ browser }) => {
    const page = await pageFor(browser, role);
    try {
      await capture(page, { ...screen, role: ROLE_NAMES[role] }, open);
    } finally {
      await after?.(page);
    }
  });
}

test.afterEach(async ({ browserName: _ }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    const reason = stripVTControlCharacters(testInfo.error?.message ?? "unknown error")
      .split("\n")
      .find((line) => line.trim() !== "");
    record({ kind: "failed", title: testInfo.title.replace(/^\d+ /, ""), reason: reason ?? "unknown error" });
  }
  for (const page of pages.splice(0)) await page.context().close();
});

async function heading(page: Page): Promise<void> {
  await expect(page.locator("#main h1, main h1, h1").first()).toBeVisible({ timeout: 30_000 });
}

async function visit(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await heading(page);
}

const rich = () => world().rich;
const organization = () => `/settings/organizations/${world().organizationId}`;
const portal = () => world().knowledgeBase.portal;

async function discardDraft(page: Page, id: string): Promise<void> {
  if (page.url() === "about:blank") await page.goto("/spaces");
  const response = await page.request.post(`/api/v1/pages/${id}/draft/discard`, {
    data: {},
    headers: { "X-Lunedo-Request": "1", origin: BASE_URL },
  });
  expect([200, 204, 404, 409]).toContain(response.status());
}

shot(
  {
    number: "01",
    name: "sign-in",
    title: "Sign-in",
    state: "empty form",
    english: true,
    language: "browser",
  },
  "signed out",
  async (page) => visit(page, "/sign-in"),
);

shot(
  {
    number: "01",
    name: "sign-in-second-factor",
    title: "Sign-in with second factor",
    state: "password accepted, asks for the authenticator code",
    language: "browser",
  },
  "signed out",
  async (page) => {
    await page.goto("/sign-in");
    await page.getByRole("textbox").first().fill(OWNER.email);
    await page.keyboard.press("Enter");
    await page.locator('input[type="password"]').fill(OWNER.password);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/sign-in\/verify/);
    await heading(page);
  },
);

shot(
  {
    number: "02",
    name: "home-personal",
    title: "Home page, personal",
    state: "tasks, mentions and recent pages",
  },
  "lena",
  async (page) => visit(page, "/home"),
);

shot(
  {
    number: "02",
    name: "home-organization",
    title: "Home page, organization",
    state: "home page of the organization",
  },
  "lena",
  async (page) => visit(page, world().general.homePath),
);

shot(
  { number: "03", name: "space-overview", title: "Space overview", state: "overview page with page tree" },
  "owner",
  async (page) => {
    await page.goto(world().it.overviewPath);
    await expect(page.getByRole("tree").first()).toBeVisible();
    await heading(page);
  },
);

async function openRich(page: Page): Promise<void> {
  await page.goto(rich().path);
  await heading(page);
  await expect(page.locator('figure.ld-diagram[data-diagram="drawio"] img')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('figure.ld-diagram[data-diagram="mermaid"] img')).toBeVisible({
    timeout: 30_000,
  });
}

shot(
  {
    number: "04",
    name: "page-view",
    title: "Page view with page tree, rich page",
    state: "published page with table, panels, code, image, diagrams, tasks, mentions and include",
    phone: true,
    english: true,
  },
  "owner",
  openRich,
);

shot(
  {
    number: "06",
    name: "comments-panel",
    title: "Comments panel",
    state: "panel open with a page comment and an inline thread",
  },
  "owner",
  async (page) => {
    await openRich(page);
    await page
      .getByRole("button", { name: /^(Kommentare|Comments)/ })
      .first()
      .click();
    await expect(page.getByRole("complementary", { name: /^(Kommentare|Comments)$/ })).toBeVisible();
  },
);

shot(
  {
    number: "06",
    name: "inline-comment",
    title: "Inline comment",
    state: "highlighted text with its thread open",
    fullPage: false,
  },
  "owner",
  async (page) => {
    await openRich(page);
    const mark = page.locator("[data-thread-id]").first();
    await mark.scrollIntoViewIfNeeded();
    await mark.click();
    await expect(page.getByRole("complementary", { name: /^(Kommentare|Comments)$/ })).toBeVisible();
  },
);

shot(
  {
    number: "07",
    name: "version-history",
    title: "Version history",
    state: "list of versions, latest selected",
  },
  "owner",
  async (page) => visit(page, `/spaces/IT/pages/${rich().id}/history`),
);

shot(
  {
    number: "07",
    name: "version-comparison",
    title: "Comparison of two versions",
    state: "version 1 against version 2, side by side",
  },
  "owner",
  async (page) => visit(page, `/spaces/IT/pages/${rich().id}/history?from=1&to=2&view=sideBySide`),
);

shot(
  {
    number: "08",
    name: "quick-search",
    title: "Quick search dialog",
    state: "dialog open with results for VPN",
    fullPage: false,
  },
  "owner",
  async (page) => {
    await visit(page, "/home");
    await page.keyboard.press("/");
    const dialog = page.getByRole("dialog", { name: /^(Suche|Search)$/ });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("combobox").fill("VPN");
    await expect(dialog.getByRole("option").nth(2)).toBeVisible({ timeout: 20_000 });
  },
);

shot(
  {
    number: "08",
    name: "search-results",
    title: "Search results page with filters",
    state: "results for VPN",
    phone: true,
  },
  "owner",
  async (page) => {
    await visit(page, "/search?q=VPN");
    await expect(page.getByRole("region").getByRole("link").first()).toBeVisible({ timeout: 20_000 });
  },
);

shot(
  {
    number: "09",
    name: "notifications",
    title: "Notifications",
    state: "panel open with mentions, a task, comments, a share and meeting notes",
    phone: true,
    fullPage: false,
  },
  "lena",
  async (page) => {
    await visit(page, "/home");
    await page
      .getByRole("button", { name: /^(Benachrichtigungen|Notifications)/ })
      .first()
      .click();
    const panel = page.getByRole("complementary", { name: /^(Benachrichtigungen|Notifications)$/ });
    await expect(panel.getByRole("listitem").first()).toBeVisible({ timeout: 20_000 });
  },
);

shot(
  {
    number: "05",
    name: "editor",
    title: "Editor with toolbar",
    state: "rich page in edit mode",
  },
  "owner",
  async (page) => {
    await page.goto(`${rich().path}?edit=true`);
    await expect(page.getByRole("textbox", { name: /^(Seiteninhalt|Page content)$/ })).toBeEditable({
      timeout: 30_000,
    });
  },
  async (page) => discardDraft(page, rich().id),
);

shot(
  {
    number: "05",
    name: "editor-slash-menu",
    title: "Editor, slash menu open",
    state: "slash menu listing the blocks",
    fullPage: false,
  },
  "owner",
  async (page) => {
    await page.goto(`${rich().path}?edit=true`);
    const content = page.getByRole("textbox", { name: /^(Seiteninhalt|Page content)$/ });
    await expect(content).toBeEditable({ timeout: 30_000 });
    await content.click();
    await content.press("Control+End");
    await content.press("Enter");
    await page.locator('[data-diagram="mermaid"]').scrollIntoViewIfNeeded();
    await page.keyboard.type("/");
    await expect(page.getByRole("listbox", { name: /^(Blöcke|Blocks)$/ })).toBeVisible();
  },
  async (page) => discardDraft(page, rich().id),
);

shot(
  {
    number: "05",
    name: "editor-block-menu",
    title: "Editor, block menu open",
    state: "table menu with the rows menu open (the editor has no other block menu)",
    fullPage: false,
  },
  "owner",
  async (page) => {
    await page.goto(`${rich().path}?edit=true`);
    await expect(page.getByRole("textbox", { name: /^(Seiteninhalt|Page content)$/ })).toBeEditable({
      timeout: 30_000,
    });
    await page.getByText("Büro-Arbeitsplätze").click();
    const menu = page.getByRole("toolbar", { name: /^(Tabelle|Table)$/ });
    await expect(menu).toBeVisible();
    await menu.getByRole("button", { name: /^(Zeilen|Rows)$/ }).click();
    await expect(page.getByRole("menu")).toBeVisible();
  },
  async (page) => discardDraft(page, rich().id),
);

shot(
  {
    number: "12",
    name: "drawio-editor",
    title: "Diagram editor (draw.io)",
    state: "network diagram open in draw.io",
    fullPage: false,
  },
  "owner",
  async (page) => {
    await page.goto(`${rich().path}?edit=true`);
    await expect(page.getByRole("textbox", { name: /^(Seiteninhalt|Page content)$/ })).toBeEditable({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: /^(In draw\.io bearbeiten|Edit in draw\.io)$/ }).click();
    await expect(page.getByRole("dialog", { name: /draw\.io/ })).toBeVisible();
    await expect(
      page
        .frameLocator('iframe[title="draw.io editor"], iframe[title="draw.io-Editor"]')
        .locator(".geSidebarContainer a.geItem")
        .first(),
    ).toBeVisible({
      timeout: 60_000,
    });
    await page.waitForTimeout(2000);
  },
  async (page) => discardDraft(page, rich().id),
);

shot(
  {
    number: "10",
    name: "template-gallery",
    title: "Template gallery",
    state: "gallery with the space template selected",
    fullPage: false,
  },
  "owner",
  async (page) => {
    await page.goto(world().it.overviewPath);
    await heading(page);
    await page.getByRole("button", { name: /^(In diesem Space erstellen|Create in this space)$/ }).click();
    await page.getByRole("menuitem", { name: /^(Neue Seite|New page)$/ }).click();
    const dialog = page.getByRole("dialog").first();
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: new RegExp(world().templateName) })
      .first()
      .click();
  },
);

shot(
  {
    number: "10",
    name: "template-editor",
    title: "Template editor",
    state: "space template open for editing",
    fullPage: false,
  },
  "owner",
  async (page) => {
    await visit(page, "/spaces/IT/settings/templates");
    await page
      .getByRole("button", { name: new RegExp(`(Aktionen für|Actions for) ${world().templateName}`) })
      .click();
    await page.getByRole("menuitem", { name: /bearbeiten|edit/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  },
);

shot(
  {
    number: "11",
    name: "whiteboard",
    title: "Whiteboard with content",
    state: "floor plan with shapes, labels and arrows",
    fullPage: false,
  },
  "owner",
  async (page) => {
    await page.goto(world().whiteboard.path);
    const canvas = page.locator("canvas.excalidraw__canvas.interactive");
    await expect(canvas).toBeVisible({ timeout: 30_000 });
    await canvas.click({ position: { x: 20, y: 300 } });
    await page.keyboard.press("Shift+1");
    await page.waitForTimeout(1500);
  },
);

shot(
  {
    number: "13",
    name: "share-dialog",
    title: "Sharing and restrictions dialog",
    state: "restricted page shared with people and a group",
    fullPage: false,
  },
  "owner",
  async (page) => {
    await visit(page, world().personal.salary.path);
    await page.getByRole("button", { name: /^(Freigeben|Share)$/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  },
);

shot(
  { number: "13", name: "access-overview", title: "Access overview", state: "what Lena Hofer can do" },
  "owner",
  async (page) => {
    await visit(page, `${organization()}/access`);
    await page.getByRole("combobox", { name: /^Person/ }).fill("Lena");
    await page.getByRole("option", { name: /Lena Hofer/ }).click();
    await expect(page.getByRole("region", { name: /Lena Hofer/ })).toBeVisible({ timeout: 20_000 });
  },
);

shot({ number: "14", name: "trash", title: "Trash", state: "two deleted pages" }, "owner", async (page) =>
  visit(page, "/spaces/IT/trash"),
);

shot(
  { number: "15", name: "meeting-series", title: "Meeting series page", state: "weekly series with topics" },
  "owner",
  async (page) => visit(page, `/spaces/IT/meetings/${world().seriesId}`),
);

shot(
  {
    number: "16",
    name: "import-first-step",
    title: "Import assistant, first step",
    state: "choice of the source",
  },
  "owner",
  async (page) => {
    await visit(page, `${organization()}/imports`);
    await page
      .getByRole("button", { name: /^(Neuer Import|New import)$/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/imports\/[0-9a-f-]+\/setup/);
    await heading(page);
  },
);

shot(
  {
    number: "16",
    name: "import-check-step",
    title: "Import assistant, check step",
    state: "Markdown folder ready to start",
  },
  "owner",
  async (page) => {
    const archive = test.info().outputPath("handbuch.zip");
    await writeSourceFile("markdown", archive);
    await page.goto(`${organization()}/imports`);
    await setAppearance(page, { language: "en" });
    await page.reload();
    await page.getByRole("button", { name: "New import" }).first().click();
    await expect(page).toHaveURL(/\/imports\/[0-9a-f-]+\/setup/);
    await page.getByRole("radio", { name: /Markdown folder/ }).check();
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Upload", level: 1 })).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles(archive);
    await expect(page.getByText("Export read")).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Space", level: 1 })).toBeVisible();
    await page.getByLabel("Name", { exact: true }).fill("Handbuch Lager");
    await page.getByLabel("Key", { exact: true }).fill("LAGER");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("heading", { name: "Check and start", level: 1 })).toBeVisible();
    await setAppearance(page, { language: "de" });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Prüfen und starten", level: 1 })).toBeVisible();
  },
);

shot(
  {
    number: "16",
    name: "export-dialog",
    title: "Export dialog",
    state: "export of the rich page",
    fullPage: false,
  },
  "owner",
  async (page) => {
    await openRich(page);
    await page.getByRole("button", { name: /^(Weitere Aktionen|More actions)$/ }).click();
    await page.getByRole("menuitem", { name: /^(Exportieren|Export)$/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  },
);

for (const [tab, title] of [
  ["general", "General"],
  ["permissions", "Permissions"],
  ["access", "Access"],
  ["content", "Pages and trash"],
  ["status", "Page status"],
  ["shortcuts", "Shortcuts"],
  ["chat", "Chat channels"],
  ["templates", "Templates"],
  ["export", "Export"],
] as const) {
  shot(
    { number: "17", name: `space-settings-${tab}`, title: `Space settings, ${title}`, state: "IT space" },
    "owner",
    async (page) => visit(page, `/spaces/IT/settings/${tab}`),
  );
}

for (const [tab, title, state] of [
  ["members", "Members", "six members"],
  ["groups", "Groups", "three groups"],
  ["roles", "Roles", "built-in roles and the custom role Redaktion"],
  ["audit-log", "Audit log", "events of the seeding"],
] as const) {
  shot(
    { number: "18", name: `organization-${tab}`, title: `Organization administration, ${title}`, state },
    "owner",
    async (page) => visit(page, `${organization()}/${tab}`),
  );
}

for (const [tab, title] of [
  ["general", "Overview"],
  ["backups", "Backups"],
  ["status", "System status"],
  ["storage", "Storage"],
] as const) {
  shot(
    { number: "19", name: `instance-${tab}`, title: `Instance settings, ${title}`, state: "fresh instance" },
    "owner",
    async (page) => visit(page, `/settings/instance/${tab}`),
  );
}

shot(
  {
    number: "20",
    name: "preferences",
    title: "Personal settings, preferences",
    state: "defaults",
    english: true,
  },
  "owner",
  async (page) => visit(page, "/settings/preferences"),
);

shot(
  {
    number: "20",
    name: "security",
    title: "Personal settings, security",
    state: "authenticator app set up",
    english: true,
  },
  "owner",
  async (page) => visit(page, "/settings/security"),
);

shot(
  { number: "21", name: "empty-space", title: "Empty state, new space without pages", state: "new space" },
  "owner",
  async (page) => visit(page, `/spaces/${world().empty.key}`),
);

shot(
  {
    number: "21",
    name: "search-no-results",
    title: "Empty state, search without results",
    state: "query without hits",
  },
  "owner",
  async (page) => {
    await visit(page, "/search?q=Parkausweis");
    await expect(page.getByRole("region").first()).toBeVisible();
  },
);

shot(
  { number: "21", name: "not-found", title: "404 page", state: "unknown address" },
  "owner",
  async (page) => {
    await page.goto("/diese-seite-gibt-es-nicht");
    await expect(page.getByText(/^(Seite nicht gefunden|Page not found)$/)).toBeVisible();
  },
);

shot(
  {
    number: "22",
    name: "knowledge-base",
    title: "Knowledge base start in the app",
    state: "three categories, ten articles",
  },
  "owner",
  async (page) => visit(page, `/spaces/${world().knowledgeBase.key}`),
);

shot(
  {
    number: "22",
    name: "article-editor",
    title: "Article editor with required sections",
    state: "how-to article in edit mode",
  },
  "owner",
  async (page) => {
    await page.goto(`${world().knowledgeBase.article.path}?edit=true`);
    await expect(page.getByRole("textbox", { name: /^(Seiteninhalt|Page content)$/ })).toBeEditable({
      timeout: 30_000,
    });
  },
  async (page) => discardDraft(page, world().knowledgeBase.article.id),
);

shot(
  { number: "22", name: "review-list", title: "Review list", state: "three articles due" },
  "owner",
  async (page) => visit(page, `/spaces/${world().knowledgeBase.key}/reviews`),
);

shot(
  {
    number: "23",
    name: "portal-start",
    title: "Portal, start page",
    state: "public knowledge base",
    phone: true,
    english: true,
    language: "content",
  },
  "signed out",
  async (page, language) => visit(page, language === "en" ? `${portal()}/en/` : `${portal()}/`),
);

shot(
  {
    number: "23",
    name: "portal-category",
    title: "Portal, category",
    state: "category with four articles",
    language: "content",
  },
  "signed out",
  async (page) => visit(page, `${portal()}/topics/${world().knowledgeBase.categoryId}`),
);

shot(
  {
    number: "23",
    name: "portal-article",
    title: "Portal, article",
    state: "how-to article",
    phone: true,
    language: "content",
  },
  "signed out",
  async (page) => visit(page, `${portal()}/${world().knowledgeBase.article.address}`),
);

shot(
  {
    number: "23",
    name: "portal-search",
    title: "Portal, search results",
    state: "results for VPN",
    phone: true,
    language: "content",
  },
  "signed out",
  async (page) => {
    await expect
      .poll(
        async () => {
          await page.goto(`${portal()}/search?q=VPN`);
          return page.locator(`a[href*="${world().knowledgeBase.article.address}"]`).count();
        },
        { timeout: 60_000, intervals: [1000, 2000] },
      )
      .toBeGreaterThan(0);
    await heading(page);
  },
);

shot(
  {
    number: "23",
    name: "portal-contact",
    title: "Portal, contact",
    state: "contact page",
    language: "content",
  },
  "signed out",
  async (page) => visit(page, `${portal()}/contact`),
);

shot(
  {
    number: "23",
    name: "portal-sign-in",
    title: "Portal, sign-in",
    state: "sign-in page",
    language: "content",
  },
  "signed out",
  async (page) => visit(page, `${portal()}/sign-in`),
);

shot(
  {
    number: "19",
    name: "instance-maintenance",
    title: "Instance settings, maintenance mode on",
    state: "maintenance mode on, banner visible",
  },
  "owner",
  async (page) => {
    await page.goto("/settings/instance/maintenance");
    await callApi(page, "PUT", "/api/v1/instance/maintenance", {
      enabled: true,
      message: "Update auf die neue Version bis 18:00 Uhr.",
    });
    await visit(page, "/settings/instance/maintenance");
    await expect(page.getByText("Update auf die neue Version bis 18:00 Uhr.").first()).toBeVisible();
  },
  async (page) => {
    if (page.url() === "about:blank") await page.goto("/settings/instance/maintenance");
    await callApi(page, "PUT", "/api/v1/instance/maintenance", { enabled: false });
  },
);
