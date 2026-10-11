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

const item = (id: string, title: string, kind = "page") => ({
  id,
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

type Handler = (request: RecordedRequest) => { status?: number; body?: unknown };

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
    "GET /api/v1/notifications/unread-count": () => ({ body: { count: 0 } }),
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

describe("comments on a page", () => {
  it("open from the marked text, show the quote and let readers react but not reply", async () => {
    const { requests } = mockApi(
      routes("reader", {
        [`PUT /api/v1/comments/${THREAD}/reactions/${encodeURIComponent("👍")}`]: () => ({ status: 204 }),
      }),
    );
    await renderAt(`/spaces/ITOPS/pages/${VPN}/vpn-access`);
    await userEvent.click(await screen.findByText("blocks UDP"));
    const panel = await screen.findByRole("complementary", { name: "Comments" });
    expect(within(panel).getByRole("button", { name: "“blocks UDP”" })).toBeTruthy();
    expect(within(panel).getByText("Happened twice")).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "Reply" })).toBeNull();
    await userEvent.click(within(panel).getByRole("button", { name: /👍 1/ }));
    await waitFor(() =>
      expect(
        requests.some((request) => request.method === "PUT" && request.path.includes("/reactions/")),
      ).toBe(true),
    );
  });

  it("keep the focus inside the panel on narrow screens and return it when closed", async () => {
    mockApi(routes("reader"));
    await renderAt(`/spaces/ITOPS/pages/${VPN}/vpn-access`);
    const toggle = await screen.findByRole("button", { name: /^Comments/ });
    await userEvent.click(toggle);
    const panel = await screen.findByRole("complementary", { name: "Comments" });
    await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));
    for (let step = 0; step < 12; step += 1) {
      await userEvent.tab();
      expect(panel.contains(document.activeElement)).toBe(true);
    }
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Comments" })).toBeNull());
    expect(document.activeElement).toBe(toggle);
  });

  it("let commenters comment on selected text of the published version", async () => {
    mockApi(routes("commenter"));
    await renderAt(`/spaces/ITOPS/pages/${VPN}/vpn-access`);
    const text = await screen.findByText(/on port 51820/);
    const range = document.createRange();
    const node = Array.from(text.childNodes).find((child) => child.textContent?.includes("on port")) as Text;
    range.setStart(node, 1);
    range.setEnd(node, 5);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    Range.prototype.getBoundingClientRect = () => new DOMRect(10, 10, 40, 16);
    fireEvent(document, new Event("selectionchange"));
    await userEvent.click(await screen.findByRole("button", { name: "Comment" }));
    const pending = await screen.findByRole("region", { name: "Comment on the selected text" });
    expect(within(pending).getByText("“on p”")).toBeTruthy();
    await userEvent.click(within(pending).getByRole("button", { name: "Comment" }));
    expect(await within(pending).findByText("Write a comment first.")).toBeTruthy();
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
    await renderAt(`/spaces/ITOPS/pages/${VPN}/vpn-access`);
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
  it("lists my tasks with counts, marks overdue ones and filters by overdue", async () => {
    const { requests } = mockApi(
      routes("reader", {
        "GET /api/v1/tasks": (request) => ({
          body: {
            items: request.path.includes("due=overdue")
              ? [task(MY_TASK, "Test the fallback", { dueDate: "2026-10-01", overdue: true })]
              : [
                  task(MY_TASK, "Test the fallback", { dueDate: "2026-10-01", overdue: true }),
                  task(OTHER_TASK, "Rotate the key"),
                ],
            counts: { open: 2, done: 0, overdue: 1 },
            nextCursor: null,
          },
        }),
      }),
    );
    await renderAt("/tasks");
    expect(await screen.findByRole("heading", { name: "My tasks" })).toBeTruthy();
    expect(await screen.findByText("Rotate the key")).toBeTruthy();
    expect(screen.getByText("2 open")).toBeTruthy();
    expect(screen.getAllByText(/Overdue since/).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("radio", { name: "Overdue" }));
    await waitFor(() => expect(requests.some((request) => request.path.includes("due=overdue"))).toBe(true));
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
                createdAt: "2026-10-07T08:00:00.000Z",
              },
            ],
            nextCursor: null,
          },
        }),
      }),
    );
    await renderAt("/spaces/ITOPS/blog");
    expect(await screen.findByText("Printer maintenance")).toBeTruthy();
    expect(screen.getByText("Scheduled")).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: "Write a post" })[0] as HTMLElement);
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
    expect(screen.getAllByRole("link", { name: /VPN access/ }).length).toBe(3);
    expect(screen.getByText("No blog posts were published in your spaces in the last 30 days.")).toBeTruthy();
  });

  it("welcomes people only while nothing at all is there, upcoming meetings included", async () => {
    const empty = { recent: [], starred: { items: [], spaces: [] }, tasks: [], mentions: [], posts: [] };
    const meeting = {
      id: VPN,
      title: "Jour fixe",
      startsAt: "2030-03-18T08:30:00.000Z",
      durationMinutes: 45,
      seriesId: SPACE_ID,
      seriesTitle: "Jour fixe IT",
      spaceId: SPACE_ID,
      spaceKey: "ITOPS",
      oneOnOne: false,
    };
    const upcoming: unknown[] = [];
    mockApi(
      routes("reader", {
        "GET /api/v1/home": () => ({ body: empty }),
        "GET /api/v1/meetings/upcoming": () => ({ body: upcoming }),
        "GET /api/v1/one-on-ones": () => ({ body: [] }),
      }),
    );
    await renderAt("/home");
    expect(await screen.findByText("Welcome to Pagehall")).toBeTruthy();
    cleanup();
    upcoming.push(meeting);
    await renderAt("/home");
    expect(await screen.findByText("Jour fixe IT")).toBeTruthy();
    expect(screen.queryByText("Welcome to Pagehall")).toBeNull();
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
