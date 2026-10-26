import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "../app.js";
import { initI18n } from "../i18n/index.js";
import { mockApi, problem, type RecordedRequest } from "../testing/render.js";

const OLIVIA = {
  id: "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c",
  email: "olivia@example.org",
  name: "Olivia Owner",
};
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
const ITOPS_ID = "01929b1e-0000-7000-8000-0000000000a1";
const HR_ID = "01929b1e-0000-7000-8000-0000000000a2";
const VPN = "01929b1e-0000-7000-8000-0000000000b2";
const RUNBOOKS = "01929b1e-0000-7000-8000-0000000000b3";

type Handler = (request: RecordedRequest) => { status?: number; body?: unknown };

const space = (id: string, key: string, name: string) => ({
  id,
  key,
  name,
  description: "",
  visibility: "private",
  organizationId: ORGANIZATION.id,
  organizationName: ORGANIZATION.name,
  personal: false,
  ownerId: null,
  ownerName: null,
  overviewItemId: null,
  overviewItemNumber: null,
  archived: false,
  createdAt: "2026-10-05T08:00:00.000Z",
  updatedAt: "2026-10-05T08:00:00.000Z",
  role: "reader",
});

const item = (id: string, number: number, kind: "page" | "folder", title: string, spaceId = ITOPS_ID) => ({
  id,
  number,
  spaceId,
  parentId: null,
  kind,
  title,
  description: "",
  width: "fixed",
  mode: "live",
  published: true,
  archived: false,
  position: "a0",
  hasChildren: false,
  viewRestriction: "none",
  editRestricted: false,
  link: null,
  creatorId: OLIVIA.id,
  ownerId: OLIVIA.id,
  status: null,
  createdAt: "2026-10-05T08:00:00.000Z",
  updatedAt: "2026-10-05T08:00:00.000Z",
  contentUpdatedAt: "2026-10-05T08:00:00.000Z",
});

const details = (base: ReturnType<typeof item>, spaceKey = "ITOPS", spaceName = "IT Operations") => ({
  ...base,
  spaceKey,
  spaceName,
  spaceAccess: true,
  ancestors: [],
  owner: null,
  ownershipTransferable: false,
});

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
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

function routes(extra: Record<string, Handler> = {}): Record<string, Handler> {
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
    "GET /api/v1/space-keys/ITOPS": () => ({
      body: { space: space(ITOPS_ID, "ITOPS", "IT Operations"), redirected: false },
    }),
    "GET /api/v1/space-keys/HR": () => ({
      body: { space: space(HR_ID, "HR", "People"), redirected: false },
    }),
    [`GET /api/v1/spaces/${ITOPS_ID}/items`]: () => ({
      body: { items: [item(VPN, 1002, "page", "VPN access"), item(RUNBOOKS, 1003, "folder", "Runbooks")] },
    }),
    [`GET /api/v1/spaces/${HR_ID}/items`]: () => ({ body: { items: [], nextCursor: null } }),
    [`GET /api/v1/spaces/${ITOPS_ID}/archive`]: () => ({ body: [] }),
    [`GET /api/v1/spaces/${HR_ID}/archive`]: () => ({ body: [] }),
    [`GET /api/v1/items/${VPN}`]: () => ({ body: details(item(VPN, 1002, "page", "VPN access")) }),
    [`GET /api/v1/items/${RUNBOOKS}`]: () => ({ body: details(item(RUNBOOKS, 1003, "folder", "Runbooks")) }),
    [`GET /api/v1/pages/${VPN}/content`]: () => ({
      body: {
        itemId: VPN,
        title: "VPN access",
        version: 7,
        document: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Connect first" }] }],
        },
        schemaVersion: 2,
        revision: 4,
        updatedAt: "2026-10-05T08:10:00.000Z",
        updatedBy: OLIVIA.id,
        references: { people: {}, pages: {} },
      },
    }),
    [`GET /api/v1/pages/${VPN}/labels`]: () => ({ body: [] }),
    [`GET /api/v1/pages/${VPN}/backlinks`]: () => ({ body: [] }),
    ...extra,
  };
}

async function renderAt(path: string) {
  window.history.replaceState(null, "", path);
  const pushes = vi.spyOn(window.history, "pushState");
  const length = window.history.length;
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
  return {
    expectReplaced: () => {
      expect(pushes).not.toHaveBeenCalled();
      expect(window.history.length).toBe(length);
    },
  };
}

describe("content addresses", () => {
  it("replaces a space key that names no space with the key of the item's space", async () => {
    mockApi(routes({ "GET /api/v1/space-keys/NOPE": () => problem(404, "notFound") }));
    const { expectReplaced } = await renderAt("/spaces/NOPE/pages/1002/vpn-access");
    await waitFor(() => expect(window.location.pathname).toBe("/spaces/ITOPS/pages/1002/vpn-access"));
    expect(await screen.findByText("Connect first")).toBeTruthy();
    expectReplaced();
  });

  it("replaces the segment of another content kind with the segment of the item's kind", async () => {
    mockApi(routes());
    const { expectReplaced } = await renderAt("/spaces/ITOPS/folders/1002/vpn-access");
    await waitFor(() => expect(window.location.pathname).toBe("/spaces/ITOPS/pages/1002/vpn-access"));
    expect(await screen.findByText("Connect first")).toBeTruthy();
    expectReplaced();
  });

  it("replaces an outdated or missing title in the address with the current one", async () => {
    mockApi(routes());
    const outdated = await renderAt("/spaces/ITOPS/pages/1002/remote-access");
    await waitFor(() => expect(window.location.pathname).toBe("/spaces/ITOPS/pages/1002/vpn-access"));
    expect(await screen.findByText("Connect first")).toBeTruthy();
    outdated.expectReplaced();
  });

  it("leads the address of a page moved to another space to its new space", async () => {
    mockApi(
      routes({
        [`GET /api/v1/items/${VPN}`]: () => ({
          body: details(item(VPN, 1002, "page", "VPN access", HR_ID), "HR", "People"),
        }),
      }),
    );
    const { expectReplaced } = await renderAt("/spaces/ITOPS/pages/1002/vpn-access");
    await waitFor(() => expect(window.location.pathname).toBe("/spaces/HR/pages/1002/vpn-access"));
    expect(await screen.findByText("Connect first")).toBeTruthy();
    expectReplaced();
  });

  it("keeps the anchor and the query when it replaces the address", async () => {
    mockApi(routes());
    await renderAt("/spaces/NOPE/folders/1002/remote-access?edit=false#gateway");
    await waitFor(() => expect(window.location.pathname).toBe("/spaces/ITOPS/pages/1002/vpn-access"));
    expect(window.location.hash).toBe("#gateway");
    expect(window.location.search).toBe("?edit=false");
  });

  it("shows the not-found screen for an address with an item ID instead of a number", async () => {
    const { requests } = mockApi(routes());
    await renderAt(`/spaces/ITOPS/pages/${VPN}/vpn-access`);
    expect(await screen.findByText("Page not found")).toBeTruthy();
    expect(screen.queryByText("Connect first")).toBeNull();
    expect(window.location.pathname).toBe(`/spaces/ITOPS/pages/${VPN}/vpn-access`);
    expect(
      requests.some(
        (request) =>
          request.path.startsWith(`/api/v1/items/${VPN}`) || request.path.startsWith(`/api/v1/pages/${VPN}`),
      ),
    ).toBe(false);
  });

  it("shows the same screen for a number without access and for a number that does not exist", async () => {
    mockApi(routes({ "GET /api/v1/items/by-number/1050": () => problem(404, "notFound") }));
    await renderAt("/spaces/ITOPS/pages/1050/payroll");
    const hidden = await screen.findByRole("heading", {
      name: "This page does not exist or you have no access",
    });
    const hiddenText = document.querySelector("main")?.textContent;
    expect(window.location.pathname).toBe("/spaces/ITOPS/pages/1050/payroll");
    expect(screen.queryByText(/Payroll/)).toBeNull();
    window.history.replaceState(null, "", "/");
    cleanup();

    mockApi(routes());
    await renderAt("/spaces/ITOPS/pages/1999/payroll");
    const unknown = await screen.findByRole("heading", {
      name: "This page does not exist or you have no access",
    });
    expect(unknown.textContent).toBe(hidden.textContent);
    expect(document.querySelector("main")?.textContent).toBe(hiddenText);
    expect(window.location.pathname).toBe("/spaces/ITOPS/pages/1999/payroll");
  });

  it("loads no page content when the number belongs to a folder", async () => {
    const { requests } = mockApi(routes());
    await renderAt("/spaces/ITOPS/folders/1003/runbooks");
    expect(await screen.findByRole("heading", { name: "Runbooks", level: 1 })).toBeTruthy();
    expect(window.location.pathname).toBe("/spaces/ITOPS/folders/1003/runbooks");
    expect(requests.some((request) => request.path.includes("/content"))).toBe(false);
  });

  it("loads no page content while it leads a page address of a folder to the folder", async () => {
    const { requests } = mockApi(routes());
    await renderAt("/spaces/ITOPS/pages/1003/runbooks");
    await waitFor(() => expect(window.location.pathname).toBe("/spaces/ITOPS/folders/1003/runbooks"));
    expect(await screen.findByRole("heading", { name: "Runbooks", level: 1 })).toBeTruthy();
    expect(requests.some((request) => request.path.startsWith(`/api/v1/pages/${RUNBOOKS}/`))).toBe(false);
  });
});
