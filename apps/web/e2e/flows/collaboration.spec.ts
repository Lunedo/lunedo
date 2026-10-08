import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import { BASE_URL, OWNER_STORAGE, readState } from "../support/environment.js";
import {
  callApi,
  expectAccessible,
  linkFrom,
  setAppearance,
  signInWithPassword,
  waitForMail,
} from "../support/helpers.js";

test.describe.configure({ mode: "serial" });
test.use({ storageState: OWNER_STORAGE });

const VARIANTS = [
  { colorMode: "light", language: "en" },
  { colorMode: "dark", language: "de" },
] as const;
const WIDTHS = [1440, 390] as const;

let spaceKey = "CO";
let spaceId = "";
let pageId = "";
let pagePath = "";
let colleague = { id: "", email: "", password: "" };
let colleagueContext: BrowserContext | null = null;

async function organizationId(page: Page): Promise<string> {
  const stored = readState().organizationId;
  if (stored) return stored;
  const response = await page.request.get("/api/v1/organizations?limit=10");
  return ((await response.json()) as { items: { id: string }[] }).items[0]?.id ?? "";
}

async function invite(page: Page, browser: Browser, name: string) {
  const email = `${name.toLowerCase().replace(/\s+/g, ".")}.${Date.now()}@pagehall.test`;
  const password = `${name} passphrase for commenting`;
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

async function colleaguePage(browser: Browser): Promise<Page> {
  if (!colleagueContext) {
    colleagueContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await colleagueContext.newPage();
    await page.goto("/sign-in");
    await signInWithPassword(page, colleague.email, colleague.password);
    await expect(page.getByRole("heading", { name: "For you", level: 1 })).toBeVisible();
    return page;
  }
  return colleagueContext.pages()[0] ?? colleagueContext.newPage();
}

async function captureScreens(page: Page, name: string, path: string) {
  await page.goto(path);
  for (const variant of VARIANTS) {
    await setAppearance(page, variant);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(path);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForLoadState("networkidle");
      await expectAccessible(page, `${name} (${variant.colorMode}, ${variant.language}, ${width})`);
      const file = `${name}-${variant.colorMode}-${variant.language}-${width}.png`;
      await page.screenshot({ fullPage: true, path: test.info().outputPath(file) });
      await test.info().attach(file, { path: test.info().outputPath(file), contentType: "image/png" });
    }
  }
  await setAppearance(page, { colorMode: "light", language: "en" });
  await page.setViewportSize({ width: 1280, height: 900 });
}

test.afterAll(async () => {
  await colleagueContext?.close();
});

test("two people discuss a page with comments, reactions, a mention and a task", async ({
  page,
  browser,
}) => {
  spaceKey = `CO${test.info().retry || ""}`;
  await page.goto("/spaces");
  colleague = await invite(page, browser, "Carla Colleague");
  const space = (await callApi(page, "POST", `/api/v1/organizations/${await organizationId(page)}/spaces`, {
    name: "Collaboration",
    key: spaceKey,
    visibility: "private",
    grants: [{ principalKind: "account", principalId: colleague.id, role: "commenter" }],
  })) as { id: string };
  spaceId = space.id;
  const created = (await callApi(page, "POST", `/api/v1/spaces/${spaceId}/items`, {
    kind: "page",
    title: "VPN access",
    parentId: null,
    mode: "publish",
  })) as { id: string };
  pageId = created.id;
  await callApi(page, "PUT", `/api/v1/pages/${pageId}/content`, {
    document: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hotel Wi-Fi blocks UDP on port 51820." }] },
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { assignee: colleague.id, dueDate: "2026-12-01" },
              content: [{ type: "paragraph", content: [{ type: "text", text: "Test the TCP fallback" }] }],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Ask " },
            { type: "mention", attrs: { id: colleague.id } },
            { type: "text", text: " about hotels." },
          ],
        },
      ],
    },
  });
  await callApi(page, "POST", `/api/v1/pages/${pageId}/publish`, {});
  pagePath = `/spaces/${spaceKey}/pages/${pageId}/vpn-access`;

  const other = await colleaguePage(browser);
  await other.getByRole("button", { name: /Notifications, \d unread/ }).click();
  await expect(other.getByText(/mentioned you in VPN access/)).toBeVisible();
  await expect(other.getByText(/assigned a task in VPN access/)).toBeVisible();
  await other.keyboard.press("Escape");

  await other.goto(pagePath);
  const paragraph = other.getByText("Hotel Wi-Fi blocks UDP on port 51820.");
  await paragraph.selectText();
  await other.getByRole("button", { name: "Comment", exact: true }).click();
  const pending = other.getByRole("region", { name: "Comment on the selected text" });
  await pending.getByRole("textbox", { name: "Comment on the selected text" }).click();
  await other.keyboard.type("Happened twice this week.");
  await pending.getByRole("button", { name: "Comment", exact: true }).click();
  const panel = other.getByRole("complementary", { name: "Comments" });
  await expect(panel.getByText("Happened twice this week.")).toBeVisible();
  await expectAccessible(other, "comments panel");
  for (const width of WIDTHS) {
    await other.setViewportSize({ width, height: 900 });
    await expectAccessible(other, `comments panel at ${width}`);
    await other.screenshot({ path: test.info().outputPath(`comments-panel-${width}.png`) });
  }
  await other.setViewportSize({ width: 1280, height: 720 });

  await page.goto(pagePath);
  await page.getByRole("button", { name: /Comments/ }).click();
  const ownerPanel = page.getByRole("complementary", { name: "Comments" });
  await expect(ownerPanel.getByText("Happened twice this week.")).toBeVisible();
  await ownerPanel.getByRole("button", { name: "Reply", exact: true }).click();
  await ownerPanel.getByRole("textbox", { name: "Reply" }).click();
  await page.keyboard.type("Let us document the fallback.");
  await ownerPanel.getByRole("button", { name: "Reply", exact: true }).last().click();
  await expect(panel.getByText("Let us document the fallback.")).toBeVisible();

  await page.getByRole("button", { name: "Add reaction" }).first().click();
  await page.getByRole("button", { name: "React with 🎉" }).click();
  await expect(other.getByRole("button", { name: /🎉 1/ })).toBeVisible();

  const task = other.getByRole("checkbox", { name: /Mark as done: Test the TCP fallback/ });
  await task.check();
  await expect(page.getByRole("checkbox", { name: /Mark as open: Test the TCP fallback/ })).toBeChecked();

  await other.goto("/tasks?filter=done");
  await expect(other.getByText("Test the TCP fallback")).toBeVisible();
  await expectAccessible(other, "my tasks");
});

test("one task status in the editor, the read view, My tasks, the task report and pasted Markdown", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await page.goto("/spaces");
  const checklist = (await callApi(page, "POST", `/api/v1/spaces/${spaceId}/items`, {
    kind: "page",
    title: "Rollout checklist",
    parentId: null,
    mode: "publish",
  })) as { id: string };
  await callApi(page, "PUT", `/api/v1/pages/${checklist.id}/content`, {
    document: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Before the rollout:" }] },
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { assignee: colleague.id },
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Update the firewall rules" }] },
              ],
            },
          ],
        },
      ],
    },
  });
  await callApi(page, "POST", `/api/v1/pages/${checklist.id}/publish`, {});
  const report = (await callApi(page, "POST", `/api/v1/spaces/${spaceId}/items`, {
    kind: "page",
    title: "Rollout report",
    parentId: null,
    mode: "live",
  })) as { id: string };
  await callApi(page, "PUT", `/api/v1/pages/${report.id}/content`, {
    document: { type: "doc", content: [{ type: "taskReport", attrs: { spaceId, status: "all" } }] },
  });
  const checklistPath = `/spaces/${spaceKey}/pages/${checklist.id}/rollout-checklist`;
  const task = { name: /Update the firewall rules/ };

  const other = await colleaguePage(browser);
  await other.goto(checklistPath);
  const readView = other.getByRole("checkbox", task);
  await page.goto(`${checklistPath}?edit=true`);
  const editorView = page.getByRole("checkbox", task);
  await expect(editorView).toBeEnabled();

  await editorView.click();
  await expect(editorView).toBeChecked();
  await expect(readView).toBeChecked();
  await readView.click();
  await expect(editorView).not.toBeChecked();

  const myTasks = await other.context().newPage();
  await myTasks.goto("/tasks");
  await myTasks.getByRole("checkbox", task).click();
  await expect(readView).toBeChecked();
  await expect(editorView).toBeChecked();

  const reportView = await page.context().newPage();
  await reportView.goto(`/spaces/${spaceKey}/pages/${report.id}/rollout-report`);
  await reportView.getByRole("checkbox", task).click();
  await expect(readView).not.toBeChecked();
  await expect(editorView).not.toBeChecked();
  await myTasks.close();
  await reportView.close();

  await page.getByRole("textbox", { name: "Page content" }).locator("p").last().click();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => navigator.clipboard.writeText("- [x] Order the badges\n- [ ] Book the room"));
  await page.keyboard.press("ControlOrMeta+V");
  await expect(page.getByRole("checkbox", { name: "Mark as open: Order the badges" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Mark as done: Book the room" })).not.toBeChecked();
  await expect(page.getByRole("status").getByText("Saved to draft", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await callApi(page, "POST", `/api/v1/pages/${checklist.id}/publish`, {});
  const pasted = (text: string) =>
    other.getByRole("listitem").filter({ hasText: text }).getByRole("checkbox");
  await expect(pasted("Order the badges")).toBeChecked();
  await expect(pasted("Book the room")).not.toBeChecked();
});

test("schedules a blog post that the job publishes, and pins it in the organization overview", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto(`/spaces/${spaceKey}/blog`);
  await page.getByRole("button", { name: "Write a post" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Title" }).fill("New VPN client from Monday");
  await dialog.getByRole("textbox", { name: "Excerpt" }).fill("Existing tunnels keep working.");
  await expectAccessible(page, "new blog post dialog");
  await dialog.getByRole("button", { name: "Create post" }).click();
  await expect(page.getByRole("textbox", { name: "Page content" })).toBeEditable();
  const postId = /\/blog\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";
  await page.getByRole("textbox", { name: "Page content" }).click();
  await page.keyboard.type("The company portal ships the new client on Monday.");
  await expect(page.getByRole("status").getByText("Saved to draft", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await callApi(page, "PUT", `/api/v1/blog-posts/${postId}/schedule`, {
    at: new Date(Date.now() + 65_000).toISOString(),
    timeZone: "Europe/Vienna",
  });
  await page.goto(`/spaces/${spaceKey}/blog`);
  await expect(
    page.getByRole("region", { name: "Scheduled" }).getByRole("link", { name: "New VPN client from Monday" }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        ((await (await page.request.get(`/api/v1/blog-posts/${postId}`)).json()) as { published: boolean })
          .published,
      { timeout: 180_000, intervals: [5_000] },
    )
    .toBe(true);

  await page.goto("/blog");
  const post = page.getByRole("listitem").filter({ hasText: "New VPN client from Monday" });
  await post.getByRole("button", { name: "Pin New VPN client from Monday" }).click();
  await expect(post.getByText("Pinned", { exact: true })).toBeVisible();
});

test("shows recent pages, starred items, tasks, mentions and new posts on For you", async ({ browser }) => {
  const other = await colleaguePage(browser);
  await other.goto(pagePath);
  await other.getByRole("button", { name: "Star VPN access" }).click();
  await other.goto("/home");
  const main = other.getByRole("main");
  await expect(main.getByRole("link", { name: /VPN access/ }).first()).toBeVisible();
  await expect(main.getByText("New VPN client from Monday")).toBeVisible();
  await expect(
    main.getByRole("region", { name: "Mentions" }).getByRole("link", { name: /VPN access/ }),
  ).toBeVisible();
  await expectAccessible(other, "For you");
});

test("new screens pass the accessibility check in English and German, light and dark, wide and narrow", async ({
  page,
}) => {
  test.setTimeout(300_000);
  await captureScreens(page, "page-with-comments", pagePath);
  await captureScreens(page, "space-blog", `/spaces/${spaceKey}/blog`);
  await captureScreens(page, "organization-blog", "/blog");
  await captureScreens(page, "my-tasks", "/tasks");
  await captureScreens(page, "for-you", "/home");
});
