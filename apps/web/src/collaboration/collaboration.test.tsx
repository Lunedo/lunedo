import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "../app.js";
import { initI18n } from "../i18n/index.js";
import { mockApi, type RecordedRequest } from "../testing/render.js";

const OLIVIA = {
  id: "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c",
  email: "olivia@example.org",
  name: "Olivia Owner",
};
const LUKAS = "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7d";
const ORGANIZATION = {
  id: "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f",
  name: "Platform Team",
  slug: "platform-team",
  logoRef: null,
  language: "en",
  timeZone: "Europe/Vienna",
  accentColor: "petrol",
  createdAt: "2026-10-01T08:00:00.000Z",
  membershipKind: "member",
};
const SPACE_ID = "01929b1e-0000-7000-8000-0000000000a1";
const OVERVIEW = "01929b1e-0000-7000-8000-0000000000b0";
const VPN = "01929b1e-0000-7000-8000-0000000000b2";
const POST = "01929b1e-0000-7000-8000-0000000000b3";
const THREAD = "01929b1e-0000-7000-8000-0000000000c1";
const MY_TASK = "01929b1e-0000-7000-8000-0000000000d1";
const OTHER_TASK = "01929b1e-0000-7000-8000-0000000000d2";

type Role = "reader" | "commenter" | "editor" | "admin";

const space = (role: Role) => ({
  id: SPACE_ID,
  key: "ITOPS",
  name: "IT Operations",
  description: "",
  visibility: "private",
  organizationId: ORGANIZATION.id,
  organizationName: ORGANIZATION.name,
  personal: false,
  ownerId: null,
  ownerName: null,
  overviewItemId: OVERVIEW,
  archived: false,
  createdAt: "2026-10-05T08:00:00.000Z",
  updatedAt: "2026-10-05T08:00:00.000Z",
  role,
});

const NUMBERS: Record<string, number> = { [OVERVIEW]: 1040, [VPN]: 1042, [POST]: 1043 };

const item = (id: string, title: string, kind = "page") => ({
  id,
  number: NUMBERS[id] ?? 1099,
  spaceId: SPACE_ID,
  parentId: null,
  kind,
  title,
  description: "",
  width: "fixed",
  mode: "publish",
  published: true,
  archived: false,
  position: "a0",
  hasChildren: false,
  viewRestriction: "none",
  editRestricted: false,
  link: null,
  creatorId: OLIVIA.id,
  ownerId: OLIVIA.id,
  createdAt: "2026-10-05T08:00:00.000Z",
  updatedAt: "2026-10-05T08:00:00.000Z",
  contentUpdatedAt: "2026-10-05T08:00:00.000Z",
  spaceKey: "ITOPS",
  spaceName: "IT Operations",
  ancestors: [],
});

const content = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Hotel Wi-Fi " },
        {
          type: "text",
          text: "blocks UDP",
          marks: [{ type: "inlineComment", attrs: { threadId: THREAD } }],
        },
        { type: "text", text: " on port 51820." },
      ],
    },
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { id: MY_TASK, assignee: OLIVIA.id, dueDate: null },
          content: [{ type: "paragraph", content: [{ type: "text", text: "Test the fallback" }] }],
        },
        {
          type: "taskItem",
          attrs: { id: OTHER_TASK, assignee: LUKAS, dueDate: null },
          content: [{ type: "paragraph", content: [{ type: "text", text: "Rotate the key" }] }],
        },
      ],
    },
  ],
};

const thread = {
  id: THREAD,
  itemId: VPN,
  parentId: null,
  author: { id: LUKAS, name: "Lukas Hofer" },
  body: {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Happened twice" }] }],
  },
  deleted: false,
  createdAt: "2026-10-07T08:00:00.000Z",
  editedAt: null,
  reactions: [{ emoji: "👍", count: 1, reacted: false, people: [{ id: LUKAS, name: "Lukas Hofer" }] }],
  quote: "blocks UDP",
  anchor: "inline",
  resolvedAt: null,
  resolvedBy: null,
  replies: [],
};

const task = (id: string, text: string, extra: Record<string, unknown> = {}) => ({
  id,
  text,
  done: false,
  dueDate: null,
  overdue: false,
  assignee: { id: OLIVIA.id, name: OLIVIA.name },
  assignedBy: null,
  item: {
    id: VPN,
    kind: "page",
    title: "VPN access",
    spaceId: SPACE_ID,
    spaceKey: "ITOPS",
    spaceName: "IT Operations",
  },
  ...extra,
});

type Reply = { status?: number; body?: unknown };
type Handler = (request: RecordedRequest) => Reply | Promise<Reply>;

function routes(role: Role, extra: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    "GET /api/v1/instance/info": () => ({
      body: {
        name: "Example Wiki",
        setupComplete: true,
        language: "en",
        accentColor: "petrol",
        passwordMinLength: 12,
        selfRegistration: false,
        organization: null,
      },
    }),
    "GET /api/v1/auth/session": () => ({
      body: { sessionKind: "full", account: OLIVIA, methods: ["password"], recentlyAuthenticated: true },
    }),
    "GET /api/v1/organizations": () => ({ body: { items: [ORGANIZATION], nextCursor: null } }),
    [`GET /api/v1/organizations/${ORGANIZATION.id}`]: () => ({ body: ORGANIZATION }),
    "GET /api/v1/account/permissions": () => ({
      body: {
        instance: ["instance.content.view"],
        organization: ["organization.view"],
        grantableAreas: { instance: {}, organization: {} },
      },
    }),
    "GET /api/v1/account/preferences": () => ({ body: [] }),
    "GET /api/v1/notifications/unread-count": () => ({ body: { count: 0, capped: false } }),
    "GET /api/v1/space-keys/ITOPS": () => ({ body: { space: space(role), redirected: false } }),
    [`GET /api/v1/spaces/${SPACE_ID}/items`]: () => ({
      body: { items: [item(VPN, "VPN access")], nextCursor: null },
    }),
    [`GET /api/v1/spaces/${SPACE_ID}/archive`]: () => ({ body: [] }),
    [`GET /api/v1/items/${VPN}`]: () => ({ body: item(VPN, "VPN access") }),
    [`GET /api/v1/pages/${VPN}/content`]: () => ({
      body: {
        itemId: VPN,
        title: "VPN access",
        version: 2,
        document: content,
        schemaVersion: 3,
        revision: 4,
        updatedAt: "2026-10-05T08:10:00.000Z",
        updatedBy: OLIVIA.id,
        references: { people: { [OLIVIA.id]: OLIVIA.name, [LUKAS]: "Lukas Hofer" }, pages: {} },
      },
    }),
    [`GET /api/v1/pages/${VPN}/labels`]: () => ({ body: [] }),
    [`GET /api/v1/pages/${VPN}/backlinks`]: () => ({ body: [] }),
    [`GET /api/v1/pages/${VPN}/comments`]: () => ({ body: { threads: [thread], people: {} } }),
    [`GET /api/v1/pages/${VPN}/reactions`]: () => ({ body: { enabled: true, reactions: [] } }),
    [`GET /api/v1/pages/${VPN}/tasks`]: () => ({
      body: [
        { id: MY_TASK, done: false, changedAt: null, changedBy: null },
        { id: OTHER_TASK, done: true, changedAt: null, changedBy: null },
      ],
    }),
    [`POST /api/v1/items/${VPN}/views`]: () => ({ status: 204 }),
    "GET /api/v1/starred": () => ({ body: { items: [], spaces: [] } }),
    ...extra,
  };
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal(
    "EventSource",
    class {
      addEventListener() {}
      removeEventListener() {}
      close() {}
    },
  );
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

async function renderAt(path: string) {
  window.history.replaceState(null, "", path);
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
}

function wideScreen() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width"),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe("comments on a page", () => {
  it("open from the marked text in a sheet and let readers react but not reply", async () => {
    const { requests } = mockApi(
      routes("reader", {
        [`PUT /api/v1/comments/${THREAD}/reactions/${encodeURIComponent("👍")}`]: () => ({ status: 204 }),
      }),
    );
    await renderAt(`/spaces/ITOPS/pages/1042/vpn-access`);
    await userEvent.click(await screen.findByText("blocks UDP"));
    const sheet = await screen.findByRole("dialog", { name: "Comments" });
    expect(within(sheet).getByText("Happened twice")).toBeTruthy();
    expect(within(sheet).queryByRole("textbox", { name: "Reply" })).toBeNull();
    expect(within(sheet).queryByRole("button", { name: "Resolve" })).toBeNull();
    await userEvent.click(within(sheet).getByRole("button", { name: /👍 1/ }));
    await waitFor(() =>
      expect(
        requests.some((request) => request.method === "PUT" && request.path.includes("/reactions/")),
      ).toBe(true),
    );
  });

  it("open by keyboard in a popover at the mark and return the focus to the mark on Escape", async () => {
    wideScreen();
    mockApi(routes("commenter"));
    await renderAt(`/spaces/ITOPS/pages/1042/vpn-access`);
    const mark = await screen.findByRole("button", { name: "Open comment on “blocks UDP”" });
    mark.focus();
    await userEvent.keyboard("{Enter}");
    const popover = await screen.findByRole("dialog", { name: "Comments" });
    expect(within(popover).getByText("1 comment")).toBeTruthy();
    expect(within(popover).getByRole("button", { name: "Resolve" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Comments" })).toBeNull();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Comments" })).toBeNull());
    expect(document.activeElement).toBe(mark);
  });

  it("open the first thread of a paragraph from the counter at the edge", async () => {
    wideScreen();
    mockApi(routes("reader"));
    await renderAt(`/spaces/ITOPS/pages/1042/vpn-access`);
    await userEvent.click(await screen.findByRole("button", { name: "1 open comment in this paragraph" }));
    const popover = await screen.findByRole("dialog", { name: "Comments" });
    expect(within(popover).getByText("Happened twice")).toBeTruthy();
  });

  it("resolve a thread from the popover", async () => {
    wideScreen();
    const { requests } = mockApi(
      routes("commenter", { [`PUT /api/v1/comments/${THREAD}/resolved`]: () => ({ status: 204 }) }),
    );
    await renderAt(`/spaces/ITOPS/pages/1042/vpn-access`);
    await userEvent.click(await screen.findByText("blocks UDP"));
    const popover = await screen.findByRole("dialog", { name: "Comments" });
    await userEvent.click(within(popover).getByRole("button", { name: "Resolve" }));
    await waitFor(() =>
      expect(
        requests.find((request) => request.method === "PUT" && request.path.endsWith("/resolved"))?.body,
      ).toEqual({ resolved: true }),
    );
  });

  it("let commenters comment on selected text of the published version in the same popover", async () => {
    wideScreen();
    mockApi(routes("commenter"));
    await renderAt(`/spaces/ITOPS/pages/1042/vpn-access`);
    const text = await screen.findByText(/on port 51820/);
    const range = document.createRange();
    const node = Array.from(text.childNodes).find((child) => child.textContent?.includes("on port")) as Text;
    range.setStart(node, 1);
    range.setEnd(node, 5);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    Range.prototype.getBoundingClientRect = () => new DOMRect(10, 10, 40, 16);
    fireEvent(document, new Event("selectionchange"));
    const [onSelection] = await screen.findAllByRole("button", { name: "Comment" });
    if (!onSelection) throw new Error("No button to comment on the selection");
    await userEvent.click(onSelection);
    const popover = await screen.findByRole("dialog", { name: "Comments" });
    expect(within(popover).getByText("Comment on the selected text")).toBeTruthy();
    await userEvent.click(within(popover).getByRole("button", { name: "Comment" }));
    expect(await within(popover).findByText("Write a comment first.")).toBeTruthy();
  });

  it("list page comments below the content with resolved inline threads collapsed", async () => {
    const pageThread = {
      ...thread,
      id: "01929b1e-0000-7000-8000-0000000000c2",
      quote: null,
      anchor: "page",
      reactions: [],
      body: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Looks good" }] }],
      },
      replies: [
        {
          ...thread,
          id: "01929b1e-0000-7000-8000-0000000000c3",
          quote: null,
          anchor: "page",
          reactions: [],
          author: { id: OLIVIA.id, name: OLIVIA.name },
          body: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Thanks" }] }],
          },
        },
      ],
    };
    const resolved = { ...thread, resolvedAt: "2026-10-08T08:00:00.000Z" };
    mockApi(
      routes("commenter", {
        [`GET /api/v1/pages/${VPN}/comments`]: () => ({
          body: { threads: [pageThread, resolved], people: {} },
        }),
      }),
    );
    await renderAt(`/spaces/ITOPS/pages/1042/vpn-access?comment=${pageThread.id}`);
    const section = await screen.findByRole("region", { name: "Comments 2" });
    expect(within(section).getByText("Looks good")).toBeTruthy();
    expect(within(section).getByText("Thanks")).toBeTruthy();
    const highlighted = within(section).getByRole("article", { name: "Comment on the page" });
    await waitFor(() => expect(document.activeElement).toBe(highlighted));
    expect(highlighted.dataset.highlighted).toBeDefined();
    expect(within(section).queryByText("Happened twice")).toBeNull();
    await userEvent.click(within(section).getByRole("button", { name: "Show 1 resolved comment" }));
    expect(within(section).getByText("Happened twice")).toBeTruthy();
    expect(within(section).getByRole("button", { name: "Reopen" })).toBeTruthy();
    expect(within(section).getByRole("textbox", { name: "New comment on the page" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Comments/ })).toBeNull();
  });

  it("list open inline threads below the content when the published text has no mark for them", async () => {
    const { requests } = mockApi(
      routes("commenter", {
        [`GET /api/v1/pages/${VPN}/content`]: () => ({
          body: {
            itemId: VPN,
            title: "VPN access",
            version: 2,
            document: {
              type: "doc",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Hotel Wi-Fi blocks UDP." }] }],
            },
            schemaVersion: 3,
            revision: 4,
            updatedAt: "2026-10-05T08:10:00.000Z",
            updatedBy: OLIVIA.id,
            references: { people: {}, pages: {} },
          },
        }),
        [`PUT /api/v1/comments/${THREAD}/resolved`]: () => ({ status: 204 }),
      }),
    );
    await renderAt(`/spaces/ITOPS/pages/1042/vpn-access`);
    const section = await screen.findByRole("region", { name: "Comments 1" });
    const thread = within(section).getByRole("article", { name: "Comment on “blocks UDP”" });
    expect(within(thread).getByText("Happened twice")).toBeTruthy();
    await userEvent.click(within(thread).getByRole("button", { name: "Resolve" }));
    await waitFor(() =>
      expect(requests.find((request) => request.path.endsWith("/resolved"))?.body).toEqual({
        resolved: true,
      }),
    );
  });

  it("resolve a page comment and move it to the resolved list", async () => {
    const pageThread = { ...thread, id: "01929b1e-0000-7000-8000-0000000000c4", quote: null, anchor: "page" };
    const { requests } = mockApi(
      routes("commenter", {
        [`GET /api/v1/pages/${VPN}/comments`]: () => ({ body: { threads: [pageThread], people: {} } }),
        [`PUT /api/v1/comments/${pageThread.id}/resolved`]: () => ({ status: 204 }),
      }),
    );
    await renderAt(`/spaces/ITOPS/pages/1042/vpn-access`);
    const section = await screen.findByRole("region", { name: "Comments 1" });
    await userEvent.click(within(section).getByRole("button", { name: "Resolve" }));
    await waitFor(() =>
      expect(requests.find((request) => request.path.endsWith(`/${pageThread.id}/resolved`))?.body).toEqual({
        resolved: true,
      }),
    );
  });

  it("show the people editing the page before the edit info, without the viewer", async () => {
    mockApi(
      routes("reader", {
        [`GET /api/v1/pages/${VPN}/editors`]: () => ({
          body: {
            editors: [
              { id: LUKAS, name: "Lukas Hofer", pictureRef: null },
              { id: OLIVIA.id, name: OLIVIA.name, pictureRef: null },
            ],
          },
        }),
      }),
    );
    await renderAt(`/spaces/ITOPS/pages/1042/vpn-access`);
    const editors = await screen.findByRole("list", { name: "1 person is editing" });
    expect(within(editors).getByText("Lukas Hofer is editing")).toBeTruthy();
    expect(within(editors).queryByText("Olivia Owner is editing")).toBeNull();
  });

  it("open an inline thread from a deep link", async () => {
    wideScreen();
    mockApi(routes("reader"));
    await renderAt(`/spaces/ITOPS/pages/1042/vpn-access?comment=${THREAD}`);
    const popover = await screen.findByRole("dialog", { name: "Comments" });
    expect(within(popover).getByText("Happened twice")).toBeTruthy();
  });
});

describe("tasks in the read view", () => {
  it("let the assignee check a task without publishing, and keep other tasks read-only", async () => {
    const { requests } = mockApi(
      routes("reader", {
        [`PUT /api/v1/tasks/${MY_TASK}/status`]: () => ({
          body: {
            id: MY_TASK,
            done: true,
            changedAt: "2026-10-08T08:00:00.000Z",
            changedBy: { id: OLIVIA.id, name: OLIVIA.name },
          },
        }),
      }),
    );
    await renderAt(`/spaces/ITOPS/pages/1042/vpn-access`);
    const mine = await screen.findByRole("checkbox", {
      name: /^Mark as done: Test the fallback/,
    });
    const other = screen.getAllByRole("checkbox").find((box) => box !== mine) as HTMLInputElement;
    expect(other.disabled).toBe(true);
    expect(other.checked).toBe(true);
    await userEvent.click(mine);
    await waitFor(() =>
      expect(requests.find((request) => request.path.endsWith(`/tasks/${MY_TASK}/status`))?.body).toEqual({
        done: true,
      }),
    );
  });
});

describe("My tasks", () => {
  it("groups my tasks by due date, sorts by a column and filters by due date", async () => {
    const { requests } = mockApi(
      routes("reader", {
        "GET /api/v1/tasks": (request) => ({
          body: {
            items: request.path.includes("due=overdue")
              ? [task(MY_TASK, "Test the fallback", { dueDate: "2026-10-01", overdue: true })]
              : [
                  task(OTHER_TASK, "Rotate the key", { assignedBy: { id: OLIVIA.id, name: OLIVIA.name } }),
                  task(MY_TASK, "Test the fallback", { dueDate: "2026-10-01", overdue: true }),
                ],
            counts: { open: 2, done: 0, overdue: 1 },
            nextCursor: null,
          },
        }),
      }),
    );
    await renderAt("/tasks");
    expect(await screen.findByRole("heading", { name: "My tasks" })).toBeTruthy();
    const table = await screen.findByRole("table", { name: "Tasks" });
    await within(table).findByText("Rotate the key");
    const filters = document.querySelector("[data-filter-row]") as HTMLElement;
    for (const control of filters.children) expect(control.className).toContain("shrink-0");
    const groups = within(table)
      .getAllByRole("columnheader")
      .filter((cell) => cell.getAttribute("scope") === "colgroup")
      .map((cell) => cell.textContent);
    expect(groups).toEqual(["Overdue1", "No date1"]);
    await userEvent.click(within(table).getByRole("button", { name: /^Task/ }));
    await waitFor(() => expect(requests.some((request) => request.path.includes("sort=text"))).toBe(true));
    await userEvent.click(screen.getByRole("button", { name: "Due: All" }));
    await userEvent.click(screen.getByRole("button", { name: "Overdue" }));
    await waitFor(() => expect(requests.some((request) => request.path.includes("due=overdue"))).toBe(true));
  });

  it("lists the tasks I assigned to others and checks one off in the list", async () => {
    const { requests } = mockApi(
      routes("reader", {
        "GET /api/v1/tasks": () => ({
          body: {
            items: [task(MY_TASK, "Test the fallback")],
            counts: { open: 1, done: 0, overdue: 0 },
            nextCursor: null,
          },
        }),
        [`PUT /api/v1/tasks/${MY_TASK}/status`]: () => ({
          body: { id: MY_TASK, done: true, changedAt: null, changedBy: null },
        }),
      }),
    );
    await renderAt("/tasks");
    await userEvent.click(await screen.findByRole("radio", { name: "Created by me" }));
    await waitFor(() =>
      expect(
        requests.some(
          (request) => request.path.includes("assignedBy=me") && !request.path.includes("assignee="),
        ),
      ).toBe(true),
    );
    expect(await screen.findByRole("columnheader", { name: "For" })).toBeTruthy();
    await userEvent.click(await screen.findByRole("checkbox", { name: /Test the fallback/ }));
    await waitFor(() =>
      expect(requests.find((request) => request.path.endsWith(`/tasks/${MY_TASK}/status`))?.body).toEqual({
        done: true,
      }),
    );
  });
});

describe("blog of a space", () => {
  it("lists posts with their state and asks for a title before creating one", async () => {
    mockApi(
      routes("editor", {
        [`GET /api/v1/spaces/${SPACE_ID}/blog`]: () => ({
          body: {
            items: [
              {
                id: POST,
                spaceId: SPACE_ID,
                spaceKey: "ITOPS",
                spaceName: "IT Operations",
                title: "Printer maintenance",
                excerpt: "All printers are offline between 07:00 and 09:00.",
                labels: [],
                author: { id: OLIVIA.id, name: OLIVIA.name },
                published: false,
                publishedAt: null,
                scheduledAt: "2026-10-14T05:00:00.000Z",
                scheduledTimeZone: "Europe/Vienna",
                pinnedInSpace: false,
                pinnedInOrganization: false,
                commentCount: 2,
                createdAt: "2026-10-07T08:00:00.000Z",
              },
            ],
            nextCursor: null,
          },
        }),
      }),
    );
    await renderAt("/spaces/ITOPS/blog");
    expect(await screen.findByText("2 comments")).toBeTruthy();
    expect(await screen.findByText("Printer maintenance")).toBeTruthy();
    expect(screen.getByText("Scheduled")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Printer maintenance" }).className).toContain("text-lg");
    await userEvent.click(screen.getByRole("button", { name: "New post" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create post" }));
    expect(await within(dialog).findByText("Enter a title.")).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole("textbox", { name: /Title/ }));
  });
});

describe("held blog posts", () => {
  const held = {
    id: POST,
    spaceId: SPACE_ID,
    spaceKey: "ITOPS",
    spaceName: "IT Operations",
    title: "Office move",
    excerpt: "",
    labels: [],
    author: { id: LUKAS, name: "Lukas Hofer" },
    published: false,
    publishedAt: null,
    scheduledAt: "2026-10-14T05:00:00.000Z",
    scheduledTimeZone: "Europe/Vienna",
    scheduledBy: { id: LUKAS, name: "Lukas Hofer" },
    held: true,
    pinnedInSpace: false,
    pinnedInOrganization: false,
    createdAt: "2026-10-07T08:00:00.000Z",
  };

  it("are listed for space admins with the reason, and a space admin publishes them", async () => {
    const { requests } = mockApi(
      routes("admin", {
        [`GET /api/v1/spaces/${SPACE_ID}/blog`]: () => ({ body: { items: [held], nextCursor: null } }),
        [`GET /api/v1/spaces/${SPACE_ID}/blog/scheduled`]: () => ({ body: { items: [held] } }),
        [`POST /api/v1/blog-posts/${POST}/held/publish`]: () => ({
          body: { ...held, held: false, published: true, scheduledAt: null },
        }),
      }),
    );
    await renderAt("/spaces/ITOPS/blog");
    const section = await screen.findByRole("region", { name: "Scheduled" });
    expect(await within(section).findByText("Waiting for approval")).toBeTruthy();
    expect(
      within(section).getByText(
        "Lukas Hofer scheduled this post but can no longer edit it, so it was not published.",
      ),
    ).toBeTruthy();
    await userEvent.click(within(section).getByRole("button", { name: "Publish now" }));
    await waitFor(() =>
      expect(requests.some((entry) => entry.method === "POST" && entry.path.endsWith("/held/publish"))).toBe(
        true,
      ),
    );
  });

  it("show no scheduled list to editors", async () => {
    mockApi(
      routes("editor", {
        [`GET /api/v1/spaces/${SPACE_ID}/blog`]: () => ({ body: { items: [held], nextCursor: null } }),
      }),
    );
    await renderAt("/spaces/ITOPS/blog");
    expect(await screen.findByText("Waiting for approval")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Scheduled" })).toBeNull();
  });
});

describe("For you", () => {
  it("shows tasks, mentions, recent and starred items and new posts", async () => {
    const reference = {
      id: VPN,
      kind: "page",
      title: "VPN access",
      spaceId: SPACE_ID,
      spaceKey: "ITOPS",
      spaceName: "IT Operations",
      mySpace: false,
    };
    mockApi(
      routes("reader", {
        "GET /api/v1/home": () => ({
          body: {
            recent: [{ ...reference, viewedAt: "2026-10-08T07:00:00.000Z" }],
            starred: { items: [{ ...reference, starredAt: "2026-10-08T07:00:00.000Z" }], spaces: [] },
            tasks: [task(MY_TASK, "Test the fallback")],
            mentions: [
              {
                id: THREAD,
                item: reference,
                commentId: null,
                actor: { id: LUKAS, name: "Lukas Hofer" },
                at: "2026-10-08T07:00:00.000Z",
              },
            ],
            posts: [],
          },
        }),
      }),
    );
    await renderAt("/home");
    expect(await screen.findByText("Test the fallback")).toBeTruthy();
    expect(screen.getByText(/Lukas Hofer/)).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /VPN access/ }).length).toBe(4);
    expect(screen.queryByText(/Hello/)).toBeNull();
    expect(screen.getByText("No blog posts were published in your spaces in the last 30 days.")).toBeTruthy();
  });

  it("names pages in the own personal space Mein Space and never starts the line with a dot", async () => {
    const mine = {
      id: VPN,
      kind: "page",
      title: "Private draft",
      spaceId: SPACE_ID,
      spaceKey: "P0001",
      spaceName: "",
      mySpace: true,
    };
    const hidden = { ...mine, id: THREAD, title: "Shared page", spaceName: "", mySpace: false };
    mockApi(
      routes("reader", {
        "GET /api/v1/home": () => ({
          body: {
            recent: [
              { ...mine, viewedAt: new Date(Date.now() - 8 * 60_000).toISOString() },
              { ...hidden, viewedAt: new Date(Date.now() - 9 * 60_000).toISOString() },
            ],
            starred: { items: [], spaces: [] },
            tasks: [],
            mentions: [],
            posts: [],
          },
        }),
        "GET /api/v1/meetings/upcoming": () => ({ body: [] }),
        "GET /api/v1/one-on-ones": () => ({ body: [] }),
      }),
    );
    await renderAt("/home");
    const row = await screen.findByRole("link", { name: /Private draft/ });
    expect(row.textContent).toMatch(/My space · 8 min. ago$/);
    const shared = screen.getByRole("link", { name: /Shared page/ });
    expect(shared.textContent).not.toMatch(/Shared pages*·/);
    expect(shared.textContent).toMatch(/9 min. ago$/);
  });

  it("welcomes people without spaces with a collapsed sidebar and shows the sections once a space exists", async () => {
    const empty = { recent: [], starred: { items: [], spaces: [] }, tasks: [], mentions: [], posts: [] };
    const spaces: unknown[] = [];
    mockApi(
      routes("reader", {
        "GET /api/v1/home": () => ({ body: empty }),
        "GET /api/v1/spaces": () => ({ body: { items: spaces, nextCursor: null } }),
        "GET /api/v1/meetings/upcoming": () => ({ body: [] }),
        "GET /api/v1/one-on-ones": () => ({ body: [] }),
      }),
    );
    await renderAt("/home");
    expect(await screen.findByText("Welcome to Lunedo")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the spaces" }).getAttribute("href")).toBe("/spaces");
    await waitFor(() =>
      expect(screen.getByRole("navigation", { name: "Main navigation" }).hasAttribute("data-collapsed")).toBe(
        true,
      ),
    );
    cleanup();
    spaces.push({ id: SPACE_ID, key: "ITOPS", name: "IT Operations" });
    await renderAt("/home");
    expect(await screen.findByText("No upcoming meetings.")).toBeTruthy();
    expect(screen.queryByText("Welcome to Lunedo")).toBeNull();
    expect(screen.getByRole("navigation", { name: "Main navigation" }).hasAttribute("data-collapsed")).toBe(
      false,
    );
  });

  it("shows each section with its own placeholder rows and leaves one-on-ones to their own section", async () => {
    const { requests } = mockApi(
      routes("reader", {
        "GET /api/v1/home": () => new Promise<Reply>(() => {}),
        "GET /api/v1/meetings/upcoming": () => ({ body: [] }),
        "GET /api/v1/one-on-ones": () => ({ body: [] }),
      }),
    );
    await renderAt("/home");
    expect(await screen.findByRole("heading", { name: "My tasks, due soon" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Mentions" })).toBeTruthy();
    expect(await screen.findByText("No upcoming meetings.")).toBeTruthy();
    const upcoming = requests.find((request) => request.path.startsWith("/api/v1/meetings/upcoming"));
    expect(upcoming?.path).toContain("oneOnOne=false");
  });

  it("names an upcoming meeting by its own title when the series stays hidden", async () => {
    const empty = { recent: [], starred: { items: [], spaces: [] }, tasks: [], mentions: [], posts: [] };
    mockApi(
      routes("reader", {
        "GET /api/v1/home": () => ({ body: empty }),
        "GET /api/v1/meetings/upcoming": () => ({
          body: [
            {
              id: VPN,
              title: "Jour fixe · 18 Mar 2030",
              startsAt: "2030-03-18T08:30:00.000Z",
              durationMinutes: 45,
              seriesId: null,
              seriesTitle: null,
              spaceId: SPACE_ID,
              spaceKey: "ITOPS",
              oneOnOne: false,
            },
          ],
        }),
        "GET /api/v1/one-on-ones": () => ({ body: [] }),
      }),
    );
    await renderAt("/home");
    expect(await screen.findByText("Jour fixe · 18 Mar 2030")).toBeTruthy();
  });
});
