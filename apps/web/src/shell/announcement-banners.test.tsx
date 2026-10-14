import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../api/queries.js";
import { mockApi, problem, renderWithProviders } from "../testing/render.js";
import {
  AnnouncementBanners,
  announcementKeys,
  announcementsChanged,
  type BannerAnnouncement,
  nextAnnouncementChange,
  visibleAnnouncements,
} from "./announcement-banners.js";
import { OrganizationProvider } from "./shell-context.js";

const ORGANIZATION = "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f";
const OTHER = "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e60";
const NOW = Date.parse("2026-10-14T10:00:00.000Z");
const HOUR = 3_600_000;

function announcement(patch: Partial<BannerAnnouncement>): BannerAnnouncement {
  return {
    id: "01929b1e-0000-7000-8000-0000000000f1",
    scope: "organization",
    organizationId: ORGANIZATION,
    version: "01929b1e-0000-7000-8000-0000000000f2",
    severity: "information",
    text: "New: search in attachments.",
    link: null,
    startsAt: new Date(NOW - HOUR).toISOString(),
    endsAt: new Date(NOW + HOUR).toISOString(),
    dismissed: false,
    ...patch,
  };
}

const session = {
  sessionKind: "full",
  account: { id: "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c", email: "olivia@example.org", name: "Olivia" },
  methods: ["password"],
  recentlyAuthenticated: true,
} as unknown as SessionInfo;

function banners() {
  const root = createRootRoute({
    component: () => (
      <OrganizationProvider session={session}>
        <AnnouncementBanners />
      </OrganizationProvider>
    ),
  });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  return <RouterProvider router={router} />;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("visible announcements", () => {
  it("shows the instance banner above the banner of the current organization, at most one of each", () => {
    const instance = announcement({ id: "i", scope: "instance", organizationId: null, severity: "warning" });
    const own = announcement({ id: "o" });
    const other = announcement({ id: "x", organizationId: OTHER });
    expect(visibleAnnouncements([own, other, instance], ORGANIZATION, NOW).map((entry) => entry.id)).toEqual([
      "i",
      "o",
    ]);
    expect(visibleAnnouncements([own, instance], null, NOW).map((entry) => entry.id)).toEqual(["i"]);
  });

  it("hides banners before their start and from their end, and dismissed information but never a warning", () => {
    const later = announcement({ id: "later", startsAt: new Date(NOW + HOUR).toISOString() });
    const ended = announcement({ id: "ended", endsAt: new Date(NOW).toISOString() });
    const dismissed = announcement({ id: "dismissed", dismissed: true });
    const warning = announcement({
      id: "warning",
      scope: "instance",
      organizationId: null,
      severity: "warning",
      dismissed: true,
    });
    expect(
      visibleAnnouncements([later, ended, dismissed, warning], ORGANIZATION, NOW).map((entry) => entry.id),
    ).toEqual(["warning"]);
    expect(nextAnnouncementChange([later, ended], NOW)).toBe(NOW + HOUR);
    expect(nextAnnouncementChange([ended], NOW)).toBeNull();
  });
});

describe("the announcement banners", () => {
  function api(list: () => BannerAnnouncement[], onDismiss: () => void = () => {}) {
    return mockApi({
      "GET /api/v1/auth/session": () => ({ body: session }),
      "GET /api/v1/organizations": () => ({
        body: {
          items: [
            {
              id: ORGANIZATION,
              name: "Northwind",
              slug: "northwind",
              logoRef: null,
              language: "en",
              timeZone: "Europe/Vienna",
              accentColor: "petrol",
              createdAt: "2026-10-01T08:00:00.000Z",
              membershipKind: "member",
            },
          ],
          nextCursor: null,
        },
      }),
      "GET /api/v1/account/permissions": () => ({ body: { instance: [], organization: [] } }),
      "GET /api/v1/announcements": () => ({ body: list() }),
      "POST /api/v1/announcements/01929b1e-0000-7000-8000-0000000000f1/dismiss": () => {
        onDismiss();
        return { status: 204 };
      },
    });
  }

  it("lets people dismiss information but not a warning, and shows changes without a reload", async () => {
    let list = [
      announcement({
        id: "01929b1e-0000-7000-8000-0000000000e1",
        scope: "instance",
        organizationId: null,
        severity: "warning",
        text: "Maintenance tonight.",
        startsAt: new Date(Date.now() - HOUR).toISOString(),
        endsAt: new Date(Date.now() + HOUR).toISOString(),
      }),
      announcement({
        text: "New: search in attachments.",
        link: { url: "https://wiki.example.org/blog", label: "Read the post" },
        startsAt: new Date(Date.now() - HOUR).toISOString(),
        endsAt: new Date(Date.now() + HOUR).toISOString(),
      }),
    ];
    const { requests } = api(
      () => list,
      () => {
        list = list.map((entry) => (entry.scope === "organization" ? { ...entry, dismissed: true } : entry));
      },
    );
    const { queryClient } = await renderWithProviders(banners());
    const instance = await screen.findByRole("region", { name: "Instance announcement" });
    expect(within(instance).getByText(/Maintenance tonight/)).toBeTruthy();
    expect(within(instance).queryByRole("button", { name: "Dismiss announcement" })).toBeNull();
    const organization = await screen.findByRole("region", { name: "Organization announcement" });
    expect(within(organization).getByText(/· Northwind/)).toBeTruthy();
    const link = within(organization).getByRole("link", { name: /Read the post/ });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");

    await userEvent.click(within(organization).getByRole("button", { name: "Dismiss announcement" }));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Organization announcement" })).toBeNull(),
    );
    expect(requests.find((request) => request.method === "POST")?.body).toEqual({
      version: "01929b1e-0000-7000-8000-0000000000f2",
    });

    list = [
      list[0] as BannerAnnouncement,
      { ...(list[1] as BannerAnnouncement), text: "Changed", dismissed: false },
    ];
    announcementsChanged(queryClient);
    expect(await screen.findByText(/Changed/)).toBeTruthy();
    expect(queryClient.getQueryData(announcementKeys.shown)).toHaveLength(2);
  });

  it("shows a banner at its start and removes it at its end without a reload", async () => {
    const start = Date.now() + 300;
    api(() => [
      announcement({
        text: "Short notice",
        startsAt: new Date(start).toISOString(),
        endsAt: new Date(start + 400).toISOString(),
      }),
    ]);
    await renderWithProviders(banners());
    await waitFor(() => expect(screen.getByText(/Short notice/)).toBeTruthy(), { timeout: 2000 });
    await waitFor(() => expect(screen.queryByText(/Short notice/)).toBeNull(), { timeout: 2000 });
  });

  it("shows nothing when the announcements cannot be loaded", async () => {
    mockApi({
      "GET /api/v1/auth/session": () => ({ body: session }),
      "GET /api/v1/organizations": () => ({ body: { items: [], nextCursor: null } }),
      "GET /api/v1/account/permissions": () => ({ body: { instance: [], organization: [] } }),
      "GET /api/v1/announcements": () => problem(500, "internal"),
    });
    await renderWithProviders(banners());
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByRole("region", { name: /announcement/ })).toBeNull();
  });
});
