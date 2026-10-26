import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "../../app.js";
import { initI18n } from "../../i18n/index.js";
import { mockApi, problem, type RecordedRequest } from "../../testing/render.js";

const OLIVIA = {
  id: "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c",
  email: "olivia@example.org",
  name: "Olivia Owner",
};
const EMIL = "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7d";
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
const VERIFIED = "01929b1e-0000-7000-8000-0000000000c4";
const DRAFTING = "01929b1e-0000-7000-8000-0000000000c1";

type Role = "reader" | "editor" | "admin";

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

const verified = { id: VERIFIED, builtIn: "verified", name: null, color: "success" };

const page = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  spaceId: SPACE_ID,
  parentId: null,
  kind: "page",
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
  ...extra,
});

const details = (extra: Record<string, unknown> = {}) => ({
  ...page(VPN, "VPN access"),
  spaceKey: "ITOPS",
  spaceName: "IT Operations",
  spaceAccess: true,
  ancestors: [],
  owner: { id: OLIVIA.id, name: OLIVIA.name, email: OLIVIA.email, active: true },
  ownershipTransferable: false,
  ...extra,
});

const statusValues = {
  enabled: true,
  values: [
    { id: DRAFTING, builtIn: "roughDraft", name: null, color: "neutral", position: 0, pages: 0 },
    { ...verified, position: 1, pages: 3 },
  ],
};

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

function routes(
  role: Role,
  extra: Record<string, (request: RecordedRequest) => { status?: number; body?: unknown }> = {},
) {
  const document = {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Text" }] }],
  };
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
      body: { items: [page(OVERVIEW, "IT Operations"), page(VPN, "VPN access")], nextCursor: null },
    }),
    [`GET /api/v1/spaces/${SPACE_ID}/archive`]: () => ({ body: [] }),
    [`GET /api/v1/spaces/${SPACE_ID}/page-statuses`]: () => ({ body: statusValues }),
    [`GET /api/v1/items/${VPN}`]: () => ({ body: details() }),
    [`GET /api/v1/pages/${VPN}/content`]: () => ({
      body: {
        itemId: VPN,
        title: "VPN access",
        version: 7,
        document,
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
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
}

describe("page header", () => {
  it("shows readers the owner and the status without letting them change either", async () => {
    mockApi(
      routes("reader", { [`GET /api/v1/items/${VPN}`]: () => ({ body: details({ status: verified }) }) }),
    );
    await renderAt(`/spaces/ITOPS/pages/${VPN}/vpn-access`);
    expect(await screen.findByRole("button", { name: "Owner: Olivia Owner" })).toBeTruthy();
    expect(screen.getByText("Verified")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Change the status/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: "Change the status" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "Transfer ownership" })).toBeNull();
    expect(within(menu).queryByRole("menuitem", { name: "Add label" })).toBeNull();
  });

  it("lets editors set the status from the page menu", async () => {
    const { requests } = mockApi(
      routes("editor", { [`PUT /api/v1/items/${VPN}/status`]: () => ({ body: verified }) }),
    );
    await renderAt(`/spaces/ITOPS/pages/${VPN}/vpn-access`);
    await screen.findByRole("button", { name: "Owner: Olivia Owner" });
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Change the status" }));
    const dialog = await screen.findByRole("dialog", { name: "Change the status" });
    await userEvent.click(await within(dialog).findByRole("button", { name: "Verified" }));
    await waitFor(() =>
      expect(requests.find((request) => request.method === "PUT")?.body).toEqual({ statusId: VERIFIED }),
    );
  });

  it("transfers ownership to a person who can edit, after asking for one", async () => {
    const { requests } = mockApi(
      routes("editor", {
        [`GET /api/v1/items/${VPN}`]: () => ({ body: details({ ownershipTransferable: true }) }),
        [`GET /api/v1/items/${VPN}/owner-candidates`]: () => ({
          body: [{ id: EMIL, name: "Emil Editor", email: "emil@example.org" }],
        }),
        [`PUT /api/v1/items/${VPN}/owner`]: () => ({ status: 204 }),
      }),
    );
    await renderAt(`/spaces/ITOPS/pages/${VPN}/vpn-access`);
    await screen.findByRole("button", { name: "Owner: Olivia Owner" });
    expect(screen.queryByRole("button", { name: "Transfer ownership" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Transfer ownership" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Transfer ownership" }));
    expect(await within(dialog).findByText("Choose the new owner.")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("combobox"));
    await userEvent.click(await screen.findByRole("option", { name: /Emil Editor/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Transfer ownership" }));
    await waitFor(() =>
      expect(requests.find((request) => request.method === "PUT")?.body).toEqual({ ownerId: EMIL }),
    );
    expect(await screen.findByText("Emil Editor is now the owner of “VPN access”")).toBeTruthy();
  });

  it("explains a refused transfer in the dialog", async () => {
    mockApi(
      routes("editor", {
        [`GET /api/v1/items/${VPN}`]: () => ({ body: details({ ownershipTransferable: true }) }),
        [`GET /api/v1/items/${VPN}/owner-candidates`]: () => ({
          body: [{ id: EMIL, name: "Emil Editor", email: null }],
        }),
        [`PUT /api/v1/items/${VPN}/owner`]: () => problem(400, "ownerNeedsEditAccess"),
      }),
    );
    await renderAt(`/spaces/ITOPS/pages/${VPN}/vpn-access`);
    await userEvent.click(await screen.findByRole("button", { name: "More actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Transfer ownership" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("combobox"));
    await userEvent.click(await screen.findByRole("option", { name: /Emil Editor/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Transfer ownership" }));
    expect(await within(dialog).findByText(/cannot edit this content/)).toBeTruthy();
  });
});

describe("space settings", () => {
  it("asks before removing a used status value and names how many pages lose it", async () => {
    const { requests } = mockApi(
      routes("admin", {
        [`GET /api/v1/spaces/${SPACE_ID}/settings`]: () => ({ body: [] }),
        [`DELETE /api/v1/spaces/${SPACE_ID}/page-statuses/${VERIFIED}`]: () => ({ status: 204 }),
      }),
    );
    await renderAt("/spaces/ITOPS/settings/status");
    await userEvent.click(await screen.findByRole("button", { name: "Remove “Verified”" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/3 pages have this status and lose it/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove status" }));
    await waitFor(() => {
      const removal = requests.find((request) => request.method === "DELETE");
      expect(removal?.path).toContain(`/page-statuses/${VERIFIED}`);
      expect(removal?.path).toContain("pages=3");
    });
  });

  it("lists content without an owner and assigns a new owner", async () => {
    const { requests } = mockApi(
      routes("admin", {
        [`GET /api/v1/spaces/${SPACE_ID}/settings`]: () => ({ body: [] }),
        [`GET /api/v1/spaces/${SPACE_ID}/storage`]: () => ({ body: { usedBytes: 0, files: 0 } }),
        [`GET /api/v1/spaces/${SPACE_ID}/unowned-items`]: () => ({
          body: {
            items: [
              {
                id: VPN,
                spaceId: SPACE_ID,
                spaceKey: "ITOPS",
                spaceName: "IT Operations",
                kind: "page",
                title: "VPN access",
                formerOwner: { id: OLIVIA.id, name: "Olivia Owner" },
                reason: "deactivated",
              },
            ],
            hidden: 2,
            nextCursor: null,
          },
        }),
        [`GET /api/v1/items/${VPN}/owner-candidates`]: () => ({
          body: [{ id: EMIL, name: "Emil Editor", email: null }],
        }),
        [`PUT /api/v1/items/${VPN}/owner`]: () => ({ status: 204 }),
      }),
    );
    await renderAt("/spaces/ITOPS/settings/content");
    expect(await screen.findByText("Olivia Owner was deactivated")).toBeTruthy();
    expect(screen.getByText("2 more items have no owner")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Assign owner" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("combobox"));
    await userEvent.click(await screen.findByRole("option", { name: /Emil Editor/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Assign owner" }));
    await waitFor(() =>
      expect(requests.find((request) => request.method === "PUT")?.body).toEqual({ ownerId: EMIL }),
    );
  });
});
