import { diffDocuments } from "@pagehall/editor-schema";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "../app.js";
import { initI18n } from "../i18n/index.js";
import { mockApi, problem } from "../testing/render.js";

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
const IMPORT_ID = "01929b1e-0000-7000-8000-0000000000e1";
const FIRST_ID = "01929b1e-0000-7000-8000-0000000000e9";
const SPACE_ID = "01929b1e-0000-7000-8000-0000000000e2";
const PAGE_ID = "01929b1e-0000-7000-8000-0000000000e3";
const OTHER_PAGE = "01929b1e-0000-7000-8000-0000000000e4";
const CHANGE = (n: number) => `01929b1e-0000-7000-8000-0000000001${String(n).padStart(2, "0")}`;

function importView(overrides: Record<string, unknown> = {}) {
  return {
    id: IMPORT_ID,
    organizationId: ORGANIZATION.id,
    importer: { id: OLIVIA.id, name: OLIVIA.name },
    source: "confluence-xml",
    state: "review",
    draftStep: 2,
    file: { kind: "upload", name: "export.zip", size: 2048, uploadId: CHANGE(90), complete: true },
    spaceName: "Archive",
    spaceKey: "ARCH",
    archived: false,
    history: false,
    peopleSource: { kind: "skip", site: null, email: null, people: null, withEmail: null },
    connection: null,
    files: [],
    options: {},
    throttledUntil: null,
    tokenDeletedAt: null,
    sourceUrl: null,
    reviewers: [],
    phase: null,
    progress: { done: 0, total: 0 },
    found: {
      pages: 12,
      blogPosts: 1,
      versions: 4,
      comments: 5,
      likes: 2,
      watchers: 3,
      attachments: 3,
      attachmentBytes: 4096,
      people: 2,
      macroKinds: 1,
      spaceKey: "ARCH",
      spaceName: "Archive",
    },
    counts: { new: 2, updated: 19, unchanged: 1203, conflicts: 2, deleted: 1, labels: 0, newComments: 3 },
    errorCode: null,
    quarantineSpace: null,
    targetSpace: { id: SPACE_ID, key: "ARCH", name: "Archive" },
    reimportSpaceId: SPACE_ID,
    canManage: true,
    canResolve: true,
    canTakeOver: false,
    startedAt: "2026-10-10T08:00:00.000Z",
    finishedAt: "2026-10-10T08:05:00.000Z",
    decidedAt: null,
    fileExpiresAt: null,
    createdAt: "2026-10-10T07:50:00.000Z",
    updatedAt: "2026-10-10T08:05:00.000Z",
    ...overrides,
  };
}

function change(overrides: Record<string, unknown>) {
  return {
    id: CHANGE(1),
    kind: "page",
    change: "conflict",
    item: { id: PAGE_ID, title: "On-call rota", spaceKey: "ARCH" },
    title: "On-call rota",
    sourceTitle: "On-call rota",
    reason: "both",
    editing: false,
    changedHere: { by: { id: OLIVIA.id, name: "Lukas Hofer" }, at: "2026-10-09T09:00:00.000Z" },
    changedAtSource: "2026-10-10T07:00:00.000Z",
    from: null,
    to: null,
    labels: null,
    permission: null,
    held: false,
    heldFor: null,
    decisions: ["pagehall", "source", "both"],
    decision: null,
    decidedBy: null,
    decidedAt: null,
    appliedAt: null,
    ...overrides,
  };
}

const SUMMARY = {
  tabs: [
    { tab: "conflicts", count: 2, open: 2 },
    { tab: "updates", count: 21, open: 0 },
    { tab: "deleted", count: 1, open: 1 },
    { tab: "moved", count: 0, open: 0 },
    { tab: "permissions", count: 1, open: 0 },
  ],
  hidden: 0,
  counts: { new: 2, updated: 19, unchanged: 1203, conflicts: 2, deleted: 1, labels: 0, newComments: 3 },
  open: 3,
  applying: false,
};

function setup(
  routes: Record<string, (request: { path: string; body?: unknown }) => { status?: number; body?: unknown }>,
) {
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
        organization: ["organization.view", "organization.imports.manage"],
        grantableAreas: { instance: {}, organization: {} },
      },
    }),
    "GET /api/v1/account/preferences": () => ({ body: [] }),
    "GET /api/v1/notifications/unread-count": () => ({ body: { count: 0 } }),
    ...routes,
  });
}

function changeRoutes(lists: Record<string, unknown[]>, summary: Record<string, unknown> = SUMMARY) {
  return {
    [`GET /api/v1/imports/${IMPORT_ID}`]: () => ({ body: importView() }),
    [`GET /api/v1/imports/${IMPORT_ID}/changes/summary`]: () => ({ body: summary }),
    [`GET /api/v1/imports/${IMPORT_ID}/changes`]: (request: { path: string }) => {
      const tab = new URL(request.path, "http://localhost").searchParams.get("tab") ?? "";
      return { body: { items: lists[tab] ?? [], nextCursor: null } };
    },
  };
}

async function open(path: string) {
  window.history.replaceState(null, "", path);
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
}

const DETAIL = `/settings/organizations/${ORGANIZATION.id}/imports/${IMPORT_ID}`;

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
  vi.unstubAllGlobals();
});

describe("re-import changes", () => {
  it("lists conflicts and decides several at once, then applies the changes", async () => {
    const api = setup({
      ...changeRoutes({
        conflicts: [
          change({}),
          change({
            id: CHANGE(2),
            item: { id: OTHER_PAGE, title: "Printer queue", spaceKey: "ARCH" },
            title: "Printer queue",
            reason: "editing",
            editing: true,
          }),
        ],
      }),
      [`PUT /api/v1/imports/${IMPORT_ID}/changes/decisions`]: () => ({ body: { decided: 2 } }),
      [`POST /api/v1/imports/${IMPORT_ID}/apply`]: () => ({
        body: importView({ state: "running", phase: "lineage" }),
      }),
    });
    await open(DETAIL);
    expect(await screen.findByRole("heading", { name: "Changes since the last import" })).toBeTruthy();
    const tabs = screen.getByRole("tablist", { name: "Changes" });
    expect(within(tabs).getByRole("tab", { name: /Changed on both sides/ }).textContent).toContain("2");
    expect(within(tabs).getByRole("tab", { name: /New and updated/ }).textContent).toContain("21");
    expect(await screen.findByText("Being edited")).toBeTruthy();
    expect(screen.getByText(/2 conflicts and 1 deleted page still need a decision/)).toBeTruthy();
    await userEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    const bar = screen.getByRole("toolbar", { name: "Decide for the selected changes" });
    expect(within(bar).getByText("2 selected")).toBeTruthy();
    await userEvent.click(within(bar).getByRole("button", { name: "Keep both" }));
    await waitFor(() =>
      expect(api.requests.find((request) => request.method === "PUT")?.body).toEqual({
        ids: [CHANGE(1), CHANGE(2)],
        decision: "both",
      }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    await waitFor(() =>
      expect(
        api.requests.some((request) => request.method === "POST" && request.path.endsWith("/apply")),
      ).toBe(true),
    );
  });

  it("saves a single decision at once and confirms it at the field", async () => {
    const api = setup({
      ...changeRoutes({
        deleted: [
          change({ change: "deleted", reason: null, changedHere: null, decisions: ["trash", "keep"] }),
        ],
      }),
      [`PUT /api/v1/imports/${IMPORT_ID}/changes/decisions`]: () => ({ body: { decided: 1 } }),
    });
    await open(`${DETAIL}?tab=deleted`);
    await userEvent.click(await screen.findByRole("combobox", { name: "Decision for On-call rota" }));
    await userEvent.click(await screen.findByRole("option", { name: "Move to the trash" }));
    expect(await screen.findByText("Saved")).toBeTruthy();
    expect(api.requests.find((request) => request.method === "PUT")?.body).toEqual({
      ids: [CHANGE(1)],
      decision: "trash",
    });
    expect(screen.getByText("Not changed since the import")).toBeTruthy();
  });

  it("shows who gains access before a permission difference is applied", async () => {
    const api = setup({
      ...changeRoutes({
        permissions: [
          change({
            change: "permission",
            kind: "spacePermission",
            item: null,
            title: null,
            reason: null,
            permission: {
              scope: "space",
              action: "grant",
              holder: { kind: "group", id: CHANGE(50), name: "Readers", sourceName: "readers" },
              role: "editor",
              currentRole: null,
              restriction: null,
              applicable: true,
            },
          }),
        ],
      }),
      [`POST /api/v1/imports/${IMPORT_ID}/changes/${CHANGE(1)}/preview`]: () => ({
        body: {
          space: {
            gaining: 1,
            losing: 0,
            raised: 0,
            lowered: 0,
            changes: [{ accountId: OLIVIA.id, name: "Mia Mitchell", before: null, after: "editor" }],
            unlisted: 0,
            truncated: false,
          },
          page: null,
        },
      }),
      [`POST /api/v1/imports/${IMPORT_ID}/changes/${CHANGE(1)}/apply`]: () => ({ status: 204 }),
    });
    await open(`${DETAIL}?tab=permissions`);
    expect(await screen.findByText("Readers: Editor in Confluence, no access in Pagehall")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Apply…" }));
    const dialog = await screen.findByRole("dialog", { name: "Apply this permission difference?" });
    expect(within(dialog).getByText(/Mia Mitchell/)).toBeTruthy();
    expect(api.requests.some((request) => request.path.endsWith("/apply") && request.method === "POST")).toBe(
      false,
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Apply difference" }));
    await waitFor(() =>
      expect(api.requests.some((request) => request.path.endsWith(`${CHANGE(1)}/apply`))).toBe(true),
    );
  });

  it("says when changes concern pages the person cannot open", async () => {
    setup(changeRoutes({ conflicts: [] }, { ...SUMMARY, hidden: 3 }));
    await open(DETAIL);
    expect(await screen.findByText("Some changes are not shown")).toBeTruthy();
    expect(screen.getByText(/3 changes concern pages you cannot open/)).toBeTruthy();
    expect(await screen.findByText("Nothing was changed on both sides")).toBeTruthy();
  });

  it("starts a re-import from an accepted import and opens its wizard", async () => {
    const api = setup({
      [`GET /api/v1/imports/${FIRST_ID}`]: () => ({
        body: importView({
          id: FIRST_ID,
          state: "accepted",
          targetSpace: null,
          quarantineSpace: { id: SPACE_ID, key: "ARCH" },
          counts: { pages: 12 },
        }),
      }),
      [`GET /api/v1/imports/${FIRST_ID}/report`]: () => ({
        body: {
          categories: [],
          total: 0,
          placeholders: 0,
          mapped: 0,
          permissionsToCheck: 0,
          groupsMissing: 0,
        },
      }),
      [`GET /api/v1/imports/${FIRST_ID}/report/macros`]: () => ({ body: [] }),
      [`POST /api/v1/organizations/${ORGANIZATION.id}/imports`]: () => ({
        status: 201,
        body: importView({ state: "draft", draftStep: 0, file: null, found: null }),
      }),
      [`GET /api/v1/imports/${IMPORT_ID}`]: () => ({
        body: importView({ state: "draft", draftStep: 0, file: null, found: null }),
      }),
      [`GET /api/v1/organizations/${ORGANIZATION.id}/import-folder`]: () => ({
        body: { enabled: false, path: "/data/import/platform-team", files: [], maxUploadBytes: 1024 },
      }),
    });
    await open(`/settings/organizations/${ORGANIZATION.id}/imports/${FIRST_ID}`);
    await userEvent.click(await screen.findByRole("button", { name: "Re-import a newer export" }));
    await waitFor(() =>
      expect(api.requests.find((request) => request.method === "POST")?.body).toEqual({
        source: "confluence-xml",
        spaceId: SPACE_ID,
      }),
    );
    const steps = await screen.findByRole("list", { name: "Steps of the import" });
    expect(
      within(steps)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["1Source", "2People", "3Check and start"]);
  });

  it("compares a conflict before deciding and decides on the comparison", async () => {
    const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
    const api = setup({
      ...changeRoutes({ conflicts: [change({})] }),
      [`GET /api/v1/imports/${IMPORT_ID}/changes/${CHANGE(1)}/compare`]: () => ({
        body: {
          kind: "page",
          pagehall: { title: "On-call rota", version: null },
          source: { title: "On-call rota", version: 7 },
          decisions: ["pagehall", "source", "both"],
          decision: null,
          diff: diffDocuments(
            {
              title: "On-call rota",
              document: { type: "doc", content: [paragraph("Lukas covers weekends")] },
            },
            {
              title: "On-call rota",
              document: { type: "doc", content: [paragraph("Mira covers weekends")] },
            },
          ),
          before: { type: "doc", content: [paragraph("Lukas covers weekends")] },
          after: { type: "doc", content: [paragraph("Mira covers weekends")] },
          references: { people: {}, pages: {}, topics: {} },
        },
      }),
      [`PUT /api/v1/imports/${IMPORT_ID}/changes/decisions`]: () => ({ body: { decided: 1 } }),
    });
    await open(DETAIL);
    await userEvent.click(
      await screen.findByRole("link", { name: "Compare “On-call rota” with the Confluence version" }),
    );
    expect(await screen.findByRole("heading", { name: "Compare “On-call rota”" })).toBeTruthy();
    expect(await screen.findByText("1 change")).toBeTruthy();
    expect(
      screen.getByText("Left or removed: Pagehall, current content. Right or added: Confluence, version 7."),
    ).toBeTruthy();
    expect(api.requests.some((request) => request.method !== "GET")).toBe(false);
    await userEvent.click(screen.getByRole("radio", { name: "Side by side" }));
    expect(await screen.findByRole("heading", { name: "Confluence, version 7" })).toBeTruthy();
    await userEvent.click(screen.getByRole("combobox", { name: "Decision for On-call rota" }));
    await userEvent.click(await screen.findByRole("option", { name: "Take Confluence version" }));
    expect(await screen.findByText("Saved")).toBeTruthy();
    expect(api.requests.find((request) => request.method === "PUT")?.body).toEqual({
      ids: [CHANGE(1)],
      decision: "source",
    });
  });

  it("offers only keeping the Pagehall version while a restriction from Confluence waits", async () => {
    const api = setup({
      ...changeRoutes({
        conflicts: [
          change({
            reason: "restricted",
            held: true,
            heldFor: { differenceId: CHANGE(9), title: "Finance" },
            decisions: ["pagehall"],
          }),
          change({
            id: CHANGE(2),
            item: { id: OTHER_PAGE, title: "Printer queue", spaceKey: "ARCH" },
            title: "Printer queue",
          }),
        ],
      }),
      [`PUT /api/v1/imports/${IMPORT_ID}/changes/decisions`]: () => ({ body: { decided: 2 } }),
    });
    await open(DETAIL);
    expect(await screen.findByText(/Waits for the restriction of “Finance” from Confluence/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Show the permission difference" }).getAttribute("href"),
    ).toContain("tab=permissions");
    await userEvent.click(screen.getByRole("combobox", { name: "Decision for On-call rota" }));
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Keep Pagehall version", "Decide later"]);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    const bar = screen.getByRole("toolbar", { name: "Decide for the selected changes" });
    expect(within(bar).queryByRole("button", { name: "Take Confluence version" })).toBeNull();
    expect(within(bar).queryByRole("button", { name: "Keep both" })).toBeNull();
    expect(within(bar).getByText(/only “Keep Pagehall version” is offered/)).toBeTruthy();
    await userEvent.click(within(bar).getByRole("button", { name: "Keep Pagehall version" }));
    await waitFor(() =>
      expect(api.requests.find((request) => request.method === "PUT")?.body).toEqual({
        ids: [CHANGE(1), CHANGE(2)],
        decision: "pagehall",
      }),
    );
  });

  it("offers only keeping the Pagehall version on the comparison while a restriction waits", async () => {
    const document = {
      type: "doc" as const,
      content: [{ type: "paragraph", content: [{ type: "text", text: "Rota" }] }],
    };
    setup({
      ...changeRoutes({}),
      [`GET /api/v1/imports/${IMPORT_ID}/changes/${CHANGE(1)}/compare`]: () => ({
        body: {
          kind: "page",
          pagehall: { title: "On-call rota", version: null },
          source: { title: "On-call rota", version: 7 },
          decisions: ["pagehall"],
          decision: null,
          diff: diffDocuments({ title: "On-call rota", document }, { title: "On-call rota", document }),
          before: document,
          after: document,
          references: { people: {}, pages: {}, topics: {} },
        },
      }),
    });
    await open(`${DETAIL}/changes/${CHANGE(1)}/compare`);
    expect(await screen.findByText(/only “Keep Pagehall version” is possible/)).toBeTruthy();
    await userEvent.click(screen.getByRole("combobox", { name: "Decision for On-call rota" }));
    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Keep Pagehall version", "Decide later"]);
  });

  it("explains that the source of a page restricted further is not shown", async () => {
    setup({
      ...changeRoutes({}),
      [`GET /api/v1/imports/${IMPORT_ID}/changes/${CHANGE(1)}/compare`]: () =>
        problem(403, "comparisonWithheld"),
    });
    await open(`${DETAIL}/changes/${CHANGE(1)}/compare`);
    expect(await screen.findByText("The new content is restricted in Confluence")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open permission differences" }).getAttribute("href")).toContain(
      "tab=permissions",
    );
  });
});

describe("old Confluence links", () => {
  it("opens the imported page from a pasted link and explains an unknown one", async () => {
    let found = true;
    const api = setup({
      [`GET /api/v1/imports/${IMPORT_ID}`]: () => ({
        body: importView({
          state: "accepted",
          targetSpace: null,
          quarantineSpace: { id: SPACE_ID, key: "ARCH" },
        }),
      }),
      [`GET /api/v1/imports/${IMPORT_ID}/report`]: () => ({
        body: {
          categories: [],
          total: 0,
          placeholders: 0,
          mapped: 0,
          permissionsToCheck: 0,
          groupsMissing: 0,
        },
      }),
      [`GET /api/v1/imports/${IMPORT_ID}/report/macros`]: () => ({ body: [] }),
      "GET /api/v1/confluence-links": () =>
        found
          ? {
              body: {
                itemId: PAGE_ID,
                kind: "page",
                spaceKey: "ARCH",
                title: "On-call rota",
                slug: "on-call-rota",
              },
            }
          : problem(404, "notFound"),
    });
    await open(DETAIL);
    const field = await screen.findByRole("textbox", { name: "Paste an old Confluence link" });
    await userEvent.type(field, "not a link");
    await userEvent.click(screen.getByRole("button", { name: "Open page" }));
    expect(await screen.findByText(/This is not a Confluence page link/)).toBeTruthy();
    expect(api.requests.some((request) => request.path.startsWith("/api/v1/confluence-links"))).toBe(false);
    found = false;
    await userEvent.clear(field);
    await userEvent.type(field, "https://wiki.example.org/display/OPS/Gone");
    await userEvent.click(screen.getByRole("button", { name: "Open page" }));
    expect(await screen.findByText(/No page you can open was imported from this link/)).toBeTruthy();
    found = true;
    await userEvent.click(screen.getByRole("button", { name: "Open page" }));
    await waitFor(() => expect(window.location.pathname).toBe(`/spaces/ARCH/pages/${PAGE_ID}/on-call-rota`));
    const request = api.requests.findLast((entry) => entry.path.startsWith("/api/v1/confluence-links"));
    expect(new URL(request?.path ?? "", "http://localhost").searchParams.get("url")).toBe(
      "https://wiki.example.org/display/OPS/Gone",
    );
  });

  it("redirects an old Confluence address and explains when nothing was found", async () => {
    let found = false;
    const api = setup({
      "GET /api/v1/confluence-links": () =>
        found
          ? {
              body: {
                itemId: PAGE_ID,
                kind: "page",
                spaceKey: "ARCH",
                title: "On-call rota",
                slug: "on-call-rota",
              },
            }
          : problem(404, "notFound"),
    });
    await open("/confluence/pages/viewpage.action?pageId=42");
    expect(await screen.findByText("This Confluence page is not here")).toBeTruthy();
    const request = api.requests.find((entry) => entry.path.startsWith("/api/v1/confluence-links"));
    expect(new URL(request?.path ?? "", "http://localhost").searchParams.get("url")).toBe(
      "/pages/viewpage.action?pageId=42",
    );
    found = true;
  });
});
