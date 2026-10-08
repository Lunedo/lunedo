import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
const SPACE_ID = "01929b1e-0000-7000-8000-0000000000a1";
const OVERVIEW = "01929b1e-0000-7000-8000-0000000000b0";
const RUNBOOKS = "01929b1e-0000-7000-8000-0000000000b1";
const VPN = "01929b1e-0000-7000-8000-0000000000b2";
const NETWORK = "01929b1e-0000-7000-8000-0000000000b3";
const ANNA = "01929b1e-0000-7000-8000-0000000000c1";
const PERMISSION = "01929b1e-0000-7000-8000-0000000000d1";

const space = (role: "reader" | "editor" | "admin" = "admin") => ({
  id: SPACE_ID,
  key: "ITOPS",
  name: "IT Operations",
  description: "Runbooks of the IT team",
  visibility: "private",
  discoverable: false,
  organizationId: ORGANIZATION.id,
  organizationName: ORGANIZATION.name,
  personal: false,
  ownerId: null,
  ownerName: null,
  overviewItemId: OVERVIEW,
  createdAt: "2026-10-05T08:00:00.000Z",
  updatedAt: "2026-10-05T08:00:00.000Z",
  role,
});

const item = (
  id: string,
  title: string,
  kind: "page" | "folder",
  parentId: string | null,
  hasChildren = false,
) => ({
  id,
  spaceId: SPACE_ID,
  parentId,
  kind,
  title,
  description: "",
  width: "fixed",
  position: "a0",
  hasChildren,
  link: null,
  creatorId: OLIVIA.id,
  ownerId: OLIVIA.id,
  createdAt: "2026-10-05T08:00:00.000Z",
  updatedAt: "2026-10-05T08:00:00.000Z",
  contentUpdatedAt: "2026-10-05T08:00:00.000Z",
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
  window.history.replaceState(null, "", "/");
});

function baseRoutes(permissions: string[] = ["organization.view", "organization.spaces.create"]) {
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
        instance: ["instance.content.view", "instance.personalSpace.use"],
        organization: permissions,
        grantableAreas: { instance: {}, organization: {} },
      },
    }),
    "GET /api/v1/account/preferences": () => ({ body: [] }),
    "GET /api/v1/notifications/unread-count": () => ({ body: { count: 0 } }),
  };
}

function spaceRoutes(role: "reader" | "editor" | "admin" = "admin") {
  return {
    "GET /api/v1/space-keys/ITOPS": () => ({ body: { space: space(role), redirected: false } }),
    "GET /api/v1/space-keys/OLDKEY": () => ({ body: { space: space(role), redirected: true } }),
    [`GET /api/v1/spaces/${SPACE_ID}/items`]: (request: RecordedRequest) => {
      const parent = new URL(request.path, "http://localhost").searchParams.get("parentId");
      if (parent === RUNBOOKS)
        return { body: { items: [item(VPN, "VPN access", "page", RUNBOOKS)], nextCursor: null } };
      return {
        body: {
          items: [
            item(OVERVIEW, "IT Operations", "page", null),
            item(RUNBOOKS, "Runbooks", "folder", null, true),
            item(NETWORK, "Network", "page", null),
          ],
          nextCursor: null,
        },
      };
    },
    [`GET /api/v1/items/${RUNBOOKS}`]: () => ({
      body: {
        ...item(RUNBOOKS, "Runbooks", "folder", null, true),
        spaceKey: "ITOPS",
        spaceName: "IT Operations",
        ancestors: [],
      },
    }),
    [`GET /api/v1/items/${OVERVIEW}`]: () => ({
      body: {
        ...item(OVERVIEW, "IT Operations", "page", null),
        spaceKey: "ITOPS",
        spaceName: "IT Operations",
        ancestors: [],
      },
    }),
  };
}

async function renderAt(path: string) {
  window.history.replaceState(null, "", path);
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
}

describe("spaces", () => {
  it("lists readable spaces, filters them and offers to clear a filter without results", async () => {
    const { requests } = mockApi({
      ...baseRoutes(),
      "GET /api/v1/spaces": (request) =>
        request.path.includes("q=nothing")
          ? { body: { items: [], nextCursor: null } }
          : { body: { items: [space()], nextCursor: null } },
    });
    await renderAt("/spaces");
    expect(await screen.findByRole("link", { name: /IT Operations/ })).toBeTruthy();
    await userEvent.type(screen.getByRole("searchbox", { name: "Filter spaces" }), "nothing");
    expect(await screen.findByText("No space matches the filter")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByRole("link", { name: /IT Operations/ })).toBeTruthy();
    expect(requests.some((request) => request.path.includes("q=nothing"))).toBe(true);
  });

  it("creates a space with a suggested key, validates on submit and names who gets access", async () => {
    const { requests } = mockApi({
      ...baseRoutes(),
      ...spaceRoutes(),
      "GET /api/v1/spaces": () => ({ body: { items: [], nextCursor: null } }),
      [`GET /api/v1/organizations/${ORGANIZATION.id}/space-defaults`]: () => ({
        body: {
          visibility: "organization",
          grants: [{ principalKind: "organizationMembers", principalId: null, role: "editor", name: null }],
        },
      }),
      [`GET /api/v1/organizations/${ORGANIZATION.id}/space-key-suggestion`]: () => ({
        body: { key: "CS", valid: true, available: true },
      }),
      [`GET /api/v1/organizations/${ORGANIZATION.id}/space-keys/CS`]: () => ({
        body: { key: "CS", valid: true, available: true },
      }),
      [`POST /api/v1/organizations/${ORGANIZATION.id}/spaces`]: () => ({
        status: 201,
        body: { ...space(), key: "CS", name: "Customer Support" },
      }),
      "GET /api/v1/space-keys/CS": () => ({
        body: { space: { ...space(), key: "CS", name: "Customer Support" }, redirected: false },
      }),
    });
    await renderAt("/spaces");
    await userEvent.click((await screen.findAllByRole("button", { name: "Create space" }))[0] as HTMLElement);
    const dialog = await screen.findByRole("dialog", { name: "Create a space" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Create space" }));
    expect(await within(dialog).findByText("Enter a name for the space.")).toBeTruthy();
    await userEvent.type(within(dialog).getByLabelText("Name"), "Customer Support");
    await waitFor(() => expect((within(dialog).getByLabelText("Key") as HTMLInputElement).value).toBe("CS"));
    expect(within(dialog).getByText("All members of Platform Team: Editor")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Create space" }));
    await waitFor(() =>
      expect(requests.find((request) => request.method === "POST")?.body).toEqual({
        name: "Customer Support",
        key: "CS",
        description: "",
        visibility: "organization",
        grants: [{ principalKind: "organizationMembers", principalId: null, role: "editor" }],
      }),
    );
  });

  it("shows the field error when the key is taken", async () => {
    mockApi({
      ...baseRoutes(),
      "GET /api/v1/spaces": () => ({ body: { items: [], nextCursor: null } }),
      [`GET /api/v1/organizations/${ORGANIZATION.id}/space-defaults`]: () => ({
        body: { visibility: "private", grants: [] },
      }),
      [`GET /api/v1/organizations/${ORGANIZATION.id}/space-key-suggestion`]: () => ({
        body: { key: "IT", valid: true, available: true },
      }),
      [`GET /api/v1/organizations/${ORGANIZATION.id}/space-keys/IT`]: () => ({
        body: { key: "IT", valid: true, available: false },
      }),
    });
    await renderAt("/spaces");
    await userEvent.click((await screen.findAllByRole("button", { name: "Create space" }))[0] as HTMLElement);
    const dialog = await screen.findByRole("dialog", { name: "Create a space" });
    await userEvent.type(within(dialog).getByLabelText("Name"), "IT");
    await waitFor(() => expect((within(dialog).getByLabelText("Key") as HTMLInputElement).value).toBe("IT"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Create space" }));
    expect(
      await within(dialog).findByText("Another space already uses IT. Choose a different key."),
    ).toBeTruthy();
  });

  it("leads old keys to the current key", async () => {
    mockApi({
      ...baseRoutes(),
      ...spaceRoutes(),
      [`GET /api/v1/pages/${OVERVIEW}/content`]: () => problem(404, "notFound"),
    });
    await renderAt(`/spaces/OLDKEY/folders/${RUNBOOKS}/runbooks`);
    await waitFor(() => expect(window.location.pathname).toBe(`/spaces/ITOPS/folders/${RUNBOOKS}/runbooks`));
  });

  it("opens a page by its ID in its current space when the old key now belongs to another space", async () => {
    mockApi({
      ...baseRoutes(),
      ...spaceRoutes(),
      "GET /api/v1/space-keys/OLDKEY": () => ({
        body: {
          space: { ...space(), id: "01929b1e-0000-7000-8000-0000000000a2", key: "OLDKEY", name: "Other" },
          redirected: false,
        },
      }),
      [`GET /api/v1/pages/${OVERVIEW}/content`]: () => problem(404, "notFound"),
      [`GET /api/v1/pages/${OVERVIEW}/labels`]: () => ({ body: [] }),
      [`GET /api/v1/pages/${OVERVIEW}/backlinks`]: () => ({ body: [] }),
    });
    await renderAt(`/spaces/OLDKEY/pages/${OVERVIEW}/it-operations`);
    await waitFor(() =>
      expect(window.location.pathname).toBe(`/spaces/ITOPS/pages/${OVERVIEW}/it-operations`),
    );
    expect(await screen.findByRole("heading", { name: "IT Operations", level: 1 })).toBeTruthy();
  });

  it("opens a page by its ID when the person cannot see the space that took the old key", async () => {
    mockApi({
      ...baseRoutes(),
      ...spaceRoutes(),
      "GET /api/v1/space-keys/OLDKEY": () => problem(404, "notFound"),
      [`GET /api/v1/pages/${OVERVIEW}/content`]: () => problem(404, "notFound"),
      [`GET /api/v1/pages/${OVERVIEW}/labels`]: () => ({ body: [] }),
      [`GET /api/v1/pages/${OVERVIEW}/backlinks`]: () => ({ body: [] }),
    });
    await renderAt(`/spaces/OLDKEY/pages/${OVERVIEW}/it-operations`);
    await waitFor(() =>
      expect(window.location.pathname).toBe(`/spaces/ITOPS/pages/${OVERVIEW}/it-operations`),
    );
    expect(screen.queryByText("Space not found")).toBeNull();
  });

  it("says that the old key keeps leading to the space until another space takes it", async () => {
    mockApi({ ...baseRoutes(), ...spaceRoutes() });
    await renderAt("/spaces/ITOPS/settings/general");
    const input = (await screen.findAllByRole("textbox")).find(
      (element) => (element as HTMLInputElement).value === "ITOPS",
    ) as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, "OPS");
    expect(
      await screen.findByText(
        "Addresses with ITOPS lead to the new key until another space takes ITOPS. Links to pages always keep working.",
      ),
    ).toBeTruthy();
  });

  it("leads an outdated title in the address to the current one and keeps the edit mode", async () => {
    mockApi({
      ...baseRoutes(),
      ...spaceRoutes("reader"),
      [`GET /api/v1/pages/${OVERVIEW}/content`]: () => problem(404, "notFound"),
      [`GET /api/v1/pages/${OVERVIEW}/labels`]: () => ({ body: [] }),
      [`GET /api/v1/pages/${OVERVIEW}/backlinks`]: () => ({ body: [] }),
    });
    await renderAt(`/spaces/ITOPS/pages/${OVERVIEW}/untitled-page?edit=true`);
    await waitFor(() =>
      expect(`${window.location.pathname}${window.location.search}`).toBe(
        `/spaces/ITOPS/pages/${OVERVIEW}/it-operations?edit=true`,
      ),
    );
    expect(await screen.findByRole("heading", { name: "IT Operations", level: 1 })).toBeTruthy();
  });
});

describe("page tree", () => {
  async function renderTree(
    extra: Record<string, (request: RecordedRequest) => { status?: number; body?: unknown }> = {},
  ) {
    const mock = mockApi({ ...baseRoutes(), ...spaceRoutes(), ...extra });
    await renderAt(`/spaces/ITOPS/folders/${RUNBOOKS}/runbooks`);
    const tree = await screen.findByRole("tree", { name: "Page tree" });
    await within(tree).findByRole("treeitem", { name: "Network" });
    return { tree, ...mock };
  }

  it("moves focus with the arrow keys and opens and closes levels", async () => {
    const { tree } = await renderTree();
    const overview = within(tree).getByRole("treeitem", { name: "IT Operations" });
    overview.focus();
    fireEvent.keyDown(overview, { key: "ArrowDown" });
    const runbooks = within(tree).getByRole("treeitem", { name: "Runbooks" });
    expect(document.activeElement).toBe(runbooks);
    fireEvent.keyDown(runbooks, { key: "ArrowRight" });
    expect(await within(tree).findByRole("treeitem", { name: "VPN access" })).toBeTruthy();
    expect(runbooks.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(runbooks, { key: "ArrowRight" });
    const vpn = within(tree).getByRole("treeitem", { name: "VPN access" });
    expect(document.activeElement).toBe(vpn);
    fireEvent.keyDown(vpn, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(runbooks);
    fireEvent.keyDown(runbooks, { key: "ArrowLeft" });
    await waitFor(() => expect(within(tree).queryByRole("treeitem", { name: "VPN access" })).toBeNull());
    fireEvent.keyDown(runbooks, { key: "End" });
    expect(document.activeElement).toBe(within(tree).getByRole("treeitem", { name: "Network" }));
    fireEvent.keyDown(document.activeElement as Element, { key: "Home" });
    expect(document.activeElement).toBe(overview);
  });

  it("moves an item by drag and drop, shows where it lands and undoes the move", async () => {
    const { tree, requests } = await renderTree({
      [`POST /api/v1/items/${NETWORK}/move`]: () => ({ body: item(NETWORK, "Network", "page", null) }),
    });
    const network = within(tree).getByRole("treeitem", { name: "Network" });
    const runbooks = within(tree).getByRole("treeitem", { name: "Runbooks" });
    vi.spyOn(runbooks, "getBoundingClientRect").mockReturnValue({
      top: 0,
      height: 40,
      bottom: 40,
      left: 0,
      right: 200,
      width: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const dataTransfer = { setData: () => {}, effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(network, { dataTransfer });
    fireEvent.dragOver(runbooks, { dataTransfer, clientY: 20 });
    expect(runbooks.className).toContain("bg-accent-soft");
    fireEvent.drop(runbooks, { dataTransfer, clientY: 20 });
    await waitFor(() =>
      expect(requests.find((request) => request.method === "POST")?.body).toEqual({ parentId: RUNBOOKS }),
    );
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(requests.filter((request) => request.method === "POST").at(-1)?.body).toEqual({
        parentId: null,
        afterId: RUNBOOKS,
      }),
    );
  });

  it("offers Move in the menu of every item", async () => {
    const { tree } = await renderTree({
      "GET /api/v1/spaces": () => ({ body: { items: [space()], nextCursor: null } }),
    });
    const network = within(tree).getByRole("treeitem", { name: "Network" });
    await userEvent.click(within(network).getByRole("button", { name: "Actions for Network" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Move…" }));
    expect(await screen.findByRole("dialog", { name: "Move Network" })).toBeTruthy();
  });

  it("starts the Move dialog at the current place of the item", async () => {
    const { tree, requests } = await renderTree({
      "GET /api/v1/spaces": () => ({ body: { items: [space()], nextCursor: null } }),
      [`POST /api/v1/items/${VPN}/move`]: () => ({ body: item(VPN, "VPN access", "page", RUNBOOKS) }),
    });
    const runbooks = within(tree).getByRole("treeitem", { name: "Runbooks" });
    runbooks.focus();
    fireEvent.keyDown(runbooks, { key: "ArrowRight" });
    const vpn = await within(tree).findByRole("treeitem", { name: "VPN access" });
    await userEvent.click(within(vpn).getByRole("button", { name: "Actions for VPN access" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Move…" }));
    const dialog = await screen.findByRole("dialog", { name: "Move VPN access" });
    await waitFor(() =>
      expect(
        (within(dialog).getByRole("combobox", { name: "Place below" }) as HTMLInputElement).value,
      ).toContain("Runbooks"),
    );
    await userEvent.click(within(dialog).getByRole("radio", { name: "At the beginning" }));
    await userEvent.click(within(dialog).getByRole("button", { name: /^Move$/ }));
    await waitFor(() =>
      expect(requests.find((request) => request.path.endsWith(`/items/${VPN}/move`))?.body).toMatchObject({
        parentId: RUNBOOKS,
      }),
    );
  });
});

describe("space permissions", () => {
  it("shows who gains access before a role is given and gives it only after confirmation", async () => {
    const { requests } = mockApi({
      ...baseRoutes(),
      ...spaceRoutes(),
      [`GET /api/v1/spaces/${SPACE_ID}/permissions`]: () => ({
        body: [
          {
            id: PERMISSION,
            principalKind: "account",
            principalId: OLIVIA.id,
            name: OLIVIA.name,
            email: OLIVIA.email,
            organizationName: null,
            role: "admin",
          },
        ],
      }),
      "GET /api/v1/people": () => ({
        body: {
          items: [{ id: ANNA, name: "Anna Berger", email: "anna@example.org", type: "standard" }],
          nextCursor: null,
        },
      }),
      [`GET /api/v1/organizations/${ORGANIZATION.id}/groups`]: () => ({
        body: { items: [], nextCursor: null },
      }),
      [`POST /api/v1/spaces/${SPACE_ID}/permissions/preview`]: () => ({
        body: {
          gaining: 1,
          losing: 0,
          raised: 0,
          lowered: 0,
          unlisted: 0,
          truncated: false,
          changes: [{ accountId: ANNA, name: "Anna Berger", before: null, after: "reader" }],
        },
      }),
      [`POST /api/v1/spaces/${SPACE_ID}/permissions`]: () => ({ body: [] }),
    });
    await renderAt("/spaces/ITOPS/settings/permissions");
    const picker = await screen.findByRole("combobox", { name: "Add people or groups" });
    await userEvent.click(picker);
    await userEvent.click(await screen.findByRole("option", { name: /Anna Berger/ }));
    await userEvent.click(screen.getByRole("button", { name: "Give role" }));
    const dialog = await screen.findByRole("dialog", { name: "Give Anna Berger the role Reader?" });
    expect(await within(dialog).findByText("1 person gets access")).toBeTruthy();
    expect(within(dialog).getByText("Anna Berger · Reader")).toBeTruthy();
    expect(
      requests.some(
        (request) => request.path === `/api/v1/spaces/${SPACE_ID}/permissions` && request.method === "POST",
      ),
    ).toBe(false);
    await userEvent.click(within(dialog).getByRole("button", { name: "Give role" }));
    await waitFor(() =>
      expect(
        requests.find(
          (request) => request.path === `/api/v1/spaces/${SPACE_ID}/permissions` && request.method === "POST",
        )?.body,
      ).toEqual({ action: "grant", principalKind: "account", principalId: ANNA, role: "reader" }),
    );
  });

  it("tells people without the space admin role who manages permissions", async () => {
    mockApi({ ...baseRoutes(), ...spaceRoutes("editor") });
    await renderAt("/spaces/ITOPS/settings/permissions");
    expect(await screen.findByText("Only space admins manage permissions")).toBeTruthy();
  });
});

describe("space access", () => {
  const emptyImpact = {
    gaining: 0,
    losing: 0,
    raised: 0,
    lowered: 0,
    unlisted: 0,
    truncated: false,
    changes: [],
  };
  const people = () => ({
    body: {
      items: [{ id: ANNA, name: "Anna Berger", email: "anna@example.org", type: "standard" }],
      nextCursor: null,
    },
  });

  beforeEach(() => {
    window.localStorage.clear();
  });

  it("gives access step by step and shows the effect before confirming", async () => {
    const { requests } = mockApi({
      ...baseRoutes(),
      ...spaceRoutes("admin"),
      [`GET /api/v1/spaces/${SPACE_ID}/access-requests`]: () => ({ body: [] }),
      [`GET /api/v1/spaces/${SPACE_ID}/restricted-pages`]: () => ({ body: [] }),
      "GET /api/v1/people": people,
      [`GET /api/v1/organizations/${ORGANIZATION.id}/groups`]: () => ({
        body: { items: [], nextCursor: null },
      }),
      [`POST /api/v1/spaces/${SPACE_ID}/give-access/preview`]: () => ({
        body: {
          pages: 37,
          readable: 34,
          editable: 34,
          restricted: 3,
          alreadyHas: null,
          impact: { ...emptyImpact, gaining: 1 },
        },
      }),
      [`POST /api/v1/spaces/${SPACE_ID}/permissions`]: () => ({ body: [] }),
    });
    await renderAt("/spaces/ITOPS/settings/access");
    await userEvent.click(await screen.findByRole("button", { name: "Give access" }));
    const dialog = await screen.findByRole("dialog", { name: "Give access" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(await within(dialog).findByText("Choose a person or group from the search results.")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("combobox", { name: "Person or group" }));
    await userEvent.click(await screen.findByRole("option", { name: /Anna Berger/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    await userEvent.click(within(dialog).getByRole("radio", { name: /Can edit/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    expect(
      await within(dialog).findByText("Anna Berger can then read 34 pages and edit 34 of them."),
    ).toBeTruthy();
    expect(within(dialog).getByText(/Anna Berger will still not see 3 restricted pages/)).toBeTruthy();
    expect(requests.some((request) => request.path === `/api/v1/spaces/${SPACE_ID}/permissions`)).toBe(false);
    await userEvent.click(within(dialog).getByRole("button", { name: 'Give Anna Berger "Can edit"' }));
    await waitFor(() =>
      expect(
        requests.find(
          (request) => request.method === "POST" && request.path === `/api/v1/spaces/${SPACE_ID}/permissions`,
        )?.body,
      ).toEqual({ action: "grant", principalKind: "account", principalId: ANNA, role: "editor" }),
    );
  });

  it("keeps an unfinished assistant as a draft", async () => {
    mockApi({
      ...baseRoutes(),
      ...spaceRoutes("admin"),
      [`GET /api/v1/spaces/${SPACE_ID}/access-requests`]: () => ({ body: [] }),
      [`GET /api/v1/spaces/${SPACE_ID}/restricted-pages`]: () => ({ body: [] }),
      "GET /api/v1/people": people,
      [`GET /api/v1/organizations/${ORGANIZATION.id}/groups`]: () => ({
        body: { items: [], nextCursor: null },
      }),
    });
    await renderAt("/spaces/ITOPS/settings/access");
    await userEvent.click(await screen.findByRole("button", { name: "Give access" }));
    const dialog = await screen.findByRole("dialog", { name: "Give access" });
    await userEvent.click(within(dialog).getByRole("combobox", { name: "Person or group" }));
    await userEvent.click(await screen.findByRole("option", { name: /Anna Berger/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    await userEvent.keyboard("{Escape}");
    await userEvent.click(await screen.findByRole("button", { name: "Continue giving access" }));
    expect(await screen.findByRole("radiogroup", { name: "What they may do" })).toBeTruthy();
  });

  it("lets space admins make a private space findable and saves it at once", async () => {
    const { requests } = mockApi({
      ...baseRoutes(),
      ...spaceRoutes("admin"),
      [`PATCH /api/v1/spaces/${SPACE_ID}`]: () => ({ body: {} }),
    });
    await renderAt("/spaces/ITOPS/settings/general");
    await userEvent.click(
      await screen.findByRole("switch", {
        name: "Members of the organization can find this space and ask to join",
      }),
    );
    await waitFor(() =>
      expect(requests.find((request) => request.method === "PATCH")?.body).toEqual({ discoverable: true }),
    );
  });

  it("lists restricted pages and removes a restriction only after naming its effects", async () => {
    const { requests } = mockApi({
      ...baseRoutes(),
      ...spaceRoutes("admin"),
      [`GET /api/v1/spaces/${SPACE_ID}/access-requests`]: () => ({ body: [] }),
      [`GET /api/v1/spaces/${SPACE_ID}/restricted-pages`]: () => ({
        body: [
          {
            itemId: NETWORK,
            title: "Network",
            kind: "page",
            view: { setBy: { id: ANNA, name: "Anna Berger" }, setAt: "2026-10-01T09:30:00.000Z" },
            edit: null,
            orphaned: true,
          },
        ],
      }),
      [`DELETE /api/v1/spaces/${SPACE_ID}/restricted-pages/${NETWORK}/restrictions/view`]: () => ({
        status: 204,
      }),
    });
    await renderAt("/spaces/ITOPS/settings/access");
    expect(await screen.findByText("Nobody on the list is active")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Remove restriction" }));
    const dialog = await screen.findByRole("dialog", { name: "Remove the restriction of Network?" });
    expect(within(dialog).getByText(/recorded in the audit log/)).toBeTruthy();
    expect(requests.some((request) => request.method === "DELETE")).toBe(false);
    await userEvent.click(within(dialog).getByRole("button", { name: "Remove restriction" }));
    await waitFor(() => expect(requests.some((request) => request.method === "DELETE")).toBe(true));
  });
});
