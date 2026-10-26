import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "../app.js";
import { createFormatter } from "../format/format.js";
import { initI18n } from "../i18n/index.js";
import { mockApi, problem } from "../testing/render.js";
import "./builtin.js";
import { countText, notificationText } from "./notification-entry.js";
import { groupByDay } from "./notification-panel.js";
import { notificationTypes } from "./notification-types.js";
import {
  type NotificationItem,
  objectsChanged,
  syncRunChanged,
  useNotificationStream,
} from "./notifications-api.js";

const ACCOUNT = {
  id: "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c",
  email: "olivia@example.org",
  name: "Olivia Owner",
};
const ORGANIZATION_ID = "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f";

function notification(id: string, patch: Partial<NotificationItem>): NotificationItem {
  return {
    id,
    type: "guest.expiring",
    organizationId: ORGANIZATION_ID,
    target: { type: "account", id: "01929b1e-0000-7000-8000-000000000001" },
    actor: null,
    actorCount: 0,
    params: {
      organizationName: "Platform Team",
      guestName: "Gina Guest",
      expiresAt: "2026-10-08T00:00:00.000Z",
    },
    count: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    readAt: null,
    ...patch,
  } as NotificationItem;
}

class FakeEventSource {
  static last: FakeEventSource | null = null;
  readonly listeners = new Map<string, (event: MessageEvent<string>) => void>();
  constructor(readonly url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void) {
    this.listeners.set(type, listener);
  }
  removeEventListener(type: string) {
    this.listeners.delete(type);
  }
  close() {}
  emit(type: string, data: unknown) {
    this.listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("groupByDay", () => {
  it("sorts notifications into today, yesterday, this week and older", () => {
    const now = new Date("2026-10-01T12:00:00");
    const items = [
      notification("a", { updatedAt: "2026-10-01T09:00:00" }),
      notification("b", { updatedAt: "2026-09-30T23:00:00" }),
      notification("c", { updatedAt: "2026-09-29T09:00:00" }),
      notification("d", { updatedAt: "2026-09-28T08:00:00" }),
      notification("e", { updatedAt: "2026-09-27T08:00:00" }),
    ];
    expect(groupByDay(items, now).map((group) => [group.key, group.items.map((item) => item.id)])).toEqual([
      ["today", ["a"]],
      ["yesterday", ["b"]],
      ["thisWeek", ["c", "d"]],
      ["older", ["e"]],
    ]);
    expect(groupByDay(items, now, "sunday").map((group) => group.key)).toEqual([
      "today",
      "yesterday",
      "thisWeek",
    ]);
  });
});

describe("notificationText", () => {
  it("names the people of a combined notification and what happened to the item", async () => {
    const i18n = await initI18n(["en"]);
    const t = i18n.getFixedT("en");
    const format = createFormatter({
      language: "en",
      timeZone: "UTC",
      dateFormat: "DD/MM/YYYY",
      timeFormat: "24h",
      numberFormat: "en-US",
      firstDayOfWeek: "monday",
    });
    const changed = notification("c1", {
      type: "content.changed",
      actor: { type: "account", id: ACCOUNT.id, name: "Gaby Teller" },
      actorCount: 3,
      count: 7,
      target: { type: "item", id: "01929b1e-0000-7000-8000-000000000009" },
      params: { itemTitle: "Restart the VPN gateway", itemKind: "page", spaceKey: "IT", version: 9 },
    });
    expect(notificationText(t, changed, format)).toBe(
      "Gaby Teller and 2 others changed Restart the VPN gateway",
    );
    expect(countText(t, changed)).toBe("7 changes");
    const transfer = notification("c2", {
      type: "ownership.transferred",
      actor: { type: "account", id: "01929b1e-0000-7000-8000-000000000010", name: "Lea Maier" },
      actorCount: 1,
      params: { itemTitle: "Runbook", itemKind: "page", spaceKey: "IT", ownerId: ACCOUNT.id },
    });
    expect(notificationText(t, transfer, format, ACCOUNT.id)).toBe("Lea Maier made you the owner of Runbook");
    expect(notificationText(t, transfer, format, "someone else")).toBe("Lea Maier gave Runbook a new owner");
    const status = notification("c3", {
      type: "page.statusChanged",
      actor: { type: "account", id: "01929b1e-0000-7000-8000-000000000010", name: "Lea Maier" },
      actorCount: 1,
      params: {
        itemTitle: "Runbook",
        itemKind: "page",
        spaceKey: "IT",
        statusBuiltIn: "verified",
        statusName: null,
      },
    });
    expect(notificationText(t, status, format)).toBe("Lea Maier set the status of Runbook to Verified");
  });

  it("shows durations readably and explains an unused token", async () => {
    const i18n = await initI18n(["en"]);
    const t = i18n.getFixedT("en");
    const format = createFormatter({
      language: "en",
      timeZone: "UTC",
      dateFormat: "DD/MM/YYYY",
      timeFormat: "24h",
      numberFormat: "en-US",
      firstDayOfWeek: "monday",
    });
    expect(
      notificationText(
        t,
        notification("x", {
          type: "breakGlass.started",
          params: { requesterName: "Ian", organizationName: "Platform Team", minutes: 240, reason: "Outage" },
        }),
        format,
      ),
    ).toBe("Ian started break-glass access to Platform Team for 4 hours: Outage");
    expect(
      notificationText(
        t,
        notification("y", {
          type: "apiToken.unused",
          params: { tokenName: "Deploy", lastUsedAt: null, days: 90, serviceAccountId: null },
        }),
        format,
      ),
    ).toBe(
      "The API token Deploy has not been used for 90 days. It keeps working; revoke it if nobody needs it anymore.",
    );
  });
});

describe("notification links", () => {
  it("opens the account itself for an account without organization", () => {
    const type = notificationTypes.list().find((entry) => entry.id === "account.withoutOrganization");
    const accountId = "01929b1e-0000-7000-8000-000000000009";
    expect(
      type?.link(
        notification("a", {
          type: "account.withoutOrganization",
          organizationId: null,
          target: { type: "account", id: accountId },
        }),
      ),
    ).toEqual({ to: "/settings/instance/accounts/$accountId", params: { accountId } });
  });
});

describe("notificationText for blog posts and meeting reminders", () => {
  it("names the blog and shows the meeting start with its time", async () => {
    const i18n = await initI18n(["en"]);
    const t = i18n.getFixedT("en");
    const format = createFormatter({
      language: "en",
      timeZone: "Europe/Vienna",
      dateFormat: "DD/MM/YYYY",
      timeFormat: "24h",
      numberFormat: "en-US",
      firstDayOfWeek: "monday",
    });
    expect(
      notificationText(
        t,
        notification("p", {
          type: "blogPost.published",
          params: { itemTitle: "WireGuard", itemKind: "blogPost", spaceKey: "ENG", spaceName: "Engineering" },
        }),
        format,
      ),
    ).toBe("New post in Engineering: WireGuard");
    expect(
      notificationText(
        t,
        notification("r", {
          type: "meeting.reminder",
          params: {
            itemTitle: "Platform weekly · 15 Oct 2026",
            seriesTitle: "Platform weekly",
            spaceKey: "ENG",
            startsAt: "2026-10-15T07:30:00.000Z",
          },
        }),
        format,
      ),
    ).toBe(
      `Platform weekly on ${format.calendarDateTime("2026-10-15T07:30:00.000Z")}: add your topics before the meeting so others can prepare.`,
    );
    expect(format.calendarDateTime("2026-10-15T07:30:00.000Z")).toContain("09:30");
  });
});

describe("the notification panel", () => {
  it("shows live counts, lists notifications and marks them as read", async () => {
    let unread = 1;
    const items = [
      notification("01929b1e-0000-7000-8000-00000000000a", { count: 3 }),
      notification("01929b1e-0000-7000-8000-00000000000b", {
        type: "signIn.newBrowser",
        organizationId: null,
        params: { browser: "Firefox", operatingSystem: null, clientIp: "198.51.100.7" },
        readAt: "2026-09-01T10:00:00.000Z",
        updatedAt: "2026-09-01T10:00:00.000Z",
      }),
    ];
    const { requests } = mockApi({
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
        body: { sessionKind: "full", account: ACCOUNT, methods: ["password"], recentlyAuthenticated: true },
      }),
      "GET /api/v1/organizations": () => ({ body: { items: [], nextCursor: null } }),
      "GET /api/v1/account/permissions": () => ({ body: { instance: [], organization: [] } }),
      "GET /api/v1/account/preferences": () => ({ body: [] }),
      "GET /api/v1/notifications/unread-count": () => ({ body: { count: unread, capped: false } }),
      "GET /api/v1/notifications": () => ({ body: { items, nextCursor: null } }),
      "POST /api/v1/notifications/read-all": () => {
        unread = 0;
        items.splice(0, items.length);
        return { body: { marked: 1 } };
      },
      "GET /api/v1/account/sessions": () => problem(404, "notFound"),
    });
    window.history.replaceState(null, "", "/settings/preferences");
    const i18n = await initI18n(["en"]);
    render(<App i18n={i18n} queryClient={createQueryClient()} />);

    expect(
      await screen.findByRole("button", { name: "Notifications, 1 unread" }, { timeout: 5000 }),
    ).toBeTruthy();
    expect(FakeEventSource.last?.url).toBe("/api/v1/notifications/stream");
    FakeEventSource.last?.emit("notifications", { unreadCount: 100, unreadCapped: false });
    expect(await screen.findByRole("button", { name: "Notifications, 100 unread" })).toBeTruthy();
    FakeEventSource.last?.emit("notifications", { unreadCount: 100, unreadCapped: true });
    expect(await screen.findByRole("button", { name: "Notifications, 99+ unread" })).toBeTruthy();
    FakeEventSource.last?.emit("notifications", { unreadCount: 4 });
    expect(await screen.findByRole("button", { name: "Notifications, 4 unread" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Notifications, 4 unread" }));
    const panel = await screen.findByRole("dialog", { name: "Notifications" });
    expect(
      await within(panel).findByText(
        /^The guest access of Gina Guest to Platform Team ends on Oct 8(, 2026)?.$/,
      ),
    ).toBeTruthy();
    expect(within(panel).getByText(/3 times/)).toBeTruthy();
    expect(
      within(panel).getByText(
        "Your account was signed in from a new browser: Firefox on Unknown, 198.51.100.7.",
      ),
    ).toBeTruthy();
    expect(within(panel).getByRole("heading", { name: "Today" })).toBeTruthy();
    expect(within(panel).getByRole("heading", { name: "Older" })).toBeTruthy();
    expect(within(panel).getByRole("tab", { name: "All 4" })).toBeTruthy();
    expect(requests.some((request) => request.path.includes("grouped=true"))).toBe(true);
    expect(within(panel).queryByRole("tab", { name: "Requests" })).toBeNull();
    const rows = within(panel)
      .getAllByRole("button")
      .filter((button) => button.hasAttribute("data-notification"));
    within(panel).getByRole("switch", { name: "Unread only" }).focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(rows[0]);
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(rows[1]);
    await userEvent.keyboard("{End}");
    expect(document.activeElement).toBe(rows.at(-1));
    expect(within(panel).getByRole("link", { name: "Show all" }).getAttribute("href")).toBe("/notifications");

    await userEvent.click(within(panel).getByRole("button", { name: "Mark all as read" }));
    await waitFor(() =>
      expect(requests.some((request) => request.path === "/api/v1/notifications/read-all")).toBe(true),
    );
    const bell = await screen.findByRole("button", { name: "Notifications" });
    await userEvent.click(within(panel).getByRole("switch", { name: "Unread only" }));
    expect(await within(panel).findByText("You have read everything.")).toBeTruthy();
    expect(requests.some((request) => request.path.includes("unread=true"))).toBe(true);
    expect(
      within(panel).queryByText("Reminders and notices about your organizations appear here."),
    ).toBeNull();
    await userEvent.click(within(panel).getByRole("button", { name: "Show all" }));
    expect(within(panel).getByRole("switch", { name: "Unread only" }).getAttribute("aria-checked")).toBe(
      "false",
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Notifications" })).toBeNull());
    expect(document.activeElement).toBe(bell);
  });
});

describe("the notifications page", () => {
  it("filters by kind and decides an access request in the entry", async () => {
    const REQUEST = "01929b1e-0000-7000-8000-0000000000f1";
    const SPACE = "01929b1e-0000-7000-8000-0000000000f2";
    const FELIX = { id: "01929b1e-0000-7000-8000-0000000000f3", name: "Felix Gruber", email: null };
    const asked = notification("01929b1e-0000-7000-8000-0000000000f4", {
      type: "access.requested",
      target: { type: "accessRequest", id: REQUEST },
      actor: { type: "account", id: FELIX.id, name: FELIX.name },
      actorCount: 1,
      params: {
        requestId: REQUEST,
        target: "space",
        requesterName: FELIX.name,
        spaceId: SPACE,
        spaceName: "People",
        spaceKey: "HR",
        itemTitle: null,
        message: "For the onboarding in November",
      },
      preview: "For the onboarding in November",
    });
    const { requests } = mockApi({
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
        body: { sessionKind: "full", account: ACCOUNT, methods: ["password"], recentlyAuthenticated: true },
      }),
      "GET /api/v1/organizations": () => ({ body: { items: [], nextCursor: null } }),
      "GET /api/v1/account/permissions": () => ({ body: { instance: [], organization: [] } }),
      "GET /api/v1/account/preferences": () => ({ body: [] }),
      "GET /api/v1/notifications/unread-count": () => ({ body: { count: 1, capped: false } }),
      "GET /api/v1/notifications": () => ({ body: { items: [asked], nextCursor: null } }),
      [`GET /api/v1/access-requests/${REQUEST}`]: () => ({
        body: {
          id: REQUEST,
          requester: FELIX,
          spaceId: SPACE,
          spaceName: "People",
          itemId: null,
          itemTitle: null,
          message: "For the onboarding in November",
          status: "open",
          role: null,
          decidedBy: null,
          decidedAt: null,
          createdAt: new Date().toISOString(),
        },
      }),
      [`POST /api/v1/access-requests/${REQUEST}/decide`]: () => ({
        body: { status: "approved", role: "commenter" },
      }),
    });
    window.history.replaceState(null, "", "/notifications");
    const i18n = await initI18n(["en"]);
    render(<App i18n={i18n} queryClient={createQueryClient()} />);
    expect(
      await screen.findByRole("heading", { name: "Notifications", level: 1 }, { timeout: 5000 }),
    ).toBeTruthy();
    expect(await screen.findByText("For the onboarding in November")).toBeTruthy();
    await userEvent.click(await screen.findByRole("combobox", { name: "Access to give" }));
    await userEvent.click(await screen.findByRole("option", { name: "Can comment" }));
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() =>
      expect(requests.find((request) => request.path.endsWith("/decide"))?.body).toEqual({
        approve: true,
        role: "commenter",
        includeDescendants: false,
      }),
    );
    await userEvent.click(screen.getByRole("tab", { name: /^Requests/ }));
    await waitFor(() =>
      expect(requests.some((request) => request.path.includes("kind=requests"))).toBe(true),
    );
  });
});

function shellApi(routes: Parameters<typeof mockApi>[0]) {
  return mockApi({
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
      body: { sessionKind: "full", account: ACCOUNT, methods: ["password"], recentlyAuthenticated: true },
    }),
    "GET /api/v1/organizations": () => ({ body: { items: [], nextCursor: null } }),
    "GET /api/v1/account/permissions": () => ({ body: { instance: [], organization: [] } }),
    "GET /api/v1/account/preferences": () => ({ body: [] }),
    "GET /api/v1/notifications/unread-count": () => ({ body: { count: 1, capped: false } }),
    "GET /api/v1/account/sessions": () => problem(404, "notFound"),
    ...routes,
  });
}

async function openPanel() {
  window.history.replaceState(null, "", "/settings/preferences");
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Notifications, 1 unread" }, { timeout: 5000 }),
  );
  return screen.findByRole("dialog", { name: "Notifications" });
}

describe("acting on a notification", () => {
  it("stops watching the page in place and offers undo", async () => {
    const itemId = "01929b1e-0000-7000-8000-0000000000d1";
    const items = [
      notification("01929b1e-0000-7000-8000-00000000000c", {
        type: "comment.created",
        target: { type: "item", id: itemId },
        actor: { type: "account", id: "01929b1e-0000-7000-8000-0000000000d2", name: "Bea Builder" },
        actorCount: 1,
        params: { itemTitle: "Restart the VPN gateway", itemKind: "page", spaceKey: "OPS" },
      }),
    ];
    const status = (state: string | null) => ({
      body: {
        own: { state, keepActionable: true, automatic: false },
        effective: { state: state ?? "watching", keepActionable: true, source: "target" },
      },
    });
    const { requests } = shellApi({
      "GET /api/v1/notifications": () => ({ body: { items, nextCursor: null } }),
      [`PUT /api/v1/items/${itemId}/watch`]: (request) =>
        status((request.body as { state: string | null }).state),
      [`DELETE /api/v1/items/${itemId}/watch`]: () => status(null),
    });
    const panel = await openPanel();
    await userEvent.click(await within(panel).findByRole("button", { name: "Stop watching the page" }));
    expect(await screen.findByText("You no longer watch Restart the VPN gateway.")).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "Stop watching the page" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Undo/ }));
    expect(await within(panel).findByRole("button", { name: "Stop watching the page" })).toBeTruthy();
    expect(
      requests
        .filter((request) => request.path.endsWith("/watch"))
        .map((request) => [request.method, request.body]),
    ).toEqual([
      ["PUT", { state: "notWatching" }],
      ["DELETE", undefined],
    ]);
  });

  it("shows a comment preview and sends a reply from the row", async () => {
    const commentId = "01929b1e-0000-7000-8000-0000000000e1";
    const items = [
      notification("01929b1e-0000-7000-8000-0000000000e2", {
        type: "comment.created",
        target: { type: "item", id: "01929b1e-0000-7000-8000-0000000000e3" },
        actor: { type: "account", id: "01929b1e-0000-7000-8000-0000000000d2", name: "Bea Builder" },
        actorCount: 1,
        params: { itemTitle: "Restart the VPN gateway", itemKind: "page", spaceKey: "OPS", commentId },
        preview: "Can we do this on Friday?",
      }),
    ];
    const { requests } = shellApi({
      "GET /api/v1/notifications": () => ({ body: { items, nextCursor: null } }),
      [`POST /api/v1/comments/${commentId}/replies`]: () => ({ status: 201, body: { id: commentId } }),
    });
    const panel = await openPanel();
    expect(await within(panel).findByText("Can we do this on Friday?")).toBeTruthy();
    await userEvent.click(within(panel).getByRole("button", { name: "Reply" }));
    await userEvent.click(within(panel).getByRole("button", { name: "Send reply" }));
    expect(await within(panel).findByText("The reply is empty. Write some text or cancel.")).toBeTruthy();
    expect(document.activeElement).toBe(within(panel).getByRole("textbox", { name: "Reply" }));
    await userEvent.type(within(panel).getByRole("textbox", { name: "Reply" }), "Yes, after 18:00");
    await userEvent.click(within(panel).getByRole("button", { name: "Send reply" }));
    await waitFor(() =>
      expect(requests.find((request) => request.path.endsWith("/replies"))?.body).toEqual({
        body: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Yes, after 18:00" }] }],
        },
      }),
    );
    await waitFor(() => expect(within(panel).queryByRole("textbox", { name: "Reply" })).toBeNull());
  });

  it("marks a read notification as unread and an unread one as read", async () => {
    const id = "01929b1e-0000-7000-8000-0000000000e4";
    const items = [notification(id, { readAt: "2026-10-01T09:00:00.000Z" })];
    const { requests } = shellApi({
      "GET /api/v1/notifications": () => ({ body: { items, nextCursor: null } }),
      [`POST /api/v1/notifications/${id}/unread`]: () => ({ status: 204 }),
    });
    const panel = await openPanel();
    await userEvent.click(await within(panel).findByRole("button", { name: "Mark as unread" }));
    await waitFor(() =>
      expect(requests.some((request) => request.path === `/api/v1/notifications/${id}/unread`)).toBe(true),
    );
  });

  it("checks off an assigned task in the row", async () => {
    const pageId = "01929b1e-0000-7000-8000-0000000000e5";
    const items = [
      notification("01929b1e-0000-7000-8000-0000000000e6", {
        type: "task.assigned",
        target: { type: "item", id: pageId },
        actor: { type: "account", id: "01929b1e-0000-7000-8000-0000000000d2", name: "Bea Builder" },
        actorCount: 1,
        params: { itemTitle: "Onboarding", spaceKey: "HR", taskId: "task-1", taskText: "Order a laptop" },
        preview: "Order a laptop",
      }),
    ];
    const { requests } = shellApi({
      "GET /api/v1/notifications": () => ({ body: { items, nextCursor: null } }),
      [`GET /api/v1/pages/${pageId}/tasks`]: () => ({ body: [] }),
      [`PUT /api/v1/pages/${pageId}/tasks/task-1/status`]: () => ({
        body: { id: "task-1", done: true, changedAt: null, changedBy: null },
      }),
    });
    const panel = await openPanel();
    await userEvent.click(
      await within(panel).findByRole("checkbox", { name: "Mark the task Order a laptop as done" }),
    );
    await waitFor(() =>
      expect(requests.find((request) => request.path.endsWith("/tasks/task-1/status"))?.body).toEqual({
        done: true,
      }),
    );
  });

  it("shows changes in one space and day as one row that expands and marks all members read", async () => {
    const members = ["01929b1e-0000-7000-8000-0000000000f6", "01929b1e-0000-7000-8000-0000000000f7"];
    const items = [
      notification(members[0] as string, {
        type: "content.changed",
        target: { type: "item", id: "01929b1e-0000-7000-8000-0000000000f8" },
        params: { itemTitle: "Runbook", itemKind: "page", spaceKey: "OPS" },
        group: {
          spaceId: "01929b1e-0000-7000-8000-0000000000f9",
          spaceKey: "OPS",
          spaceName: "Operations",
          day: "2026-10-01",
          actors: [
            { id: "01929b1e-0000-7000-8000-0000000000d2", name: "Bea Builder" },
            { id: "01929b1e-0000-7000-8000-0000000000d3", name: "Carl Coder" },
          ],
          actorCount: 3,
          members: [
            {
              id: members[0] as string,
              itemId: "01929b1e-0000-7000-8000-0000000000f8",
              itemTitle: "Runbook",
              actor: { id: "01929b1e-0000-7000-8000-0000000000d2", name: "Bea Builder" },
              updatedAt: new Date().toISOString(),
              readAt: null,
            },
            {
              id: members[1] as string,
              itemId: "01929b1e-0000-7000-8000-0000000000fa",
              itemTitle: "On-call rota",
              actor: { id: "01929b1e-0000-7000-8000-0000000000d3", name: "Carl Coder" },
              updatedAt: new Date().toISOString(),
              readAt: null,
            },
          ],
        },
      }),
    ];
    const { requests } = shellApi({
      "GET /api/v1/notifications": () => ({ body: { items, nextCursor: null } }),
      "POST /api/v1/notifications/read": () => ({ body: { marked: 2 } }),
    });
    const panel = await openPanel();
    expect(await within(panel).findByText("2 pages changed in Operations")).toBeTruthy();
    expect(within(panel).getByText("by Bea Builder, Carl Coder and 1 other")).toBeTruthy();
    expect(within(panel).queryByRole("link", { name: "On-call rota" })).toBeNull();
    await userEvent.click(within(panel).getByRole("button", { name: "Show all 2" }));
    expect(within(panel).getByRole("link", { name: "On-call rota" })).toBeTruthy();
    await userEvent.click(within(panel).getByRole("button", { name: "Show less" }));
    await userEvent.click(within(panel).getByRole("button", { name: "Mark as read" }));
    await waitFor(() =>
      expect(requests.find((request) => request.path === "/api/v1/notifications/read")?.body).toEqual({
        ids: members,
      }),
    );
  });
});

describe("live settings", () => {
  it("apply a changed setting without a reload", async () => {
    let colorMode = "light";
    mockApi({
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
        body: { sessionKind: "full", account: ACCOUNT, methods: ["password"], recentlyAuthenticated: true },
      }),
      "GET /api/v1/organizations": () => ({ body: { items: [], nextCursor: null } }),
      "GET /api/v1/account/permissions": () => ({ body: { instance: [], organization: [] } }),
      "GET /api/v1/account/preferences": () => ({
        body: [
          {
            key: "appearance.colorMode",
            value: colorMode,
            defaultValue: "system",
            source: "user",
            lockedBy: null,
            locked: false,
            lockable: false,
            levelsBelow: [],
            editable: true,
            levels: [],
          },
        ],
      }),
      "GET /api/v1/notifications/unread-count": () => ({ body: { count: 0, capped: false } }),
    });
    window.history.replaceState(null, "", "/settings/preferences");
    const i18n = await initI18n(["en"]);
    render(<App i18n={i18n} queryClient={createQueryClient()} />);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    colorMode = "dark";
    FakeEventSource.last?.emit("settings", {
      key: "appearance.colorMode",
      level: "user",
      organizationId: null,
    });
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
  });
});

describe("syncRunChanged", () => {
  it("reloads everything a synchronization may have changed, also outside the provider", () => {
    const queryClient = createQueryClient();
    const provider = "01929b1e-0000-7000-8000-0000000000a1";
    const keys = [
      ["identityProviders", provider, "rules"],
      ["instance", "accounts", "identities", "01929b1e-0000-7000-8000-0000000000b1"],
      ["organization", "01929b1e-0000-7000-8000-0000000000c1", "groups"],
      ["organization", "01929b1e-0000-7000-8000-0000000000c1", "members"],
      ["group", "01929b1e-0000-7000-8000-0000000000d1", "members"],
      ["account", "identities"],
    ];
    const untouched = ["identityProviders", "01929b1e-0000-7000-8000-0000000000a2"];
    for (const key of [...keys, untouched]) queryClient.setQueryData(key, {});
    syncRunChanged(queryClient, provider);
    for (const key of keys) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(untouched)?.isInvalidated).toBe(false);
  });
});

describe("objectsChanged", () => {
  const organization = "01929b1e-0000-7000-8000-0000000000c1";

  it("reloads accounts, groups, invitations and the audit log after a change in an organization", () => {
    const queryClient = createQueryClient();
    const keys = [
      ["organization", organization, "groups"],
      ["organization", organization, "invitations"],
      ["organization", organization, "serviceAccounts"],
      ["group", "01929b1e-0000-7000-8000-0000000000d1", "members"],
      ["audit", "organization", organization, {}, null],
      ["audit", "instance", null, {}, null],
      ["instance", "accounts", "all", "page", "", null],
    ];
    const untouched = ["organization", "01929b1e-0000-7000-8000-0000000000c2", "groups"];
    for (const key of [...keys, untouched]) queryClient.setQueryData(key, {});
    objectsChanged(queryClient, [
      { scope: "organization", organizationId: organization, target: "invitation" },
    ]);
    for (const key of keys)
      expect(queryClient.getQueryState(key)?.isInvalidated, JSON.stringify(key)).toBe(true);
    expect(queryClient.getQueryState(untouched)?.isInvalidated).toBe(false);
  });

  it("reloads mapping rules after a rule changed and leaves unrelated lists alone", () => {
    const queryClient = createQueryClient();
    const rules = ["identityProviders", "01929b1e-0000-7000-8000-0000000000a1", "rules"];
    const accounts = ["instance", "accounts", "all", "page", "", null];
    queryClient.setQueryData(rules, {});
    queryClient.setQueryData(accounts, {});
    objectsChanged(queryClient, [{ scope: "instance", organizationId: null, target: "mappingRule" }]);
    expect(queryClient.getQueryState(rules)?.isInvalidated).toBe(true);
    const later = createQueryClient();
    later.setQueryData(rules, {});
    objectsChanged(later, [{ scope: "organization", organizationId: organization, target: "mappingRule" }]);
    expect(later.getQueryState(rules)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(accounts)?.isInvalidated).toBe(false);
  });

  it("reloads the import folder after the organization changed, since its path follows the slug", () => {
    const queryClient = createQueryClient();
    const folder = ["imports", "folder", organization];
    const other = ["imports", "folder", "01929b1e-0000-7000-8000-0000000000b2"];
    queryClient.setQueryData(folder, {});
    queryClient.setQueryData(other, {});
    objectsChanged(queryClient, [{ scope: "organization", organizationId: organization, target: "group" }]);
    expect(queryClient.getQueryState(folder)?.isInvalidated).toBe(false);
    objectsChanged(queryClient, [
      { scope: "organization", organizationId: organization, target: "organization" },
    ]);
    expect(queryClient.getQueryState(folder)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(other)?.isInvalidated).toBe(false);
  });

  it("follows change events from the stream in one batch", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const queryClient = createQueryClient();
      const accounts = ["instance", "accounts", "all", "page", "", null];
      queryClient.setQueryData(accounts, {});
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      function Probe() {
        useNotificationStream(true);
        return null;
      }
      render(
        <QueryClientProvider client={queryClient}>
          <Probe />
        </QueryClientProvider>,
      );
      for (let index = 0; index < 5; index += 1) {
        FakeEventSource.last?.emit("changes", { scope: "instance", organizationId: null, target: "account" });
      }
      FakeEventSource.last?.emit("changes", { scope: "instance", target: 3 });
      await vi.advanceTimersByTimeAsync(200);
      expect(queryClient.getQueryState(accounts)?.isInvalidated).toBe(true);
      const accountReloads = invalidate.mock.calls.filter(
        ([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(["instance", "accounts"]),
      );
      expect(accountReloads).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
