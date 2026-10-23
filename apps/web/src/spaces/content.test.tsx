import { diffDocuments } from "@lunedo/editor-schema";
import { render, screen, waitFor, within } from "@testing-library/react";
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
const VPN = "01929b1e-0000-7000-8000-0000000000b2";
const ENTRY = "01929b1e-0000-7000-8000-0000000000e1";
const DRAFT_ID = "01929b1e-0000-7000-8000-0000000000f1";

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

const page = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  spaceId: SPACE_ID,
  parentId: null,
  kind: "page",
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
  contentLanguage: null,
  createdAt: "2026-10-05T08:00:00.000Z",
  updatedAt: "2026-10-05T08:00:00.000Z",
  contentUpdatedAt: "2026-10-05T08:00:00.000Z",
  ...extra,
});

function doc(...texts: string[]) {
  return {
    type: "doc" as const,
    content: texts.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
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

function routes(
  role: Role,
  extra: Record<string, (request: RecordedRequest) => { status?: number; body?: unknown }> = {},
) {
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
      body: { items: [page(OVERVIEW, "IT Operations"), page(VPN, "VPN access")], nextCursor: null },
    }),
    [`GET /api/v1/spaces/${SPACE_ID}/archive`]: () => ({ body: [] }),
    [`GET /api/v1/items/${VPN}`]: () => ({
      body: {
        ...page(VPN, "VPN access"),
        spaceKey: "ITOPS",
        spaceName: "IT Operations",
        spaceContentLanguage: "en",
        ancestors: [],
      },
    }),
    [`GET /api/v1/items/${OVERVIEW}`]: () => ({
      body: {
        ...page(OVERVIEW, "IT Operations"),
        spaceKey: "ITOPS",
        spaceName: "IT Operations",
        ancestors: [],
      },
    }),
    [`GET /api/v1/pages/${VPN}/content`]: () => ({
      body: {
        itemId: VPN,
        title: "VPN access",
        version: 7,
        document: doc("Published text"),
        schemaVersion: 2,
        revision: 4,
        updatedAt: "2026-10-05T08:10:00.000Z",
        updatedBy: OLIVIA.id,
        references: { people: {}, pages: {} },
      },
    }),
    [`GET /api/v1/pages/${OVERVIEW}/content`]: () => ({
      body: {
        itemId: OVERVIEW,
        title: "IT Operations",
        version: 1,
        document: doc("Welcome"),
        schemaVersion: 2,
        revision: 1,
        updatedAt: "2026-10-05T08:10:00.000Z",
        updatedBy: OLIVIA.id,
        references: { people: {}, pages: {} },
      },
    }),
    [`GET /api/v1/pages/${VPN}/labels`]: () => ({ body: [] }),
    [`GET /api/v1/pages/${VPN}/backlinks`]: () => ({ body: [] }),
    [`GET /api/v1/pages/${OVERVIEW}/labels`]: () => ({ body: [] }),
    [`GET /api/v1/pages/${OVERVIEW}/backlinks`]: () => ({ body: [] }),
    [`GET /api/v1/pages/${VPN}/draft`]: () => ({
      body: {
        title: "VPN access",
        document: doc("Draft text"),
        revision: 9,
        updatedAt: "2026-10-07T08:00:00.000Z",
        hasChanges: true,
        changes: 3,
        basedOn: 7,
        contributors: [{ id: OLIVIA.id, name: "Anna Berger" }],
        references: { people: {}, pages: {} },
      },
    }),
    ...extra,
  };
}

async function renderAt(path: string) {
  window.history.replaceState(null, "", path);
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
}

describe("content language", () => {
  it("shows the language inherited from the space and saves another one at once", async () => {
    const { requests } = mockApi(
      routes("editor", {
        [`PUT /api/v1/pages/${VPN}/content-language`]: (request) => ({
          body: {
            ...page(VPN, "VPN access"),
            contentLanguage: (request.body as { language: string }).language,
          },
        }),
      }),
    );
    await renderAt(`/spaces/ITOPS/pages/${VPN}/vpn-access`);
    await screen.findByText("Published text");
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Content language" }));
    const dialog = await screen.findByRole("dialog", { name: "Content language of VPN access" });
    expect(within(dialog).getByText("Inherited from the space: English.")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("combobox", { name: "Language" }));
    await userEvent.click(await screen.findByRole("option", { name: "German" }));
    await waitFor(() =>
      expect(requests.find((request) => request.method === "PUT")?.body).toEqual({ language: "de" }),
    );
    expect(await within(dialog).findByText("Saved")).toBeTruthy();
  });
});

describe("page bar", () => {
  it("names the last editor with date and time and opens the versions on click", async () => {
    mockApi(
      routes("reader", {
        [`GET /api/v1/pages/${VPN}/versions`]: () => ({
          body: [
            {
              number: 7,
              title: "VPN access",
              note: "",
              reason: "published",
              restoredFrom: null,
              copiedFrom: null,
              createdAt: "2026-10-05T08:00:00.000Z",
              createdBy: { id: OLIVIA.id, name: "Anna Berger" },
              contributors: [],
            },
          ],
        }),
      }),
    );
    await renderAt(`/spaces/ITOPS/pages/${VPN}/vpn-access`);
    expect(await screen.findByText("Published text")).toBeTruthy();
    const info = await screen.findByRole("button", {
      name: /^.+ Edited by Anna Berger on .+, .+ · Click to open the versions$/,
    });
    expect(screen.queryByText(/Published .* · version 7/)).toBeNull();
    expect(screen.getByRole("navigation", { name: "Path" }).textContent).toContain("IT Operations");
    await userEvent.click(info);
    await waitFor(() => expect(window.location.pathname).toBe(`/spaces/ITOPS/pages/${VPN}/history`));
  });
});

describe("page actions", () => {
  it("keeps only edit info, Edit and Share in the bar and offers starring and watching in the menu", async () => {
    let starred = false;
    const { requests } = mockApi(
      routes("editor", {
        "GET /api/v1/starred": () => ({
          body: {
            items: starred
              ? [
                  {
                    id: VPN,
                    kind: "page",
                    title: "VPN access",
                    spaceKey: "ITOPS",
                    spaceName: "IT Operations",
                    starredAt: "2026-10-05T08:00:00.000Z",
                  },
                ]
              : [],
            spaces: [],
          },
        }),
        [`PUT /api/v1/starred/items/${VPN}`]: () => {
          starred = true;
          return { status: 204 };
        },
        [`GET /api/v1/items/${VPN}/watch`]: () => ({ body: { effective: null, own: null } }),
        [`PUT /api/v1/items/${VPN}/watch`]: () => ({ status: 204 }),
      }),
    );
    await renderAt(`/spaces/ITOPS/pages/${VPN}/vpn-access`);
    await screen.findByRole("radio", { name: "Draft · 3 changes" });
    expect(screen.queryByRole("button", { name: /^Star VPN access/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Watch/ })).toBeNull();
    expect(screen.queryByText("Starred")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    const menu = await screen.findByRole("menu");
    const entries = within(menu)
      .getAllByRole("menuitem")
      .map((entry) => entry.textContent);
    expect(entries.slice(0, 2)).toEqual(["Add to starred", "Watch"]);
    expect(entries).toContain("Versions");
    expect(entries.indexOf("Versions")).toBeLessThan(entries.indexOf("Copy…"));
    expect(entries.at(-1)).toBe("Move to trash");
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Add to starred" }));
    await waitFor(() =>
      expect(
        requests.some(
          (request) => request.method === "PUT" && request.path.endsWith(`/starred/items/${VPN}`),
        ),
      ).toBe(true),
    );
    expect(await screen.findByText("Starred")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    expect(await screen.findByRole("menuitem", { name: "Remove from starred" })).toBeTruthy();
    await userEvent.click(screen.getByRole("menuitem", { name: "Watch" }));
    await waitFor(() =>
      expect(
        requests.find((request) => request.method === "PUT" && request.path.endsWith(`/items/${VPN}/watch`))
          ?.body,
      ).toEqual({
        state: "watching",
      }),
    );
  });
});

describe("publish mode", () => {
  it("shows readers the published version without any draft", async () => {
    const { requests } = mockApi(routes("reader"));
    await renderAt(`/spaces/ITOPS/pages/${VPN}/vpn-access`);
    expect(await screen.findByText("Published text")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.queryByText(/unpublished change/)).toBeNull();
    expect(requests.some((request) => request.path.includes("/draft"))).toBe(false);
  });

  it("lets editors switch to the draft with its changes marked and discard it with undo", async () => {
    const diff = diffDocuments(
      { title: "VPN access", document: doc("Published text") },
      { title: "VPN access", document: doc("Published text and more") },
    );
    const { requests } = mockApi(
      routes("editor", {
        [`GET /api/v1/pages/${VPN}/compare`]: () => ({
          body: { diff, before: doc("a"), after: doc("b"), references: { people: {}, pages: {} } },
        }),
        [`POST /api/v1/pages/${VPN}/draft/discard`]: () => ({ body: { discardedDraftId: DRAFT_ID } }),
        [`POST /api/v1/pages/${VPN}/discarded-drafts/${DRAFT_ID}/restore`]: () => ({ status: 204 }),
      }),
    );
    await renderAt(`/spaces/ITOPS/pages/${VPN}/vpn-access`);
    expect(await screen.findByText("Published text")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
    await userEvent.click(await screen.findByRole("radio", { name: "Draft · 3 changes" }));
    const draft = await screen.findByRole("region", { name: "Draft with changes marked" });
    expect(draft.querySelector("ins.ld-diff-added")?.textContent).toContain("and more");
    expect(screen.getByRole("button", { name: "Continue editing" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(requests.some((request) => request.path.includes("/compare?from=7&to=draft"))).toBe(true);
    await userEvent.click(screen.getByRole("radio", { name: "Published" }));
    expect(await screen.findByRole("button", { name: "Edit" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Discard draft" }));
    expect(await screen.findByText("Draft discarded")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /Undo/ }));
    await waitFor(() =>
      expect(requests.some((request) => request.path.endsWith(`/discarded-drafts/${DRAFT_ID}/restore`))).toBe(
        true,
      ),
    );
  });

  it("asks before an open draft becomes visible in live mode", async () => {
    const { requests } = mockApi(
      routes("editor", { [`PUT /api/v1/pages/${VPN}/mode`]: () => ({ status: 204 }) }),
    );
    await renderAt(`/spaces/ITOPS/pages/${VPN}/vpn-access`);
    await screen.findByRole("radio", { name: "Draft · 3 changes" });
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Switch to live mode" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("The draft with 3 unpublished changes becomes visible to readers at once."),
    ).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Switch and show the draft" }));
    await waitFor(() =>
      expect(requests.find((request) => request.method === "PUT")?.body).toEqual({
        mode: "live",
        confirmDraft: true,
      }),
    );
  });
});

describe("version history", () => {
  const copiedVersion = (copiedFrom: {
    itemId: string | null;
    title: string | null;
    path: string | null;
  }) => ({
    number: 1,
    title: "VPN access",
    note: "",
    reason: "copied",
    restoredFrom: null,
    copiedFrom,
    createdAt: "2026-10-17T09:00:00.000Z",
    createdBy: { id: OLIVIA.id, name: "Anna Berger" },
    contributors: [],
  });

  it("names and links the source of a copy only for people who can read it", async () => {
    const source = "01929b1e-0000-7000-8000-0000000000f9";
    mockApi(
      routes("editor", {
        [`GET /api/v1/pages/${VPN}/versions`]: () => ({
          body: [
            copiedVersion({
              itemId: source,
              title: "Remote access",
              path: `/spaces/HR/pages/${source}/remote-access`,
            }),
          ],
        }),
        [`GET /api/v1/pages/${VPN}/discarded-drafts`]: () => ({ body: [] }),
      }),
    );
    await renderAt(`/spaces/ITOPS/pages/${VPN}/history`);
    expect(await screen.findByText("Copied from Remote access")).toBeTruthy();
    const link = await screen.findByRole(
      "link",
      { name: "Open the original Remote access" },
      { timeout: 8000 },
    );
    expect(link.getAttribute("href")).toContain(`/spaces/HR/pages/${source}/`);
  });

  it("shows neither title nor link of a source the person cannot read", async () => {
    mockApi(
      routes("editor", {
        [`GET /api/v1/pages/${VPN}/versions`]: () => ({
          body: [copiedVersion({ itemId: null, title: null, path: null })],
        }),
        [`GET /api/v1/pages/${VPN}/discarded-drafts`]: () => ({ body: [] }),
      }),
    );
    await renderAt(`/spaces/ITOPS/pages/${VPN}/history`);
    expect(await screen.findByText("Copied from another page")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Open the original/ })).toBeNull();
  });

  it("compares versions inline and side by side and restores into the draft", async () => {
    const diff = diffDocuments(
      { title: "VPN access", document: doc("Install the client from the intranet.") },
      { title: "VPN access", document: doc("Install the client from the company portal.") },
    );
    const { requests } = mockApi(
      routes("editor", {
        [`GET /api/v1/pages/${VPN}/versions`]: () => ({
          body: [
            {
              number: 7,
              title: "VPN access",
              note: "Portal link",
              reason: "published",
              restoredFrom: null,
              createdAt: "2026-10-03T14:20:00.000Z",
              createdBy: { id: OLIVIA.id, name: "Anna Berger" },
              contributors: [{ id: OLIVIA.id, name: "Anna Berger" }],
            },
            {
              number: 6,
              title: "VPN access",
              note: "",
              reason: "published",
              restoredFrom: null,
              createdAt: "2026-09-28T09:05:00.000Z",
              createdBy: { id: OLIVIA.id, name: "Lukas Hofer" },
              contributors: [{ id: OLIVIA.id, name: "Lukas Hofer" }],
            },
          ],
        }),
        [`GET /api/v1/pages/${VPN}/discarded-drafts`]: () => ({ body: [] }),
        [`GET /api/v1/pages/${VPN}/compare`]: () => ({
          body: { diff, before: doc("a"), after: doc("b"), references: { people: {}, pages: {} } },
        }),
        [`GET /api/v1/pages/${VPN}/versions/6`]: () => ({
          body: {
            number: 6,
            title: "VPN access",
            note: "",
            reason: "published",
            restoredFrom: null,
            createdAt: "2026-09-28T09:05:00.000Z",
            createdBy: { id: OLIVIA.id, name: "Lukas Hofer" },
            contributors: [],
            document: doc("a"),
            schemaVersion: 2,
            references: { people: {}, pages: {} },
          },
        }),
        [`POST /api/v1/pages/${VPN}/versions/6/restore`]: () => ({
          body: { mode: "publish", version: null },
        }),
      }),
    );
    await renderAt(`/spaces/ITOPS/pages/${VPN}/history?from=6&to=7`);
    const changes = await screen.findByRole("region", { name: "Changes" });
    expect(changes.querySelector("ins.ld-diff-added")?.textContent).toContain("company");
    expect(changes.querySelector("del.ld-diff-removed")?.textContent).toContain("intranet");
    await userEvent.click(screen.getByRole("radio", { name: "Side by side" }));
    expect(await screen.findByRole("region", { name: "Version 6" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Version 7" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /^Version 6/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Restore version 6" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/The current draft with 3 changes is kept for 30 days/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Restore version 6" }));
    await waitFor(() =>
      expect(requests.some((request) => request.path.endsWith("/versions/6/restore"))).toBe(true),
    );
  });
});

describe("the first version", () => {
  it("is shown on its own with a text saying so instead of being compared with itself", async () => {
    const { requests } = mockApi(
      routes("editor", {
        [`GET /api/v1/pages/${VPN}/versions`]: () => ({
          body: [
            {
              number: 2,
              title: "VPN access",
              note: "",
              reason: "published",
              restoredFrom: null,
              createdAt: "2026-10-03T14:20:00.000Z",
              createdBy: { id: OLIVIA.id, name: "Anna Berger" },
              contributors: [],
            },
            {
              number: 1,
              title: "VPN access",
              note: "",
              reason: "published",
              restoredFrom: null,
              createdAt: "2026-09-28T09:05:00.000Z",
              createdBy: { id: OLIVIA.id, name: "Lukas Hofer" },
              contributors: [],
            },
          ],
        }),
        [`GET /api/v1/pages/${VPN}/discarded-drafts`]: () => ({ body: [] }),
        [`GET /api/v1/pages/${VPN}/versions/1`]: () => ({
          body: {
            number: 1,
            title: "VPN access",
            note: "",
            reason: "published",
            restoredFrom: null,
            createdAt: "2026-09-28T09:05:00.000Z",
            createdBy: { id: OLIVIA.id, name: "Lukas Hofer" },
            contributors: [],
            document: doc("The very first text"),
            schemaVersion: 2,
            references: { people: {}, pages: {} },
          },
        }),
      }),
    );
    await renderAt(`/spaces/ITOPS/pages/${VPN}/history?to=1`);
    expect(await screen.findByText("This is the first version")).toBeTruthy();
    expect(await screen.findByText("The very first text")).toBeTruthy();
    expect(screen.queryByText("No differences")).toBeNull();
    expect(requests.some((request) => request.path.endsWith("/compare"))).toBe(false);
  });
});

describe("trash", () => {
  const entry = {
    id: ENTRY,
    spaceId: SPACE_ID,
    spaceKey: "ITOPS",
    spaceName: "IT Operations",
    kind: "items",
    itemId: VPN,
    itemKind: "page",
    title: "Old VPN setup",
    descendants: 2,
    stage: 1,
    deletedAt: "2026-10-02T10:00:00.000Z",
    deletedBy: { id: OLIVIA.id, name: "Lukas Hofer" },
    stageTwoAt: null,
    removedAt: new Date(Date.now() + 28.5 * 24 * 3600 * 1000).toISOString(),
    formerParentEntryId: null,
  };
  const FOLDER_ENTRY = "01929b1e-0000-7000-8000-0000000000e2";

  it("names the folder in the trash and restores both on request", async () => {
    const { requests } = mockApi(
      routes("editor", {
        [`GET /api/v1/spaces/${SPACE_ID}/trash`]: () => ({
          body: [
            { ...entry, formerParentEntryId: FOLDER_ENTRY },
            { ...entry, id: FOLDER_ENTRY, itemId: OVERVIEW, itemKind: "folder", title: "Runbooks" },
          ],
        }),
        [`POST /api/v1/spaces/${SPACE_ID}/trash/${ENTRY}/restore`]: (request) =>
          request.path.includes("withParents=true")
            ? { body: { itemId: VPN, parentId: OVERVIEW, parentEntries: 1 } }
            : { body: { itemId: VPN, parentId: null, parentEntries: 0 } },
      }),
    );
    await renderAt("/spaces/ITOPS/trash");
    const row = (await screen.findByText("Old VPN setup")).closest("tr") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Restore" }));
    const dialog = await screen.findByRole("dialog", { name: "“Runbooks” is in the trash too" });
    expect(within(dialog).getByText(/was below “Runbooks”/)).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Restore both" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Restore both" }));
    await waitFor(() =>
      expect(
        requests.some((request) => request.path.endsWith(`/trash/${ENTRY}/restore?withParents=true`)),
      ).toBe(true),
    );
  });

  it("restores only the page at the top level and says why when asked to", async () => {
    const { requests } = mockApi(
      routes("editor", {
        [`GET /api/v1/spaces/${SPACE_ID}/trash`]: () => ({
          body: [
            { ...entry, formerParentEntryId: FOLDER_ENTRY },
            { ...entry, id: FOLDER_ENTRY, itemId: OVERVIEW, itemKind: "folder", title: "Runbooks" },
          ],
        }),
        [`POST /api/v1/spaces/${SPACE_ID}/trash/${ENTRY}/restore`]: () => ({
          body: { itemId: VPN, parentId: null, parentEntries: 0 },
        }),
      }),
    );
    await renderAt("/spaces/ITOPS/trash");
    const row = (await screen.findByText("Old VPN setup")).closest("tr") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Restore" }));
    await userEvent.click(await screen.findByRole("button", { name: "Restore only “Old VPN setup”" }));
    expect(await screen.findByText(/“Runbooks”, where it was, is still in the trash/)).toBeTruthy();
    expect(requests.some((request) => request.path.includes("withParents"))).toBe(false);
  });

  it("lists deleted items, restores them and lets space admins empty the trash", async () => {
    const { requests } = mockApi(
      routes("admin", {
        [`GET /api/v1/spaces/${SPACE_ID}/trash`]: () => ({ body: [entry] }),
        [`POST /api/v1/spaces/${SPACE_ID}/trash/${ENTRY}/restore`]: () => ({
          body: { itemId: VPN, parentId: null, parentEntries: 0 },
        }),
        [`POST /api/v1/spaces/${SPACE_ID}/trash/empty`]: () => ({ body: { entries: 1 } }),
      }),
    );
    await renderAt("/spaces/ITOPS/trash");
    const row = (await screen.findByText("Old VPN setup")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Lukas Hofer")).toBeTruthy();
    expect(within(row).getByText("With 2 items below it")).toBeTruthy();
    expect(within(row).getByText("29 days")).toBeTruthy();
    await userEvent.click(within(row).getByRole("button", { name: "Restore" }));
    expect(await screen.findByText("“Old VPN setup” restored")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Empty trash with 1 entry" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Empty trash with 1 entry" }));
    await waitFor(() => expect(requests.some((request) => request.path.endsWith("/trash/empty"))).toBe(true));
  });

  it("offers to restore the pages above when a restricted parent page is in the trash", async () => {
    const { requests } = mockApi(
      routes("editor", {
        [`GET /api/v1/spaces/${SPACE_ID}/trash`]: () => ({ body: [entry] }),
        [`POST /api/v1/spaces/${SPACE_ID}/trash/${ENTRY}/restore`]: (request) =>
          request.path.includes("withParents=true")
            ? { body: { itemId: VPN, parentId: OVERVIEW, parentEntries: 1 } }
            : problem(409, "restrictedParentInTrash", {
                formerParent: { id: OVERVIEW, title: "Network" },
                parentEntries: 1,
              }),
      }),
    );
    await renderAt("/spaces/ITOPS/trash");
    const row = (await screen.findByText("Old VPN setup")).closest("tr") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Restore" }));
    expect(
      await screen.findByText(
        "“Network” is in the trash and restricts who can view this page. Restore the page together with the pages above it to keep that restriction.",
      ),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Restore with pages above" }));
    expect(
      await screen.findByText(
        "It is back below the pages above it, which were restored from the trash with it, so it keeps its view restrictions.",
      ),
    ).toBeTruthy();
    expect(
      requests.filter((request) => request.path.includes("/restore")).map((request) => request.path),
    ).toEqual([
      `/api/v1/spaces/${SPACE_ID}/trash/${ENTRY}/restore`,
      `/api/v1/spaces/${SPACE_ID}/trash/${ENTRY}/restore?withParents=true`,
    ]);
  });

  it("tells people who cannot restore the pages above whom to ask, without naming the page", async () => {
    mockApi(
      routes("editor", {
        [`GET /api/v1/spaces/${SPACE_ID}/trash`]: () => ({ body: [entry] }),
        [`POST /api/v1/spaces/${SPACE_ID}/trash/${ENTRY}/restore`]: () =>
          problem(409, "restrictedParentInTrash", { formerParent: null, parentEntries: 0 }),
      }),
    );
    await renderAt("/spaces/ITOPS/trash");
    const row = (await screen.findByText("Old VPN setup")).closest("tr") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Restore" }));
    expect(
      await screen.findByText(
        "This page was below a restricted page. Ask a space or organization administrator to restore the pages above it first.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Restore with pages above" })).toBeNull();
  });

  it("shows content kinds the client does not know yet without failing", async () => {
    mockApi(
      routes("admin", {
        [`GET /api/v1/spaces/${SPACE_ID}/items`]: (request) => ({
          body: {
            items: request.path.includes("parentId=")
              ? []
              : [
                  page(VPN, "VPN access"),
                  { ...page("01929b1e-0000-7000-8000-0000000000f2", "Team board"), kind: "database" },
                ],
            nextCursor: null,
          },
        }),
        [`GET /api/v1/spaces/${SPACE_ID}/trash`]: () => ({
          body: [{ ...entry, itemKind: "database", title: "Old board", descendants: 0 }],
        }),
      }),
    );
    await renderAt("/spaces/ITOPS/trash");
    const row = (await screen.findByText("Old board")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Item")).toBeTruthy();
    expect(await screen.findByText("Team board")).toBeTruthy();
  });

  it("is not shown to readers", async () => {
    mockApi(routes("reader"));
    await renderAt("/spaces/ITOPS/trash");
    expect(await screen.findByText("Only editors and space admins can see the trash.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Trash" })).toBeNull();
  });
});

describe("template gallery", () => {
  it("asks for the input values and creates the page from the template", async () => {
    const template = {
      id: "builtin:project-plan",
      level: "builtIn",
      organizationId: null,
      spaceId: null,
      name: "Project plan",
      description: "Goals, scope, milestones and risks.",
      category: "projects",
      title: "Project {name}",
      fields: [
        { key: "name", label: "Project name", type: "text", required: true },
        { key: "startDate", label: "Start date", type: "date", required: true },
      ],
      document: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "placeholder", attrs: { text: "Describe the goal." } }] },
        ],
      },
      updatedAt: null,
    };
    const { requests } = mockApi(
      routes("editor", {
        [`GET /api/v1/spaces/${SPACE_ID}/template-gallery`]: () => ({ body: [template] }),
        [`POST /api/v1/spaces/${SPACE_ID}/items`]: () => ({ status: 201, body: page(VPN, "Project Atlas") }),
      }),
    );
    await renderAt(`/spaces/ITOPS/pages/${OVERVIEW}/it-operations`);
    await userEvent.click(await screen.findByRole("button", { name: "Create in this space" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "New page" }));
    const dialog = await screen.findByRole("dialog", { name: "Create in IT Operations" });
    expect(within(dialog).getByRole("button", { name: /Blank page/, pressed: true })).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: /Project plan/ }));
    expect(within(dialog).getByText("Describe the goal.")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Create from Project plan" }));
    expect(await within(dialog).findByText("Enter Project name.")).toBeTruthy();
    await userEvent.type(within(dialog).getByRole("textbox", { name: /Project name/ }), "Atlas");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create from Project plan" }));
    await waitFor(() => {
      const created = requests.find(
        (request) => request.method === "POST" && request.path.endsWith("/items"),
      );
      expect(created?.body).toMatchObject({
        kind: "page",
        template: { id: "builtin:project-plan", values: { name: "Atlas" } },
      });
      expect(
        (created?.body as { template?: { values: Record<string, string> } } | undefined)?.template?.values
          .startDate,
      ).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });
});

describe("sharing and access", () => {
  const LUKAS = "01929b1e-0000-7000-8000-00000000a002";
  const REQUEST = "01929b1e-0000-7000-8000-00000000f001";
  const mine =
    (role: string, denial: string | null = null) =>
    () => ({
      body: {
        accountId: OLIVIA.id,
        name: OLIVIA.name,
        role,
        reasons: [],
        denial,
        restrictions: [],
        editRestricted: denial === "editRestricted" ? { listed: false } : null,
        published: true,
      },
    });

  it("offers sharing to editors and hides editing when the page restricts it", async () => {
    mockApi(
      routes("editor", {
        [`GET /api/v1/items/${VPN}`]: () => ({
          body: {
            ...page(VPN, "VPN access", { editRestricted: true }),
            spaceKey: "ITOPS",
            spaceName: "IT Operations",
            spaceAccess: true,
            ancestors: [],
          },
        }),
        [`GET /api/v1/pages/${VPN}/access/mine`]: mine("reader", "editRestricted"),
      }),
    );
    await renderAt(`/spaces/ITOPS/pages/${VPN}/vpn-access`);
    expect(
      await screen.findByText(/Only people on the access list with "Can edit" can edit this page/),
    ).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Edit" })).toBeNull());
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });

  it("shows a Share button to people who may share", async () => {
    mockApi(routes("editor", { [`GET /api/v1/pages/${VPN}/access/mine`]: mine("editor") }));
    await renderAt(`/spaces/ITOPS/pages/${VPN}/vpn-access`);
    expect(await screen.findByRole("button", { name: "Share" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  it("opens a page shared with someone outside the space without the space", async () => {
    const shareOnly = {
      ...page(VPN, "VPN access", { mode: "live" }),
      spaceKey: "",
      spaceName: "",
      spaceAccess: false,
      ancestors: [],
    };
    mockApi({
      ...routes("reader"),
      "GET /api/v1/space-keys/ITOPS": () => problem(404, "notFound"),
      [`GET /api/v1/items/${VPN}`]: () => ({ body: shareOnly }),
      [`GET /api/v1/pages/${VPN}/access/mine`]: mine("reader"),
      [`GET /api/v1/pages/${VPN}/attachments`]: () => ({ body: [] }),
      "GET /api/v1/shared-with-me": () => ({
        body: [
          {
            itemId: VPN,
            title: "VPN access",
            kind: "page",
            role: "reader",
            includeDescendants: false,
            sharedBy: { id: LUKAS, name: "Lukas Hofer" },
            sharedAt: "2026-10-05T08:00:00.000Z",
            spaceKey: "",
            spaceName: "",
          },
        ],
      }),
    });
    await renderAt(`/spaces/ITOPS/pages/${VPN}/vpn-access`);
    expect(await screen.findByText("Shared with you by Lukas Hofer")).toBeTruthy();
    expect(await screen.findByText("Published text")).toBeTruthy();
    expect(window.location.pathname).toBe(`/shared/${VPN}/vpn-access`);
    expect(await screen.findByRole("button", { name: /Comments/ })).toBeTruthy();
    expect(screen.queryByText("IT Operations")).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("lets people without access ask for it", async () => {
    const { requests } = mockApi({
      ...routes("reader"),
      "GET /api/v1/space-keys/ITOPS": () => problem(404, "notFound"),
      [`GET /api/v1/items/${VPN}`]: () => problem(404, "notFound"),
      [`POST /api/v1/pages/${VPN}/access-requests`]: () => ({ status: 202 }),
    });
    await renderAt(`/spaces/ITOPS/pages/${VPN}/vpn-access`);
    expect(await screen.findByText("This page does not exist or you have no access")).toBeTruthy();
    await userEvent.type(screen.getByRole("textbox", { name: /Message/ }), "I take over the VPN rollout.");
    await userEvent.click(screen.getByRole("button", { name: "Request access" }));
    expect(await screen.findByText("Request sent")).toBeTruthy();
    expect(requests.find((request) => request.method === "POST")?.body).toEqual({
      message: "I take over the VPN rollout.",
    });
  });

  it("lets a space admin approve a request with the chosen role", async () => {
    const entry = {
      id: REQUEST,
      requester: { id: LUKAS, name: "Lukas Hofer", email: "lukas@example.org" },
      spaceId: SPACE_ID,
      spaceName: "IT Operations",
      itemId: null,
      itemTitle: null,
      message: "On-call next month",
      status: "open",
      role: null,
      decidedBy: null,
      decidedAt: null,
      createdAt: "2026-10-05T08:00:00.000Z",
    };
    const { requests } = mockApi({
      ...routes("admin"),
      [`GET /api/v1/access-requests/${REQUEST}`]: () => ({ body: entry }),
      [`POST /api/v1/access-requests/${REQUEST}/decide`]: () => ({
        body: {
          ...entry,
          status: "approved",
          role: "editor",
          decidedBy: { id: OLIVIA.id, name: OLIVIA.name },
          decidedAt: "2026-10-06T08:00:00.000Z",
        },
      }),
    });
    await renderAt(`/access-requests/${REQUEST}`);
    expect(await screen.findByText("Lukas Hofer asks for access to the space IT Operations")).toBeTruthy();
    expect(screen.getByText("On-call next month")).toBeTruthy();
    await userEvent.click(screen.getByRole("combobox", { name: "Access to give" }));
    await userEvent.click(await screen.findByRole("option", { name: "Can edit" }));
    await userEvent.click(screen.getByRole("button", { name: 'Give Lukas Hofer "Can edit"' }));
    await waitFor(() =>
      expect(requests.find((request) => request.path.endsWith("/decide"))?.body).toEqual({
        approve: true,
        role: "editor",
        includeDescendants: false,
      }),
    );
    expect(await screen.findByText("Approved")).toBeTruthy();
  });

  it("tells a person who loses the edit permission while editing why the page became read-only", async () => {
    const sources: { listeners: Map<string, (event: MessageEvent<string>) => void> }[] = [];
    vi.stubGlobal(
      "EventSource",
      class {
        listeners = new Map<string, (event: MessageEvent<string>) => void>();
        constructor() {
          sources.push(this);
        }
        addEventListener(name: string, listener: (event: MessageEvent<string>) => void) {
          this.listeners.set(name, listener);
        }
        removeEventListener() {}
        close() {}
      },
    );
    let role: Role = "editor";
    mockApi(
      routes("editor", {
        "GET /api/v1/space-keys/ITOPS": () => ({ body: { space: space(role), redirected: false } }),
        [`GET /api/v1/items/${VPN}`]: () => ({
          body: {
            ...page(VPN, "VPN access", { mode: "live" }),
            spaceKey: "ITOPS",
            spaceName: "IT Operations",
            spaceAccess: true,
            ancestors: [],
          },
        }),
        [`GET /api/v1/pages/${VPN}/access/mine`]: () => mine(role)(),
      }),
    );
    await renderAt(`/spaces/ITOPS/pages/${VPN}/vpn-access?edit=true`);
    expect(await screen.findByRole("textbox", { name: "Page content" })).toBeTruthy();
    role = "reader";
    for (const source of sources) {
      source.listeners.get("spaces")?.(
        new MessageEvent("spaces", {
          data: JSON.stringify({ spaceId: SPACE_ID, kind: "access", itemId: null }),
        }),
      );
    }
    expect(await screen.findByText("You can no longer edit this page")).toBeTruthy();
    expect(await screen.findByText("Published text")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Page content" })).toBeNull();
  });
});

describe("an empty page", () => {
  const emptyContent = () => ({
    body: {
      itemId: VPN,
      title: "VPN access",
      version: 7,
      document: { type: "doc", content: [{ type: "paragraph" }] },
      schemaVersion: 2,
      revision: 4,
      updatedAt: "2026-10-05T08:10:00.000Z",
      updatedBy: OLIVIA.id,
      references: { people: {}, pages: {} },
    },
  });

  it("tells editors that it is empty and starts the editor from the page", async () => {
    mockApi(
      routes("editor", {
        [`GET /api/v1/pages/${VPN}/content`]: emptyContent,
        [`GET /api/v1/pages/${VPN}/draft`]: () => ({
          body: {
            title: "VPN access",
            document: { type: "doc", content: [{ type: "paragraph" }] },
            revision: 9,
            updatedAt: "2026-10-07T08:00:00.000Z",
            hasChanges: false,
            changes: 0,
            basedOn: 7,
            contributors: [],
            references: { people: {}, pages: {} },
          },
        }),
      }),
    );
    await renderAt(`/spaces/ITOPS/pages/${VPN}/vpn-access`);
    expect(await screen.findByText("This page is empty")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Start writing" }));
    await waitFor(() => expect(window.location.search).toContain("edit=true"));
  });

  it("tells readers that nothing has been written yet and offers no action", async () => {
    mockApi(routes("reader", { [`GET /api/v1/pages/${VPN}/content`]: emptyContent }));
    await renderAt(`/spaces/ITOPS/pages/${VPN}/vpn-access`);
    expect(await screen.findByText("This page is empty")).toBeTruthy();
    expect(screen.getByText("Nothing has been written here yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start writing" })).toBeNull();
  });
});

describe("leaving a space", () => {
  it("goes to the audit log of the organization from the shortcut instead of back into the space", async () => {
    mockApi(
      routes("editor", {
        "GET /api/v1/account/permissions": () => ({
          body: {
            instance: ["instance.content.view"],
            organization: ["organization.view", "organization.audit.view"],
            grantableAreas: { instance: {}, organization: {} },
          },
        }),
      }),
    );
    await renderAt(`/spaces/ITOPS/pages/${VPN}/vpn-access`);
    await screen.findByText("Published text");
    await userEvent.keyboard("ga");
    await waitFor(() =>
      expect(window.location.pathname).toBe(`/settings/organizations/${ORGANIZATION.id}/audit-log`),
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(window.location.pathname).toBe(`/settings/organizations/${ORGANIZATION.id}/audit-log`);
  });
});
