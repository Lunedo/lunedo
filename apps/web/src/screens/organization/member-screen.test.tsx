import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "../../app.js";
import { initI18n } from "../../i18n/index.js";
import { mockApi } from "../../testing/render.js";

const OLIVIA = {
  id: "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c",
  email: "olivia@example.org",
  name: "Olivia Owner",
};
const ORGANIZATION = {
  id: "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f",
  name: "Nordwind",
  slug: "nordwind",
  logoRef: null,
  language: "en",
  timeZone: "Europe/Vienna",
  accentColor: "petrol",
  createdAt: "2026-10-01T08:00:00.000Z",
  membershipKind: "member",
};
const FELIX = "01929b1e-0000-7000-8000-0000000000f1";
const IT = "01929b1e-0000-7000-8000-0000000000a1";
const SYNCED = "01929b1e-0000-7000-8000-0000000000a2";
const LEAD = "01929b1e-0000-7000-8000-0000000000a3";
const HELP = "01929b1e-0000-7000-8000-0000000000b1";
const STORE = "01929b1e-0000-7000-8000-0000000000b2";
const PROVIDER = "01929b1e-0000-7000-8000-0000000000c1";

const member = {
  accountId: FELIX,
  name: "Felix Gruber",
  jobTitle: null,
  pictureRef: null,
  email: "felix@example.org",
  accountType: "guest",
  kind: "guest",
  expiresAt: "2027-02-21T22:59:59.000Z",
  responsibleAccountId: OLIVIA.id,
  roles: [],
  groups: [
    { id: IT, name: "IT" },
    { id: SYNCED, name: "Entra staff" },
    { id: LEAD, name: "Leads" },
  ],
  twoFactorActive: false,
  lastActiveAt: null,
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

function memberApi(options: { factorRequired?: boolean; permissions?: string[] } = {}) {
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
      body: { sessionKind: "full", account: OLIVIA, methods: ["password"], recentlyAuthenticated: true },
    }),
    "GET /api/v1/organizations": () => ({ body: { items: [ORGANIZATION], nextCursor: null } }),
    [`GET /api/v1/organizations/${ORGANIZATION.id}`]: () => ({ body: ORGANIZATION }),
    "GET /api/v1/account/permissions": () => ({
      body: {
        instance: [],
        organization: options.permissions ?? [
          "organization.view",
          "organization.members.view",
          "organization.members.manage",
          "organization.settings.view",
          "organization.spaces.view",
          "organization.spaces.manage",
          "organization.audit.view",
        ],
        grantableAreas: { instance: {}, organization: {} },
      },
    }),
    "GET /api/v1/account/preferences": () => ({ body: [] }),
    "GET /api/v1/notifications/unread-count": () => ({ body: { count: 0, capped: false } }),
    [`GET /api/v1/organizations/${ORGANIZATION.id}/settings`]: () => ({
      body: {
        items: [{ key: "auth.twoFactorRequired", value: options.factorRequired ?? false }],
        nextCursor: null,
      },
    }),
    [`GET /api/v1/organizations/${ORGANIZATION.id}/members`]: () => ({
      body: {
        items: [
          member,
          {
            ...member,
            accountId: OLIVIA.id,
            name: OLIVIA.name,
            kind: "member",
            accountType: "standard",
            groups: [],
          },
        ],
        nextCursor: null,
      },
    }),
    [`GET /api/v1/organizations/${ORGANIZATION.id}/invitations`]: () => ({ body: [] }),
    [`GET /api/v1/organizations/${ORGANIZATION.id}/members/${FELIX}`]: () => ({
      body: {
        ...member,
        joinedAt: "2026-08-21T09:58:00.000Z",
        invitedBy: { id: OLIVIA.id, name: OLIVIA.name },
        homeOrganization: true,
        twoFactorRequired: false,
        signIn: { password: true, providers: [] },
        groupDetails: [
          { id: IT, name: "IT", managedBy: null, viaProvider: null, spaces: 2 },
          {
            id: SYNCED,
            name: "Entra staff",
            managedBy: null,
            viaProvider: { providerId: PROVIDER, providerName: "Entra ID" },
            spaces: 0,
          },
        ],
        spaces: [
          { id: HELP, key: "HELP", name: "Help center", role: "reader", sources: [{ kind: "direct" }] },
        ],
      },
    }),
    [`GET /api/v1/organizations/${ORGANIZATION.id}/groups`]: () => ({
      body: {
        items: [
          {
            id: IT,
            organizationId: ORGANIZATION.id,
            name: "IT",
            description: "",
            memberCount: 3,
            spaceCount: 2,
          },
          {
            id: LEAD,
            organizationId: ORGANIZATION.id,
            name: "Leads",
            description: "",
            memberCount: 1,
            spaceCount: 1,
          },
        ],
        nextCursor: null,
      },
    }),
    [`POST /api/v1/groups/${LEAD}/members`]: () => ({ status: 204 }),
    [`GET /api/v1/organizations/${ORGANIZATION.id}/spaces`]: () => ({
      body: {
        items: [
          { id: HELP, key: "HELP", name: "Help center", confidential: false },
          { id: STORE, key: "STORE", name: "Store north", confidential: false },
          { id: PROVIDER, key: "WC", name: null, confidential: true },
        ],
        nextCursor: null,
      },
    }),
    "GET /api/v1/spaces": () => ({ body: { items: [], nextCursor: null } }),
    [`POST /api/v1/organizations/${ORGANIZATION.id}/members/${FELIX}/spaces`]: () => ({ status: 204 }),
    [`GET /api/v1/organizations/${ORGANIZATION.id}/audit-events`]: () => ({
      body: { items: [], nextCursor: null },
    }),
  });
}

async function open(path: string, heading: string) {
  window.history.replaceState(null, "", path);
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
  await screen.findByRole("heading", { name: heading, level: 1 });
}

describe("the member table", () => {
  it("shows one line per person, two groups and the count of the rest, and opens the member page", async () => {
    memberApi();
    await open(`/settings/organizations/${ORGANIZATION.id}/members`, "Members");
    const row = (await screen.findByText("Felix Gruber")).closest("tr") as HTMLElement;
    expect(within(row).getByText("IT, Entra staff")).toBeTruthy();
    expect(within(row).getByText("+1")).toBeTruthy();
    expect(within(row).getByText("No")).toBeTruthy();
    expect(within(row).queryByText("Missing")).toBeNull();
    await userEvent.click(within(row).getByText("felix@example.org"));
    expect(await screen.findByRole("heading", { name: "Felix Gruber", level: 1 })).toBeTruthy();
  });

  it("marks a missing second factor only when the organization requires one", async () => {
    memberApi({ factorRequired: true });
    await open(`/settings/organizations/${ORGANIZATION.id}/members`, "Members");
    const row = (await screen.findByText("Felix Gruber")).closest("tr") as HTMLElement;
    expect(await within(row).findByText("Missing")).toBeTruthy();
  });
});

describe("the member page", () => {
  const path = `/settings/organizations/${ORGANIZATION.id}/members/${FELIX}`;

  it("shows membership and sign-in and keeps the removal of provider groups disabled with the reason", async () => {
    memberApi();
    await open(path, "Felix Gruber");
    expect(screen.getByRole("button", { name: "Extend access" })).toBeTruthy();
    expect(screen.getByText("(not required by the organization)")).toBeTruthy();
    expect(screen.getByText("Password")).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: /Groups/ }));
    expect(screen.getByRole("button", { name: "Remove from IT" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "Remove from Entra staff" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(screen.getByText(/the next synchronization would add the person again/)).toBeTruthy();
  });

  it("adds the person to several groups after showing the access they give", async () => {
    const api = memberApi();
    await open(path, "Felix Gruber");
    await userEvent.click(screen.getByRole("button", { name: "Add to groups" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Felix Gruber to groups" });
    expect(await within(dialog).findByText("already a member")).toBeTruthy();
    expect(within(dialog).getByRole("checkbox", { name: "IT" }).hasAttribute("disabled")).toBe(true);
    await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(within(dialog).getByRole("alert").textContent).toBe("Choose at least one group.");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Leads" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(within(dialog).getByText(/becomes a member of Leads and gets access to 1 space/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(api.requests.find((request) => request.path === `/api/v1/groups/${LEAD}/members`)?.body).toEqual(
        {
          accountId: FELIX,
        },
      ),
    );
  });

  it("adds the person to spaces with one role each, never offering confidential spaces", async () => {
    const api = memberApi();
    await open(path, "Felix Gruber");
    await userEvent.click(screen.getByRole("tab", { name: /Spaces/ }));
    await userEvent.click(screen.getByRole("button", { name: "Add to spaces" }));
    const dialog = await screen.findByRole("dialog", { name: "Add Felix Gruber to spaces" });
    expect(await within(dialog).findByRole("checkbox", { name: "Store north" })).toBeTruthy();
    expect(within(dialog).getByRole("checkbox", { name: "Help center" }).hasAttribute("disabled")).toBe(true);
    expect(within(dialog).getByText("already Reader")).toBeTruthy();
    expect(within(dialog).queryByText("WC")).toBeNull();
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Store north" }));
    await userEvent.click(within(dialog).getByRole("combobox", { name: "Role in Store north" }));
    expect(screen.queryByRole("option", { name: "Space admin" })).toBeNull();
    await userEvent.click(await screen.findByRole("option", { name: "Editor" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(within(dialog).getByText("gets a role in Store north (Editor).")).toBeTruthy();
    expect(within(dialog).getByText(/space admins of the chosen spaces are notified/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(
        api.requests.find((request) => request.method === "POST" && request.path.endsWith("/spaces"))?.body,
      ).toEqual({ spaces: [{ spaceId: STORE, role: "editor" }] }),
    );
  });

  it("lists the activity of the person in this organization", async () => {
    const api = memberApi();
    await open(path, "Felix Gruber");
    await userEvent.click(screen.getByRole("tab", { name: "Activity" }));
    await waitFor(() =>
      expect(
        api.requests.some(
          (request) => request.path.includes(`audit-events?`) && request.path.includes(`personId=${FELIX}`),
        ),
      ).toBe(true),
    );
  });
});
