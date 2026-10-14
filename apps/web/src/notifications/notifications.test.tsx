import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "../app.js";
import { createFormatter } from "../format/format.js";
import { initI18n } from "../i18n/index.js";
import { mockApi, problem } from "../testing/render.js";
import "./builtin.js";
import { notificationText } from "./notification-entry.js";
import { groupByDay } from "./notification-panel.js";
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

describe("notificationText", () => {
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
      `Platform weekly on ${format.dateTime("2026-10-15T07:30:00.000Z")}: add your topics before the meeting so others can prepare.`,
    );
    expect(format.dateTime("2026-10-15T07:30:00.000Z")).toContain("09:30");
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

    expect(
      await screen.findByRole("button", { name: "Notifications, 1 unread" }, { timeout: 5000 }),
    ).toBeTruthy();
    expect(FakeEventSource.last?.url).toBe("/api/v1/notifications/stream");
    FakeEventSource.last?.emit("notifications", { unreadCount: 4 });
    expect(await screen.findByRole("button", { name: "Notifications, 4 unread" })).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Notifications, 4 unread" }));
    const panel = screen.getByRole("complementary", { name: "Notifications" });
    expect(
      await within(panel).findByText("The guest access of Gina Guest to Platform Team ends on 8 Oct 2026."),
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
      "GET /api/v1/notifications/unread-count": () => ({ body: { count: 0 } }),
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
