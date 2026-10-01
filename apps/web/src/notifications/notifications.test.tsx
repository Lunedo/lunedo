import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "../app.js";
import { initI18n } from "../i18n/index.js";
import { mockApi, problem } from "../testing/render.js";
import { groupByDay } from "./notification-panel.js";
import type { NotificationItem } from "./notifications-api.js";

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
  it("sorts notifications into today, yesterday and earlier", () => {
    const now = new Date("2026-10-01T12:00:00");
    const groups = groupByDay(
      [
        notification("a", { updatedAt: "2026-10-01T09:00:00" }),
        notification("b", { updatedAt: "2026-09-30T23:00:00" }),
        notification("c", { updatedAt: "2026-09-20T09:00:00" }),
      ],
      now,
    );
    expect(groups.map((group) => [group.key, group.items.map((item) => item.id)])).toEqual([
      ["today", ["a"]],
      ["yesterday", ["b"]],
      ["earlier", ["c"]],
    ]);
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
      "GET /api/v1/notifications/unread-count": () => ({ body: { count: unread } }),
      "GET /api/v1/notifications": () => ({ body: { items, nextCursor: null } }),
      "POST /api/v1/notifications/read-all": () => {
        unread = 0;
        return { body: { marked: 1 } };
      },
      "GET /api/v1/account/sessions": () => problem(404, "notFound"),
    });
    window.history.replaceState(null, "", "/settings/preferences");
    const i18n = await initI18n(["en"]);
    render(<App i18n={i18n} queryClient={createQueryClient()} />);

    expect(await screen.findByRole("button", { name: "Notifications, 1 unread" })).toBeTruthy();
    expect(FakeEventSource.last?.url).toBe("/api/v1/notifications/stream");
    FakeEventSource.last?.emit("notifications", { unreadCount: 4 });
    expect(await screen.findByRole("button", { name: "Notifications, 4 unread" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Notifications, 4 unread" }));
    const panel = screen.getByRole("complementary", { name: "Notifications" });
    expect(
      await within(panel).findByText("The guest access of Gina Guest to Platform Team ends on Oct 8, 2026."),
    ).toBeTruthy();
    expect(within(panel).getByText(/3 times/)).toBeTruthy();
    expect(
      within(panel).getByText(
        "Your account was signed in from a new browser: Firefox on Unknown, 198.51.100.7.",
      ),
    ).toBeTruthy();
    expect(within(panel).getByRole("heading", { name: "Today" })).toBeTruthy();
    expect(within(panel).getByRole("heading", { name: "Earlier" })).toBeTruthy();

    await userEvent.click(within(panel).getByRole("button", { name: "Mark all as read" }));
    await waitFor(() =>
      expect(requests.some((request) => request.path === "/api/v1/notifications/read-all")).toBe(true),
    );
    expect(await screen.findByRole("button", { name: "Notifications" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Notifications" })).toBeNull());
  });
});
