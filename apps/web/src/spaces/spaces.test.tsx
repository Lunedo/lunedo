import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  mayExport: role === "admin",
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
  published: true,
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

function copyImpact(wider: boolean) {
  return {
    gaining: wider ? 1 : 0,
    losing: 0,
    raised: 0,
    lowered: 0,
    unlisted: 0,
    truncated: false,
    changes: wider ? [{ accountId: ANNA, name: "Anna Berger", before: null, after: "reader" }] : [],
    leavesConfidential: false,
    widerAccess: wider,
    confirmation: wider ? "confirmed-copy" : null,
    items: 3,
    hidden: 2,
    skipped: 0,
    background: false,
  };
}

const COPY = "01929b1e-0000-7000-8000-0000000000e1";

function itemCopy(state: "queued" | "running" | "done", done = 0) {
  return {
    id: "01929b1e-0000-7000-8000-0000000000e2",
    state,
    title: "Network",
    descendants: true,
    sourceItemId: NETWORK,
    targetSpaceId: SPACE_ID,
    progress: { done, total: 30 },
    copied: state === "done" ? 30 : 0,
    hidden: 0,
    skipped: 0,
    item:
      state === "done"
        ? { id: COPY, spaceId: SPACE_ID, spaceKey: "ITOPS", kind: "page", title: "Copy of Network" }
        : null,
    errorCode: null,
    createdAt: "2026-10-17T09:00:00.000Z",
    finishedAt: state === "done" ? "2026-10-17T09:00:05.000Z" : null,
  };
}

function moveImpact(change: { losing?: number; after?: "reader" | null }) {
  const changed = change.losing !== undefined;
  return {
    gaining: 0,
    losing: change.losing ?? 0,
    raised: 0,
    lowered: 0,
    unlisted: 0,
    truncated: false,
    changes: changed
      ? [{ accountId: ANNA, name: "Anna Berger", before: "reader", after: change.after ?? null }]
      : [],
    leavesConfidential: false,
    confirmation: changed ? "confirmed-impact" : null,
  };
}

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
      if (parent === OVERVIEW) {
        return {
          body: {
            items: [
              item(RUNBOOKS, "Runbooks", "folder", OVERVIEW, true),
              item(NETWORK, "Network", "page", OVERVIEW),
            ],
            nextCursor: null,
          },
        };
      }
      return { body: { items: [item(OVERVIEW, "IT Operations", "page", null, true)], nextCursor: null } };
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

  it("shows the spaces as a list on narrow screens and hides the visibility column first in a narrow table", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    mockApi({
      ...baseRoutes(),
      "GET /api/v1/spaces": () => ({ body: { items: [space()], nextCursor: null } }),
    });
    await renderAt("/spaces");
    const table = await screen.findByRole("table", { name: "Spaces" });
    expect(within(table).getByRole("columnheader", { name: "Who can read" }).className).toContain(
      "hidden @2xl:table-cell",
    );
    expect(within(table).getByRole("columnheader", { name: "Key" }).className).not.toContain("hidden");
    cleanup();

    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    mockApi({
      ...baseRoutes(),
      "GET /api/v1/spaces": () => ({ body: { items: [space()], nextCursor: null } }),
    });
    await renderAt("/spaces");
    const list = await screen.findByRole("list", { name: "Spaces" });
    expect(screen.queryByRole("table")).toBeNull();
    const entry = within(list).getByRole("listitem");
    expect(within(entry).getByRole("link", { name: "IT Operations" }).getAttribute("href")).toBe(
      "/spaces/ITOPS",
    );
    expect(within(entry).getByText("ITOPS · Runbooks of the IT team")).toBeTruthy();
    expect(within(entry).getByRole("button", { name: "Star IT Operations" })).toBeTruthy();
  });

  it("lists the deleted spaces the person was space admin of and restores one", async () => {
    const entry = {
      id: "01929b1e-0000-7000-8000-0000000000e1",
      spaceId: SPACE_ID,
      spaceKey: "ITOPS",
      spaceName: "IT Operations",
      kind: "space",
      itemId: null,
      itemKind: null,
      title: "IT Operations",
      descendants: 0,
      stage: 2,
      deletedAt: "2026-10-02T10:00:00.000Z",
      deletedBy: { id: OLIVIA.id, name: OLIVIA.name },
      stageTwoAt: "2026-10-02T10:00:00.000Z",
      removedAt: "2099-11-16T10:00:00.000Z",
    };
    let restored = false;
    const { requests } = mockApi({
      ...baseRoutes(),
      "GET /api/v1/spaces": () => ({ body: { items: restored ? [space()] : [], nextCursor: null } }),
      "GET /api/v1/deleted-spaces": () => ({ body: restored ? [] : [entry] }),
      [`POST /api/v1/deleted-spaces/${entry.id}/restore`]: () => {
        restored = true;
        return { body: { itemId: null, parentId: null } };
      },
    });
    await renderAt("/spaces?deleted=true");
    expect(await screen.findByRole("heading", { name: "Deleted spaces" })).toBeTruthy();
    expect(await screen.findByText("IT Operations")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Restore IT Operations" }));
    expect(await screen.findByText("“IT Operations” is back with its content and permissions")).toBeTruthy();
    expect(await screen.findByText("No deleted spaces")).toBeTruthy();
    expect(requests.some((request) => request.method === "POST" && request.path.includes(entry.id))).toBe(
      true,
    );
  });

  it("says what failed when a deleted space cannot be restored", async () => {
    mockApi({
      ...baseRoutes(),
      "GET /api/v1/spaces": () => ({ body: { items: [], nextCursor: null } }),
      "GET /api/v1/deleted-spaces": () => ({
        body: [
          {
            id: "01929b1e-0000-7000-8000-0000000000e2",
            spaceId: SPACE_ID,
            spaceKey: "ITOPS",
            spaceName: "IT Operations",
            kind: "space",
            itemId: null,
            itemKind: null,
            title: "IT Operations",
            descendants: 0,
            stage: 2,
            deletedAt: "2026-10-02T10:00:00.000Z",
            deletedBy: null,
            stageTwoAt: "2026-10-02T10:00:00.000Z",
            removedAt: "2099-11-16T10:00:00.000Z",
          },
        ],
      }),
      "POST /api/v1/deleted-spaces/01929b1e-0000-7000-8000-0000000000e2/restore": () =>
        problem(404, "notFound"),
    });
    await renderAt("/spaces?deleted=true");
    await userEvent.click(await screen.findByRole("button", { name: "Restore IT Operations" }));
    expect(await screen.findByText("The space could not be restored")).toBeTruthy();
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
        confidential: false,
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

  it("replaces the space navigation with grouped settings and a way back to the space", async () => {
    mockApi({ ...baseRoutes(), ...spaceRoutes() });
    await renderAt("/spaces/ITOPS/settings/general");
    const navigation = await screen.findByRole("navigation", { name: "Space settings" });
    expect(within(navigation).getByRole("heading", { name: "IT Operations" })).toBeTruthy();
    expect(within(navigation).getByRole("link", { name: "Back to IT Operations" }).getAttribute("href")).toBe(
      "/spaces/ITOPS",
    );
    expect(within(navigation).getByRole("link", { name: "General" }).getAttribute("aria-current")).toBe(
      "page",
    );
    const content = within(navigation).getByRole("list", { name: "Content" });
    expect(
      within(content)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Pages and trash", "Page status", "Templates", "Export"]);
    expect(within(navigation).getByRole("list", { name: "Access" })).toBeTruthy();
    expect(within(navigation).getByRole("list", { name: "Connections" })).toBeTruthy();
    expect(within(navigation).queryByRole("list", { name: "Publishing" })).toBeNull();
    expect(within(navigation).queryByRole("link", { name: "Categories" })).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Navigation of IT Operations" })).toBeNull();
  });

  it("shows the publishing settings for a knowledge base and sends article templates to Templates", async () => {
    mockApi({
      ...baseRoutes(),
      ...spaceRoutes(),
      "GET /api/v1/space-keys/ITOPS": () => ({
        body: { space: { ...space(), type: "knowledgeBase" }, redirected: false },
      }),
    });
    await renderAt("/spaces/ITOPS/settings/article-templates");
    await waitFor(() => expect(window.location.pathname).toBe("/spaces/ITOPS/settings/templates"));
    const navigation = await screen.findByRole("navigation", { name: "Space settings" });
    const publishing = within(navigation).getByRole("list", { name: "Publishing" });
    expect(
      within(publishing)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Address", "Appearance and start page", "Visibility", "Languages", "Portal accounts"]);
    const content = within(navigation).getByRole("list", { name: "Content" });
    expect(
      within(content)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Categories", "Templates", "Review", "Pages and trash", "Page status", "Export"]);
    expect(within(content).getByRole("link", { name: "Templates" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("ends the general space settings with the danger zone and keeps it off pages and trash", async () => {
    mockApi({
      ...baseRoutes(),
      ...spaceRoutes(),
      [`GET /api/v1/spaces/${SPACE_ID}/settings`]: () => ({ body: [] }),
    });
    await renderAt("/spaces/ITOPS/settings/general");
    const zone = await screen.findByRole("region", { name: "Danger zone" });
    expect(within(zone).getByRole("button", { name: "Archive space" })).toBeTruthy();
    expect(within(zone).getByRole("button", { name: "Delete space" })).toBeTruthy();
    const main = screen.getByRole("main");
    const regions = within(main).getAllByRole("region");
    expect(regions.at(-1)).toBe(zone);
    cleanup();

    mockApi({
      ...baseRoutes(),
      ...spaceRoutes(),
      [`GET /api/v1/spaces/${SPACE_ID}/settings`]: () => ({ body: [] }),
    });
    await renderAt("/spaces/ITOPS/settings/content");
    await screen.findByRole("heading", { name: "Pages and trash", level: 1 });
    expect(screen.queryByRole("region", { name: "Danger zone" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete space" })).toBeNull();
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

  it("lists what changed last in the space on its overview page, once per page and without the overview", async () => {
    const hit = (itemId: string, title: string, type: string, heading = "") => ({
      type,
      id: heading ? `${itemId}:${heading}` : itemId,
      itemId,
      itemType: type,
      title,
      heading,
      anchor: heading ? heading.toLowerCase() : null,
      excerpt: [],
      space: { id: SPACE_ID, key: "ITOPS", name: "IT Operations", personal: false },
      sharedWithYou: false,
      path: [],
      labels: [],
      status: null,
      author: { id: "01929b1e-0000-7000-8000-0000000000c1", name: "Anna Berger" },
      archived: false,
      attachment: null,
      topic: null,
      series: null,
      updatedAt: "2026-10-05T08:00:00.000Z",
    });
    const { requests } = mockApi({
      ...baseRoutes(),
      ...spaceRoutes("reader"),
      [`GET /api/v1/pages/${OVERVIEW}/content`]: () => ({
        body: {
          itemId: OVERVIEW,
          title: "IT Operations",
          version: 1,
          document: {
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Welcome" }] }],
          },
          schemaVersion: 2,
          revision: 1,
          updatedAt: "2026-10-05T08:10:00.000Z",
          updatedBy: null,
          references: { people: {}, pages: {} },
        },
      }),
      [`GET /api/v1/pages/${OVERVIEW}/labels`]: () => ({ body: [] }),
      [`GET /api/v1/pages/${OVERVIEW}/backlinks`]: () => ({ body: [] }),
      [`GET /api/v1/organizations/${ORGANIZATION.id}/search`]: () => ({
        body: {
          results: [
            hit(NETWORK, "Network", "page", "Firewall"),
            hit(OVERVIEW, "IT Operations", "page"),
            hit(NETWORK, "Network", "page"),
            hit(VPN, "Winter maintenance", "blogPost"),
          ],
          nextCursor: null,
        },
      }),
    });
    await renderAt(`/spaces/ITOPS/pages/${OVERVIEW}/it-operations`);
    const section = await screen.findByRole("region", { name: "New in this space" });
    expect(
      within(section)
        .getAllByRole("link")
        .map((link) => [link.textContent, link.getAttribute("href")]),
    ).toEqual([
      [expect.stringMatching(/^NetworkAnna Berger · /), `/spaces/ITOPS/pages/${NETWORK}/network`],
      [expect.stringMatching(/^Winter maintenanceBlog post · Anna Berger · /), expect.stringContaining(VPN)],
    ]);
    const search = new URL(
      requests.find((request) => request.path.includes("/search"))?.path ?? "",
      "http://localhost",
    ).searchParams;
    expect(Object.fromEntries(search)).toMatchObject({ spaceIds: SPACE_ID, sort: "newest" });
    expect(search.has("q")).toBe(false);
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
    expect(within(tree).queryByRole("treeitem", { name: "IT Operations" })).toBeNull();
    const runbooks = within(tree).getByRole("treeitem", { name: "Runbooks" });
    expect(runbooks.getAttribute("aria-level")).toBe("1");
    const network = within(tree).getByRole("treeitem", { name: "Network" });
    network.focus();
    fireEvent.keyDown(network, { key: "ArrowUp" });
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
    expect(document.activeElement).toBe(runbooks);
  });

  it("keeps the space part of the sidebar while the space loads instead of the navigation outside spaces", async () => {
    mockApi({
      ...baseRoutes(),
      ...spaceRoutes(),
      "GET /api/v1/space-keys/ITOPS": () => new Promise(() => {}),
    });
    await renderAt("/spaces/ITOPS");
    await screen.findByRole("link", { name: "For you" });
    expect(screen.queryByRole("link", { name: "All spaces" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Collapse sidebar" })).toBeNull();
  });

  it("creates items at the top level of the tree below the home page", async () => {
    const { requests } = await renderTree({
      [`POST /api/v1/spaces/${SPACE_ID}/items`]: () => ({
        status: 201,
        body: item("01929b1e-0000-7000-8000-0000000000e9", "Contracts", "folder", OVERVIEW),
      }),
    });
    await userEvent.click(screen.getByRole("button", { name: "Create in this space" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "New folder" }));
    const dialog = await screen.findByRole("dialog", { name: "New folder" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Title" }), "Contracts");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create folder" }));
    await waitFor(() =>
      expect(
        requests.find((request) => request.method === "POST" && request.path.endsWith("/items"))?.body,
      ).toMatchObject({ kind: "folder", title: "Contracts", parentId: OVERVIEW }),
    );
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
        parentId: OVERVIEW,
        afterId: RUNBOOKS,
      }),
    );
  });

  it("asks before a drag and drop that changes access and moves only after confirmation", async () => {
    let attempts = 0;
    const { tree, requests } = await renderTree({
      [`POST /api/v1/items/${NETWORK}/move`]: () => {
        attempts += 1;
        return attempts === 1
          ? problem(409, "moveChangesAccess", { impact: moveImpact({ losing: 1, after: null }) })
          : { body: item(NETWORK, "Network", "page", RUNBOOKS) };
      },
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
    fireEvent.drop(runbooks, { dataTransfer, clientY: 20 });

    const dialog = await screen.findByRole("dialog", { name: "Move Network and change access?" });
    expect(within(dialog).getByText("Anna Berger")).toBeTruthy();
    expect(attempts).toBe(1);
    await userEvent.click(within(dialog).getByRole("button", { name: "Move and change access" }));
    await waitFor(() =>
      expect(requests.filter((request) => request.method === "POST").at(-1)?.body).toEqual({
        parentId: RUNBOOKS,
        confirmation: "confirmed-impact",
      }),
    );
    expect(await screen.findByText("Network moved")).toBeTruthy();
  });

  it("shows in the Move dialog who loses access within the space and sends the confirmation", async () => {
    const { tree, requests } = await renderTree({
      "GET /api/v1/spaces": () => ({ body: { items: [space()], nextCursor: null } }),
      [`POST /api/v1/items/${NETWORK}/move/preview`]: () => ({
        body: moveImpact({ losing: 1, after: null }),
      }),
      [`POST /api/v1/items/${NETWORK}/move`]: () => ({ body: item(NETWORK, "Network", "page", null) }),
    });
    const network = within(tree).getByRole("treeitem", { name: "Network" });
    await userEvent.click(within(network).getByRole("button", { name: "Actions for Network" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Move…" }));
    const dialog = await screen.findByRole("dialog", { name: "Move Network" });
    const section = await within(dialog).findByRole("region", { name: "How access changes" });
    expect(await within(section).findByText("Anna Berger")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: /^Move$/ }));
    await waitFor(() =>
      expect(requests.find((request) => request.path.endsWith(`/items/${NETWORK}/move`))?.body).toMatchObject(
        {
          parentId: OVERVIEW,
          confirmation: "confirmed-impact",
        },
      ),
    );
  });

  it("copies an item only after the person confirms that more people can read the copy", async () => {
    const { tree, requests } = await renderTree({
      "GET /api/v1/spaces": () => ({ body: { items: [space()], nextCursor: null } }),
      [`POST /api/v1/items/${NETWORK}/copy/preview`]: () => ({ body: copyImpact(true) }),
      [`POST /api/v1/items/${NETWORK}/copy`]: () => ({ body: itemCopy("done") }),
    });
    const network = within(tree).getByRole("treeitem", { name: "Network" });
    await userEvent.click(within(network).getByRole("button", { name: "Actions for Network" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Copy…" }));
    const dialog = await screen.findByRole("dialog", { name: "Copy Network" });
    const section = await within(dialog).findByRole("region", { name: "Who can open the copy" });
    expect(await within(section).findByText("Anna Berger · Reader")).toBeTruthy();
    expect(within(section).getByText("1 person can open the copy but not the original")).toBeTruthy();
    expect(
      within(section).getByText("2 items below are left out because you cannot open them."),
    ).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Create copy" }));
    expect(
      await within(dialog).findByText(
        "Confirm that these people may open the copy, or choose another place.",
      ),
    ).toBeTruthy();
    const confirm = within(dialog).getByRole("checkbox", {
      name: "I want these people to be able to open the copy",
    });
    expect(document.activeElement).toBe(confirm);
    expect(requests.some((request) => request.path.endsWith(`/items/${NETWORK}/copy`))).toBe(false);
    await userEvent.click(confirm);
    await userEvent.click(within(dialog).getByRole("button", { name: "Create copy" }));
    await waitFor(() =>
      expect(requests.find((request) => request.path.endsWith(`/items/${NETWORK}/copy`))?.body).toEqual({
        spaceId: SPACE_ID,
        parentId: OVERVIEW,
        descendants: false,
        confirmation: "confirmed-copy",
      }),
    );
    expect(await screen.findByText("Network copied")).toBeTruthy();
    expect(requests.find((request) => request.path.includes("/api/v1/spaces?"))?.path).toContain(
      "role=editor",
    );
  });

  it("asks again for the confirmation when another place changes who can read the copy", async () => {
    let previews = 0;
    const other = {
      ...space(),
      id: "01929b1e-0000-7000-8000-0000000000f1",
      key: "HR",
      name: "Human Resources",
    };
    await renderTree({
      "GET /api/v1/spaces": () => ({ body: { items: [space(), other], nextCursor: null } }),
      [`POST /api/v1/items/${NETWORK}/copy/preview`]: () => {
        previews += 1;
        return { body: { ...copyImpact(true), confirmation: `confirmed-${previews}` } };
      },
    });
    const tree = screen.getByRole("tree", { name: "Page tree" });
    const network = within(tree).getByRole("treeitem", { name: "Network" });
    await userEvent.click(within(network).getByRole("button", { name: "Actions for Network" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Copy…" }));
    const dialog = await screen.findByRole("dialog", { name: "Copy Network" });
    const confirm = await within(dialog).findByRole("checkbox", {
      name: "I want these people to be able to open the copy",
    });
    await userEvent.click(confirm);
    expect(confirm.getAttribute("aria-checked")).toBe("true");
    await userEvent.click(within(dialog).getByRole("combobox", { name: "Space" }));
    await userEvent.click(await screen.findByRole("option", { name: /Human Resources/ }));
    await waitFor(() =>
      expect(
        within(dialog)
          .getByRole("checkbox", { name: "I want these people to be able to open the copy" })
          .getAttribute("aria-checked"),
      ).toBe("false"),
    );
  });

  it("shows the progress of a large copy until it is done", async () => {
    let polls = 0;
    await renderTree({
      "GET /api/v1/spaces": () => ({ body: { items: [space()], nextCursor: null } }),
      [`POST /api/v1/items/${NETWORK}/copy/preview`]: () => ({
        body: { ...copyImpact(false), items: 30, hidden: 0, background: true },
      }),
      [`POST /api/v1/items/${NETWORK}/copy`]: () => ({ body: itemCopy("queued") }),
      "GET /api/v1/copies/01929b1e-0000-7000-8000-0000000000e2": () => {
        polls += 1;
        return { body: polls > 1 ? itemCopy("done") : itemCopy("running", 15) };
      },
    });
    const tree = screen.getByRole("tree", { name: "Page tree" });
    const network = within(tree).getByRole("treeitem", { name: "Network" });
    await userEvent.click(within(network).getByRole("button", { name: "Actions for Network" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Copy…" }));
    const dialog = await screen.findByRole("dialog", { name: "Copy Network" });
    expect(await within(dialog).findByText(/It runs in the background/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Create copy" }));
    const running = await screen.findByRole("dialog", { name: "Copying Network" });
    expect(await within(running).findByText("15 of 30 items copied")).toBeTruthy();
    expect(within(running).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("50");
    expect(await screen.findByText("Network copied", {}, { timeout: 5000 })).toBeTruthy();
  });

  it("offers Copy to readers, who can copy into spaces where they create content", async () => {
    mockApi({
      ...baseRoutes(),
      ...spaceRoutes("reader"),
      "GET /api/v1/spaces": () => ({ body: { items: [], nextCursor: null } }),
    });
    await renderAt(`/spaces/ITOPS/folders/${RUNBOOKS}/runbooks`);
    const tree = await screen.findByRole("tree", { name: "Page tree" });
    const network = await within(tree).findByRole("treeitem", { name: "Network" });
    await userEvent.click(within(network).getByRole("button", { name: "Actions for Network" }));
    expect(screen.queryByRole("menuitem", { name: "Move…" })).toBeNull();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Copy…" }));
    const dialog = await screen.findByRole("dialog", { name: "Copy Network" });
    expect(await within(dialog).findByText(/You cannot create content in any space/)).toBeTruthy();
  });

  it("offers the export of the space only to people who may export it", async () => {
    for (const role of ["reader", "admin"] as const) {
      mockApi({ ...baseRoutes(), ...spaceRoutes(role) });
      await renderAt(`/spaces/ITOPS/folders/${RUNBOOKS}/runbooks`);
      const user = userEvent.setup();
      await user.click(await screen.findByRole("button", { name: "Space options" }));
      const menu = await screen.findByRole("menu");
      expect(within(menu).getByRole("menuitem", { name: "Add to starred" })).toBeTruthy();
      if (role === "reader") {
        expect(within(menu).queryByRole("menuitem", { name: "Export space" })).toBeNull();
        expect(within(menu).queryByRole("menuitem", { name: "Space settings" })).toBeNull();
      } else {
        expect(within(menu).getByRole("menuitem", { name: "Export space" })).toBeTruthy();
        expect(within(menu).getByRole("menuitem", { name: "Space settings" })).toBeTruthy();
      }
      cleanup();
    }
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
      [`POST /api/v1/items/${VPN}/move/preview`]: () => ({ body: moveImpact({}) }),
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

  const draftRoutes = (stored: { draft: unknown } = { draft: null }) => ({
    [`GET /api/v1/spaces/${SPACE_ID}/give-access/draft`]: () => ({ body: { draft: stored.draft } }),
    [`PUT /api/v1/spaces/${SPACE_ID}/give-access/draft`]: (request: { body?: unknown }) => {
      stored.draft = request.body;
      return { body: { draft: request.body } };
    },
    [`DELETE /api/v1/spaces/${SPACE_ID}/give-access/draft`]: () => {
      stored.draft = null;
      return { status: 204 };
    },
  });

  it("gives access step by step and shows the effect before confirming", async () => {
    const stored = { draft: null as unknown };
    const { requests } = mockApi({
      ...baseRoutes(),
      ...spaceRoutes("admin"),
      ...draftRoutes(stored),
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
    await waitFor(() =>
      expect(
        requests.some(
          (request) =>
            request.method === "DELETE" && request.path === `/api/v1/spaces/${SPACE_ID}/give-access/draft`,
        ),
      ).toBe(true),
    );
    expect(stored.draft).toBeNull();
  });

  it("keeps an unfinished assistant as a draft on the server", async () => {
    const stored = { draft: null as unknown };
    mockApi({
      ...baseRoutes(),
      ...spaceRoutes("admin"),
      ...draftRoutes(stored),
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
    await waitFor(() =>
      expect(stored.draft).toMatchObject({ step: 1, holder: { kind: "account", id: ANNA } }),
    );
    expect(Object.keys(window.localStorage).filter((key) => key.includes("giveAccess"))).toEqual([]);
    await userEvent.click(await screen.findByRole("button", { name: "Continue giving access" }));
    expect(await screen.findByRole("radiogroup", { name: "What they may do" })).toBeTruthy();
  });

  it("continues a draft saved earlier and discards it on cancel", async () => {
    const stored = {
      draft: {
        step: 2,
        holder: { kind: "account", id: ANNA, name: "Anna Berger" },
        level: "commenter",
        where: "space",
        page: null,
      } as unknown,
    };
    const { requests } = mockApi({
      ...baseRoutes(),
      ...spaceRoutes("admin"),
      ...draftRoutes(stored),
      [`GET /api/v1/spaces/${SPACE_ID}/access-requests`]: () => ({ body: [] }),
      [`GET /api/v1/spaces/${SPACE_ID}/restricted-pages`]: () => ({ body: [] }),
    });
    await renderAt("/spaces/ITOPS/settings/access");
    await userEvent.click(await screen.findByRole("button", { name: "Continue giving access" }));
    const dialog = await screen.findByRole("dialog", { name: "Give access" });
    expect(await within(dialog).findByRole("radiogroup", { name: "Where" })).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel and discard" }));
    await waitFor(() => expect(stored.draft).toBeNull());
    expect(requests.filter((request) => request.method === "PUT")).toEqual([]);
    expect(await screen.findByRole("button", { name: "Give access" })).toBeTruthy();
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

  it("explains why someone has access to the space", async () => {
    mockApi({
      ...baseRoutes(),
      ...spaceRoutes("admin"),
      [`GET /api/v1/spaces/${SPACE_ID}/access-requests`]: () => ({ body: [] }),
      [`GET /api/v1/spaces/${SPACE_ID}/restricted-pages`]: () => ({ body: [] }),
      "GET /api/v1/people": people,
      [`GET /api/v1/spaces/${SPACE_ID}/access/explain`]: () => ({
        body: {
          accountId: ANNA,
          name: "Anna Berger",
          role: "editor",
          reasons: [{ type: "spaceRole", role: "editor", via: { type: "organizationMembers" } }],
          denial: null,
          restrictions: [],
          editRestricted: null,
          published: true,
        },
      }),
    });
    await renderAt("/spaces/ITOPS/settings/access");
    await userEvent.click(await screen.findByRole("combobox", { name: "Person" }));
    await userEvent.click(await screen.findByRole("option", { name: /Anna Berger/ }));
    expect(await screen.findByText("Anna Berger: Can edit")).toBeTruthy();
    expect(screen.getByText("Can edit in the space as a member of the organization")).toBeTruthy();
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

describe("finding spaces and restricted pages", () => {
  it("lists spaces people can ask to join and sends the request", async () => {
    const OTHER = "01929b1e-0000-7000-8000-0000000000a9";
    const { requests } = mockApi({
      ...baseRoutes(),
      "GET /api/v1/spaces": () => ({ body: { items: [], nextCursor: null } }),
      [`GET /api/v1/organizations/${ORGANIZATION.id}/discoverable-spaces`]: () => ({
        body: [
          { id: OTHER, key: "FIN", name: "Finance", description: "Budgets and invoices", requested: false },
        ],
      }),
      [`POST /api/v1/spaces/${OTHER}/access-requests`]: () => ({ status: 201, body: {} }),
    });
    await renderAt("/spaces");
    expect(await screen.findByText("Finance")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Ask to join" }));
    await userEvent.click(screen.getByRole("button", { name: "Ask to join Finance" }));
    expect(await screen.findByText("Request sent")).toBeTruthy();
    expect(requests.find((request) => request.method === "POST")?.path).toBe(
      `/api/v1/spaces/${OTHER}/access-requests`,
    );
  });

  it("marks restricted pages in the tree with a lock that screen readers announce", async () => {
    mockApi({
      ...baseRoutes(),
      ...spaceRoutes("editor"),
      [`GET /api/v1/spaces/${SPACE_ID}/items`]: (request: RecordedRequest) => ({
        body: {
          items: request.path.includes(`parentId=${OVERVIEW}`)
            ? [
                {
                  ...item(NETWORK, "Network", "page", OVERVIEW),
                  viewRestriction: "own",
                  editRestricted: false,
                },
              ]
            : [item(OVERVIEW, "IT Operations", "page", null, true)],
          nextCursor: null,
        },
      }),
    });
    await renderAt(`/spaces/ITOPS/folders/${RUNBOOKS}/runbooks`);
    expect(await screen.findByText("Restricted: only the access list can view it")).toBeTruthy();
  });
});

describe("app shell", () => {
  const MARKETING_ID = "01929b1e-0000-7000-8000-0000000000a2";

  function shellRoutes() {
    return {
      "GET /api/v1/starred": () => ({
        body: {
          items: [],
          spaces: [
            {
              id: SPACE_ID,
              key: "ITOPS",
              name: "IT Operations",
              personal: false,
              starredAt: space().createdAt,
            },
          ],
        },
      }),
      "GET /api/v1/recent": () => ({
        body: [
          {
            id: VPN,
            kind: "page",
            title: "VPN access",
            spaceId: SPACE_ID,
            spaceKey: "ITOPS",
            spaceName: "IT Operations",
            viewedAt: space().createdAt,
          },
          {
            id: NETWORK,
            kind: "page",
            title: "Campaigns",
            spaceId: MARKETING_ID,
            spaceKey: "MKT",
            spaceName: "Marketing",
            viewedAt: space().createdAt,
          },
        ],
      }),
    };
  }

  it("lists favorite and recently visited spaces outside a space and the space itself inside one", async () => {
    mockApi({ ...baseRoutes(), ...spaceRoutes(), ...shellRoutes() });
    await renderAt("/spaces");
    const navigation = await screen.findByRole("navigation", { name: "Main navigation" });
    const favorites = await within(navigation).findByRole("list", { name: "Favorites" });
    expect(within(favorites).getByRole("link", { name: "IT Operations" })).toBeTruthy();
    const recent = within(navigation).getByRole("list", { name: "Recently visited" });
    expect(
      within(recent)
        .getAllByRole("link")
        .map((link) => link.getAttribute("title")),
    ).toEqual(["Marketing"]);
    expect(within(navigation).getByRole("link", { name: "All spaces" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(within(navigation).queryByRole("button", { name: "Collapse sidebar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Expand sidebar" })).toBeNull();
    cleanup();

    await renderAt(`/spaces/ITOPS/folders/${RUNBOOKS}/runbooks`);
    const inside = await screen.findByRole("navigation", { name: "Main navigation" });
    expect(await within(inside).findByRole("link", { name: "Space settings" })).toBeTruthy();
    expect(within(inside).getByRole("link", { name: "Trash" })).toBeTruthy();
    expect(within(inside).queryByRole("link", { name: "All spaces" })).toBeNull();
    expect(within(inside).getByRole("link", { name: "For you" })).toBeTruthy();
  });

  it("shows only icons with names when the sidebar is collapsed", async () => {
    mockApi({
      ...baseRoutes(),
      ...shellRoutes(),
      "GET /api/v1/account/preferences": () => ({
        body: [
          {
            key: "appearance.sidebarCollapsed",
            value: true,
            defaultValue: false,
            source: "own",
            lockedBy: null,
            locked: false,
            lockable: false,
            levelsBelow: [],
            editable: true,
            levels: [],
          },
        ],
      }),
    });
    await renderAt("/spaces");
    const navigation = await screen.findByRole("navigation", { name: "Main navigation" });
    await waitFor(() => expect(navigation.hasAttribute("data-collapsed")).toBe(true));
    for (const name of ["For you", "My tasks", "All spaces"]) {
      const link = within(navigation).getByRole("link", { name });
      expect(link.getAttribute("aria-label")).toBe(name);
      expect(link.textContent).toBe("");
    }
    expect(within(navigation).queryByRole("list", { name: "Favorites" })).toBeNull();
  });

  it("offers the kinds of the current space in the Create menu", async () => {
    mockApi({ ...baseRoutes(), ...spaceRoutes("editor"), ...shellRoutes() });
    await renderAt(`/spaces/ITOPS/folders/${RUNBOOKS}/runbooks`);
    await screen.findByRole("link", { name: "Trash" });
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("In IT Operations")).toBeTruthy();
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((entry) => entry.textContent),
    ).toEqual(["Page", "Blog post", "Whiteboard", "Folder", "Link", "Meeting", "New one-on-one", "Space"]);
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Folder" }));
    expect(await screen.findByRole("dialog", { name: "New folder" })).toBeTruthy();
  });

  it("offers no content kinds in the Create menu of a space the person cannot edit", async () => {
    mockApi({ ...baseRoutes(["organization.view"]), ...spaceRoutes("reader"), ...shellRoutes() });
    await renderAt(`/spaces/ITOPS/folders/${RUNBOOKS}/runbooks`);
    await screen.findByRole("button", { name: "Space options" });
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((entry) => entry.textContent),
    ).toEqual(["New one-on-one"]);
  });

  it("asks for the space first outside a space, validates the choice and opens the creation there", async () => {
    const { requests } = mockApi({
      ...baseRoutes(),
      ...spaceRoutes("editor"),
      ...shellRoutes(),
      "GET /api/v1/spaces": () => ({ body: { items: [space("editor")], nextCursor: null } }),
    });
    await renderAt("/spaces");
    await userEvent.click(await screen.findByRole("button", { name: "Create" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("In a space")).toBeTruthy();
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Folder" }));
    const dialog = await screen.findByRole("dialog", { name: "Create Folder" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(await within(dialog).findByText("Choose a space.")).toBeTruthy();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.click(within(dialog).getByRole("combobox"));
    await userEvent.click(await screen.findByRole("option", { name: /IT Operations/ }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("dialog", { name: "New folder" })).toBeTruthy();
    expect(window.location.pathname.startsWith("/spaces/ITOPS")).toBe(true);
    expect(
      requests.some(
        (request) => request.path.startsWith("/api/v1/spaces?") && request.path.includes("role=editor"),
      ),
    ).toBe(true);
  });

  it("switches the organization from the top bar only when there are several", async () => {
    const second = { ...ORGANIZATION, id: "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e60", name: "Field Team" };
    mockApi({
      ...baseRoutes(),
      ...shellRoutes(),
      "GET /api/v1/organizations": () => ({ body: { items: [ORGANIZATION, second], nextCursor: null } }),
    });
    await renderAt("/spaces");
    await userEvent.click(
      await screen.findByRole("button", { name: "Switch organization, currently Platform Team" }),
    );
    const menu = await screen.findByRole("menu");
    expect(
      within(menu).getByRole("menuitemcheckbox", { name: "Platform Team" }).getAttribute("aria-checked"),
    ).toBe("true");
    await userEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "Field Team" }));
    await waitFor(() => expect(window.location.pathname).toBe("/home"));
    expect(
      await screen.findByRole("button", { name: "Switch organization, currently Field Team" }),
    ).toBeTruthy();
    expect(localStorage.getItem(`lunedo.organization.${OLIVIA.id}`)).toBe(second.id);
    cleanup();
    localStorage.clear();

    mockApi({ ...baseRoutes(), ...shellRoutes() });
    await renderAt("/spaces");
    await screen.findByRole("button", { name: "Create" });
    expect(screen.queryByRole("button", { name: /Switch organization/ })).toBeNull();
  });

  it("keeps the skip link and lists documentation, shortcuts and the API reference in the help menu", async () => {
    mockApi({ ...baseRoutes(), ...shellRoutes() });
    await renderAt("/spaces");
    expect((await screen.findByRole("link", { name: "Skip to content" })).getAttribute("href")).toBe("#main");
    await userEvent.click(screen.getByRole("button", { name: "Help" }));
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((entry) => entry.textContent),
    ).toEqual(["Lunedo documentation", "Keyboard shortcuts?", "API reference"]);
  });
});
