import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "../app.js";
import { initI18n } from "../i18n/index.js";
import { mockApi } from "../testing/render.js";
import { combinedSha256, sha256Hex, uploadParts } from "./upload.js";

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
const IMPORT_ID = "01929b1e-0000-7000-8000-0000000000c1";
const SPACE_ID = "01929b1e-0000-7000-8000-0000000000c2";

function importView(overrides: Record<string, unknown> = {}) {
  return {
    id: IMPORT_ID,
    organizationId: ORGANIZATION.id,
    importer: { id: OLIVIA.id, name: OLIVIA.name },
    source: "confluence-xml",
    state: "review",
    draftStep: 2,
    file: {
      kind: "upload",
      name: "export.zip",
      size: 2048,
      uploadId: "01929b1e-0000-7000-8000-0000000000c3",
      complete: true,
    },
    spaceName: "IT Operations",
    spaceKey: "ITOPS",
    archived: false,
    history: false,
    peopleSource: null,
    connection: null,
    files: [],
    options: {},
    throttledUntil: null,
    waitingFor: null,
    tokenDeletedAt: null,
    sourceUrl: null,
    reviewers: [{ id: "01929b1e-0000-7000-8000-0000000000c4", name: "Lukas Hofer" }],
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
      spaceKey: "ITOPS",
      spaceName: "IT Operations",
    },
    counts: { pages: 12, attachments: 3, attachmentVersions: 4, people: 2, problems: 1 },
    errorCode: null,
    quarantineSpace: { id: SPACE_ID, key: "ITOPS" },
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

function setup(routes: Record<string, () => { status?: number; body?: unknown }>, permissions: string[]) {
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
        organization: ["organization.view", ...permissions],
        grantableAreas: { instance: {}, organization: {} },
      },
    }),
    "GET /api/v1/account/preferences": () => ({ body: [] }),
    "GET /api/v1/notifications/unread-count": () => ({ body: { count: 0 } }),
    [`GET /api/v1/organizations/${ORGANIZATION.id}/import-folder`]: () => ({
      body: { enabled: true, path: FOLDER_PATH, files: [], maxUploadBytes: 1024 },
    }),
    ...routes,
  });
}

const FOLDER_PATH = "/data/import/example-group";

async function open(path: string) {
  window.history.replaceState(null, "", path);
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
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
  vi.unstubAllGlobals();
});

describe("imports list", () => {
  it("shows each import with its state and the way to continue", async () => {
    setup(
      {
        [`GET /api/v1/organizations/${ORGANIZATION.id}/imports`]: () => ({
          body: [
            importView(),
            importView({
              id: "01929b1e-0000-7000-8000-0000000000d1",
              state: "draft",
              spaceName: null,
              found: null,
            }),
          ],
        }),
      },
      ["organization.imports.manage"],
    );
    await open(`/settings/organizations/${ORGANIZATION.id}/imports`);
    const list = await screen.findByRole("list", { name: "Imports" });
    expect(within(list).getByText("IT Operations")).toBeTruthy();
    expect(within(list).getByText("In review")).toBeTruthy();
    expect(within(list).getByRole("button", { name: "Open report" })).toBeTruthy();
    expect(within(list).getByRole("button", { name: "Continue" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "New import" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("textbox", { name: "Import folder of this organization" })).toHaveProperty(
      "value",
      FOLDER_PATH,
    );
  });

  it("explains the first use and offers no new import without the permission", async () => {
    setup({ [`GET /api/v1/organizations/${ORGANIZATION.id}/imports`]: () => ({ body: [] }) }, []);
    await open(`/settings/organizations/${ORGANIZATION.id}/imports`);
    expect(await screen.findByText("No imports yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New import" })).toBeNull();
  });
});

describe("import wizard", () => {
  it("shows the organization's import folder in the wizard", async () => {
    setup(
      {
        [`GET /api/v1/imports/${IMPORT_ID}`]: () => ({
          body: importView({ state: "draft", file: null, found: null }),
        }),
      },
      ["organization.imports.manage"],
    );
    await open(`/settings/organizations/${ORGANIZATION.id}/imports/${IMPORT_ID}/setup?step=0`);
    await userEvent.click(await screen.findByText("Server import folder", { exact: true }));
    expect(
      (
        (await screen.findByRole("textbox", {
          name: "Import folder of this organization",
        })) as HTMLInputElement
      ).value,
    ).toBe(FOLDER_PATH);
    expect(screen.getByText("The import folder is empty")).toBeTruthy();
  });

  it("marks the missing file at the field and moves the focus to it", async () => {
    setup(
      {
        [`GET /api/v1/imports/${IMPORT_ID}`]: () => ({
          body: importView({ state: "draft", file: null, found: null }),
        }),
        [`PATCH /api/v1/imports/${IMPORT_ID}`]: () => ({ body: importView({ state: "draft", file: null }) }),
      },
      ["organization.imports.manage"],
    );
    await open(`/settings/organizations/${ORGANIZATION.id}/imports/${IMPORT_ID}/setup?step=0`);
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
    const message = await screen.findByText("Choose the export file, and wait until the upload is finished.");
    expect(message.closest("[role='alert']")).toBeTruthy();
    const input = screen.getByLabelText(/Drop the export here/);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("asks for the space of a site backup at the field and saves the choice", async () => {
    const spaces = [
      { key: "PHIT", name: "IT-Team" },
      { key: "PHKB", name: "Wissensdatenbank" },
    ];
    const api = setup(
      {
        [`GET /api/v1/imports/${IMPORT_ID}`]: () => ({
          body: importView({
            state: "draft",
            found: null,
            errorCode: "spaceChoiceRequired",
            sourceSpaces: spaces,
          }),
        }),
        [`PATCH /api/v1/imports/${IMPORT_ID}`]: () => ({
          body: importView({
            state: "analyzing",
            found: null,
            options: { spaceKey: "PHIT" },
            sourceSpaces: spaces,
          }),
        }),
      },
      ["organization.imports.manage"],
    );
    await open(`/settings/organizations/${ORGANIZATION.id}/imports/${IMPORT_ID}/setup?step=0`);
    expect(await screen.findByText("Space in the site backup")).toBeTruthy();
    expect(screen.queryByText("The site backup contains several spaces")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Choose the space to import from the site backup.")).toBeTruthy();
    const select = screen.getByRole("combobox", { name: "Space" });
    expect(select.getAttribute("aria-invalid")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(select));
    await userEvent.click(select);
    await userEvent.click(await screen.findByRole("option", { name: /IT-Team/ }));
    await waitFor(() =>
      expect(api.requests.find((request) => request.method === "PATCH")?.body).toEqual({
        options: { spaceKey: "PHIT" },
      }),
    );
  });

  it("refuses a file above the upload limit before anything is sent", async () => {
    const api = setup(
      {
        [`GET /api/v1/imports/${IMPORT_ID}`]: () => ({
          body: importView({ state: "draft", file: null, found: null }),
        }),
        [`PATCH /api/v1/imports/${IMPORT_ID}`]: () => ({ body: importView({ state: "draft", file: null }) }),
      },
      ["organization.imports.manage"],
    );
    await open(`/settings/organizations/${ORGANIZATION.id}/imports/${IMPORT_ID}/setup?step=0`);
    const input = (await screen.findByLabelText(/Drop the export here/)) as HTMLInputElement;
    await userEvent.upload(input, new File([new Uint8Array(4096)], "big.zip", { type: "application/zip" }));
    expect(await screen.findByText("big.zip cannot be uploaded")).toBeTruthy();
    expect(screen.getByText(/uploads from the browser are limited to 1 kB/)).toBeTruthy();
    expect(
      screen.getByText(
        `Ask the instance administrators to raise the upload limit, or to place the file in the import folder ${FOLDER_PATH}, then choose “Server import folder”.`,
      ),
    ).toBeTruthy();
    expect(api.requests.some((request) => request.path.includes("/import-uploads"))).toBe(false);
  });
});

describe("import report", () => {
  it("lets the importer discard only after typing the key", async () => {
    const api = setup(
      {
        [`GET /api/v1/imports/${IMPORT_ID}`]: () => ({ body: importView() }),
        [`GET /api/v1/imports/${IMPORT_ID}/report`]: () => ({
          body: { categories: [{ category: "macros", code: "unsupportedMacro", count: 1 }], total: 1 },
        }),
        [`GET /api/v1/imports/${IMPORT_ID}/report/macros`]: () => ({
          body: [{ name: "info", pages: 1, occurrences: 2 }],
        }),
        [`POST /api/v1/imports/${IMPORT_ID}/discard`]: () => ({ body: importView({ state: "discarding" }) }),
      },
      ["organization.imports.manage"],
    );
    await open(`/settings/organizations/${ORGANIZATION.id}/imports/${IMPORT_ID}`);
    expect(await screen.findByRole("button", { name: "Accept import" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Discard import" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Discard import" });
    await userEvent.type(within(dialog).getByLabelText("Type ITOPS to confirm"), "WRONG");
    await userEvent.click(confirm);
    expect(within(dialog).getByText("Type the key ITOPS exactly as shown.")).toBeTruthy();
    expect(api.requests.some((request) => request.path.endsWith("/discard"))).toBe(false);
    const field = within(dialog).getByLabelText("Type ITOPS to confirm");
    await userEvent.clear(field);
    await userEvent.type(field, "ITOPS");
    await userEvent.click(confirm);
    await waitFor(() =>
      expect(api.requests.find((request) => request.path.endsWith("/discard"))?.body).toEqual({
        confirmation: "ITOPS",
      }),
    );
  });

  it("shows reviewers the report without accept, discard or stop", async () => {
    setup(
      {
        [`GET /api/v1/imports/${IMPORT_ID}`]: () => ({
          body: importView({ canManage: false, canResolve: false }),
        }),
        [`GET /api/v1/imports/${IMPORT_ID}/report`]: () => ({ body: { categories: [], total: 0 } }),
        [`GET /api/v1/imports/${IMPORT_ID}/report/macros`]: () => ({ body: [] }),
      },
      [],
    );
    await open(`/settings/organizations/${ORGANIZATION.id}/imports/${IMPORT_ID}`);
    expect(await screen.findByText("Nothing needs attention")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept import" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Discard import" })).toBeNull();
  });
  it("names pages the viewer cannot read as restricted and keeps problems of the export apart", async () => {
    const entry = (id: string, item: { id: string; title: string } | null, restricted: boolean) => ({
      id,
      category: "attachments",
      code: "missingAttachment",
      item,
      restricted,
      details: { fileName: `${id}.png` },
    });
    setup(
      {
        [`GET /api/v1/imports/${IMPORT_ID}`]: () => ({ body: importView() }),
        [`GET /api/v1/imports/${IMPORT_ID}/report`]: () => ({
          body: { categories: [{ category: "attachments", code: "missingAttachment", count: 3 }], total: 3 },
        }),
        [`GET /api/v1/imports/${IMPORT_ID}/report/macros`]: () => ({ body: [] }),
        [`GET /api/v1/imports/${IMPORT_ID}/report/entries`]: () => ({
          body: {
            items: [
              entry("readable", { id: SPACE_ID, title: "Network overview" }, false),
              entry("hidden", null, true),
              entry("export", null, false),
            ],
            nextCursor: null,
          },
        }),
      },
      ["organization.imports.manage"],
    );
    await open(`/settings/organizations/${ORGANIZATION.id}/imports/${IMPORT_ID}?tab=attachments`);
    expect(await screen.findByText("Network overview")).toBeTruthy();
    expect(screen.getByText("A restricted page you cannot open")).toBeTruthy();
    expect(screen.getByText("The export as a whole")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Open page" })).toHaveLength(1);
  });
});

describe("uploads in parts", () => {
  it("send only missing parts, retry after a lost connection and complete with the checksum of all parts", async () => {
    const bytes = new Uint8Array(10).map((_, index) => index);
    const file = new File([bytes], "export.zip");
    const sent: string[] = [];
    let failures = 1;
    class FakeRequest {
      upload = { onprogress: null as ((event: { loaded: number }) => void) | null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      status = 0;
      responseText = "";
      withCredentials = false;
      #url = "";
      open(_method: string, url: string) {
        this.#url = url;
      }
      setRequestHeader() {}
      abort() {}
      send(body: Blob) {
        queueMicrotask(() => {
          if (failures > 0) {
            failures -= 1;
            this.onerror?.();
            return;
          }
          sent.push(this.#url);
          this.upload.onprogress?.({ loaded: body.size });
          this.status = 200;
          this.onload?.();
        });
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeRequest);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = mockApi({
      [`POST /api/v1/organizations/${ORGANIZATION.id}/import-uploads/u1/complete`]: () => ({
        body: {
          id: "u1",
          name: "export.zip",
          size: 10,
          partSize: 4,
          partCount: 3,
          parts: [],
          complete: true,
          expiresAt: "2026-10-17T08:00:00.000Z",
        },
      }),
    });
    const progress: number[] = [];
    await uploadParts({
      organizationId: ORGANIZATION.id,
      file,
      upload: {
        id: "u1",
        name: "export.zip",
        size: 10,
        partSize: 4,
        partCount: 3,
        parts: [{ number: 1, size: 4 }],
        complete: false,
      },
      signal: new AbortController().signal,
      onProgress: (value) => progress.push(value.sent),
    });
    vi.useRealTimers();
    expect(sent.map((url) => url.split("/parts/")[1]?.split("?")[0])).toEqual(["2", "3"]);
    const digests = await Promise.all(
      [bytes.slice(0, 4), bytes.slice(4, 8), bytes.slice(8)].map((part) => sha256Hex(part.buffer)),
    );
    expect(sent[0]).toContain(`sha256=${digests[1]}`);
    const complete = api.requests.find((request) => request.path.endsWith("/complete"));
    expect(complete?.body).toEqual({ sha256: await combinedSha256(digests) });
    expect(progress.at(-1)).toBe(10);
  });
});

const PLACEHOLDER = "01929b1e-0000-7000-8000-0000000000d1";
const JANA = "01929b1e-0000-7000-8000-0000000000d2";
const GROUP = "01929b1e-0000-7000-8000-0000000000d3";

function emptyReport(overrides: Record<string, unknown> = {}) {
  return {
    categories: [],
    total: 0,
    placeholders: 1,
    mapped: 0,
    permissionsToCheck: 1,
    groupsMissing: 1,
    ...overrides,
  };
}

describe("people in the import wizard", () => {
  const draft = (overrides: Record<string, unknown> = {}) =>
    importView({ state: "ready", draftStep: 1, quarantineSpace: null, ...overrides });

  it("checks the API token only when asked, shows field errors first and never shows the token again", async () => {
    let current = draft();
    const api = setup(
      {
        [`GET /api/v1/imports/${IMPORT_ID}`]: () => ({ body: current }),
        [`PATCH /api/v1/imports/${IMPORT_ID}`]: () => ({ body: current }),
        [`PUT /api/v1/imports/${IMPORT_ID}/people-source`]: () => {
          current = draft({
            peopleSource: {
              kind: "token",
              site: "example.atlassian.net",
              email: "olivia@example.org",
              people: 2,
              withEmail: 1,
            },
          });
          return { body: current };
        },
      },
      ["organization.imports.manage"],
    );
    await open(`/settings/organizations/${ORGANIZATION.id}/imports/${IMPORT_ID}/setup?step=1`);
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
    expect(
      await screen.findByText("Check and save the API token first, or choose another way."),
    ).toBeTruthy();
    const site = screen.getByLabelText("Confluence site");
    for (const field of [
      site,
      screen.getByLabelText("Your Atlassian e-mail address"),
      screen.getByLabelText("API token"),
    ]) {
      expect(field.getAttribute("aria-invalid")).toBe("true");
    }
    await waitFor(() => expect(document.activeElement).toBe(site));
    await userEvent.type(screen.getByLabelText("Confluence site"), "example.atlassian.net");
    await userEvent.type(screen.getByLabelText("Your Atlassian e-mail address"), "olivia@example.org");
    await userEvent.click(screen.getByRole("button", { name: "Check and save token" }));
    expect(await screen.findByText("Paste the API token.")).toBeTruthy();
    expect(api.requests.some((request) => request.path.endsWith("/people-source"))).toBe(false);
    await userEvent.type(screen.getByLabelText("API token"), "secret-token");
    await userEvent.click(screen.getByRole("button", { name: "Check and save token" }));
    expect(await screen.findByText("Connected to example.atlassian.net")).toBeTruthy();
    expect(screen.getByText("2 people of the export found, 1 with a visible e-mail address.")).toBeTruthy();
    expect(api.requests.find((request) => request.path.endsWith("/people-source"))?.body).toEqual({
      kind: "token",
      site: "example.atlassian.net",
      email: "olivia@example.org",
      token: "secret-token",
    });
    expect(screen.queryByDisplayValue("secret-token")).toBeNull();
  });

  it("skips people only after the confirmation", async () => {
    let current = draft();
    const api = setup(
      {
        [`GET /api/v1/imports/${IMPORT_ID}`]: () => ({ body: current }),
        [`PATCH /api/v1/imports/${IMPORT_ID}`]: () => ({ body: current }),
        [`PUT /api/v1/imports/${IMPORT_ID}/people-source`]: () => {
          current = draft({
            peopleSource: { kind: "skip", site: null, email: null, people: null, withEmail: null },
          });
          return { body: current };
        },
      },
      ["organization.imports.manage"],
    );
    await open(`/settings/organizations/${ORGANIZATION.id}/imports/${IMPORT_ID}/setup?step=1`);
    await userEvent.click(await screen.findByRole("radio", { name: /Skip for now/ }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findAllByText("Confirm that every author becomes a placeholder.")).toBeTruthy();
    const confirmation = screen.getByRole("checkbox", { name: /every author becomes a placeholder/ });
    expect(confirmation.getAttribute("aria-invalid")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(confirmation));
    await userEvent.click(confirmation);
    await waitFor(() =>
      expect(api.requests.find((request) => request.path.endsWith("/people-source"))?.body).toEqual({
        kind: "skip",
        confirmed: true,
      }),
    );
  });

  it("reads a user list as CSV", async () => {
    let current = draft();
    const api = setup(
      {
        [`GET /api/v1/imports/${IMPORT_ID}`]: () => ({ body: current }),
        [`PATCH /api/v1/imports/${IMPORT_ID}`]: () => ({ body: current }),
        [`PUT /api/v1/imports/${IMPORT_ID}/people-source/user-list`]: () => {
          current = draft({
            peopleSource: { kind: "list", site: null, email: null, people: 3, withEmail: 2 },
          });
          return { body: current };
        },
      },
      ["organization.imports.manage"],
    );
    await open(`/settings/organizations/${ORGANIZATION.id}/imports/${IMPORT_ID}/setup?step=1`);
    await userEvent.click(
      await screen.findByRole("radio", { name: /User list from the Atlassian administration/ }),
    );
    const file = new File(["User id,User name,email\na,Anna,anna@example.org"], "users.csv", {
      type: "text/csv",
    });
    await userEvent.upload(screen.getByLabelText(/Drop the user list here/), file);
    expect(await screen.findByText("3 people in the list, 2 with an e-mail address.")).toBeTruthy();
    const sent = api.requests.find((request) => request.path.endsWith("/people-source/user-list"));
    expect(sent?.body).toBe("User id,User name,email\na,Anna,anna@example.org");
    expect(sent?.headers.get("content-type")).toBe("text/csv");
  });
});

describe("people and permissions in the report", () => {
  function reportRoutes(extra: Record<string, () => { status?: number; body?: unknown }> = {}) {
    return {
      [`GET /api/v1/imports/${IMPORT_ID}`]: () => ({ body: importView() }),
      [`GET /api/v1/imports/${IMPORT_ID}/report`]: () => ({ body: emptyReport() }),
      [`GET /api/v1/imports/${IMPORT_ID}/report/macros`]: () => ({ body: [] }),
      [`GET /api/v1/imports/${IMPORT_ID}/people`]: () => ({
        body: {
          items: [
            {
              id: PLACEHOLDER,
              name: "J. Weber",
              externalId: "557058:4f1c",
              email: null,
              named: true,
              items: 14,
              comments: 31,
              restrictedPages: 2,
              spaceRole: "editor",
              mappedTo: null,
              candidates: [{ id: JANA, name: "Jana Weber" }],
            },
          ],
          total: 1,
          mapped: 0,
          nextCursor: null,
        },
      }),
      [`GET /api/v1/imports/${IMPORT_ID}/groups`]: () => ({
        body: [
          { key: "contractors", name: "contractors", group: null, spaceRole: "reader", restrictedPages: 1 },
        ],
      }),
      [`GET /api/v1/imports/${IMPORT_ID}/permissions`]: () => ({
        body: {
          items: [
            {
              id: "01929b1e-0000-7000-8000-0000000000e1",
              scope: "space",
              item: null,
              restriction: null,
              holder: { kind: "anonymous", id: null, name: null, sourceName: null },
              role: null,
              permissions: ["VIEWSPACE"],
              status: "notTaken",
              code: "anonymous",
            },
          ],
          nextCursor: null,
        },
      }),
      ...extra,
    };
  }

  it("lists placeholders, offers similar names for confirmation and maps the chosen ones together", async () => {
    const api = setup(
      reportRoutes({
        [`POST /api/v1/imports/${IMPORT_ID}/people/mappings`]: () => ({ body: { mapped: 1 } }),
      }),
      ["organization.imports.manage"],
    );
    await open(`/settings/organizations/${ORGANIZATION.id}/imports/${IMPORT_ID}?tab=people`);
    expect(await screen.findByText("J. Weber")).toBeTruthy();
    expect(screen.getByText("No e-mail address visible")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Choose Jana Weber" }));
    expect(screen.getByText("1 person chosen")).toBeTruthy();
    expect(api.requests.some((request) => request.path.endsWith("/mappings"))).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Map 1 person" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("J. Weber becomes Jana Weber")).toBeTruthy();
    expect(within(dialog).getByText(/also takes a place on restricted pages/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Map 1 person" }));
    await waitFor(() =>
      expect(api.requests.find((request) => request.path.endsWith("/mappings"))?.body).toEqual({
        mappings: [{ placeholderId: PLACEHOLDER, accountId: JANA }],
      }),
    );
  });

  it("lists unmatched groups with the choice to create a local group, after a confirmation", async () => {
    const api = setup(
      reportRoutes({
        [`PUT /api/v1/imports/${IMPORT_ID}/groups/contractors`]: () => ({
          body: {
            key: "contractors",
            name: "contractors",
            group: { id: GROUP, name: "contractors" },
            spaceRole: "reader",
            restrictedPages: 1,
          },
        }),
      }),
      ["organization.imports.manage"],
    );
    await open(`/settings/organizations/${ORGANIZATION.id}/imports/${IMPORT_ID}?tab=permissions`);
    expect(await screen.findByText("Anonymous visitors")).toBeTruthy();
    expect(screen.getByText("Public access is not available for this space.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Create group “contractors”" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/named on 1 restricted page at once/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Create group “contractors”" }));
    await waitFor(() =>
      expect(api.requests.find((request) => request.path.endsWith("/groups/contractors"))?.body).toEqual({
        create: true,
      }),
    );
  });

  it("shows reviewers the people without the means to map them", async () => {
    setup(
      {
        ...reportRoutes(),
        [`GET /api/v1/imports/${IMPORT_ID}`]: () => ({
          body: importView({ canManage: false, canResolve: false }),
        }),
      },
      [],
    );
    await open(`/settings/organizations/${ORGANIZATION.id}/imports/${IMPORT_ID}?tab=people`);
    expect(await screen.findByText("J. Weber")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Choose Jana Weber" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Upload user list" })).toBeNull();
  });

  it("lets another administrator map the people of an accepted import", async () => {
    setup(
      {
        ...reportRoutes(),
        [`GET /api/v1/imports/${IMPORT_ID}`]: () => ({
          body: importView({ state: "accepted", canManage: false, canResolve: true }),
        }),
      },
      [],
    );
    await open(`/settings/organizations/${ORGANIZATION.id}/imports/${IMPORT_ID}?tab=people`);
    expect(await screen.findByRole("button", { name: "Choose Jana Weber" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept import" })).toBeNull();
  });

  it("fills the accept dialog with the imported permissions instead of the defaults", async () => {
    const api = setup(
      reportRoutes({
        [`GET /api/v1/imports/${IMPORT_ID}/proposed-access`]: () => ({
          body: {
            visibility: "private",
            grants: [{ principalKind: "group", principalId: GROUP, role: "editor", name: "IT Admins" }],
            pending: 2,
          },
        }),
        [`POST /api/v1/imports/${IMPORT_ID}/accept`]: () => ({ body: importView({ state: "accepted" }) }),
      }),
      ["organization.imports.manage"],
    );
    await open(`/settings/organizations/${ORGANIZATION.id}/imports/${IMPORT_ID}`);
    await userEvent.click(await screen.findByRole("button", { name: "Accept import" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/2 imported roles wait/)).toBeTruthy();
    expect(within(dialog).getAllByText(/IT Admins/).length).toBeGreaterThan(0);
    await userEvent.click(within(dialog).getByRole("button", { name: "Accept import" }));
    await waitFor(() => {
      const body = api.requests.find((request) => request.path.endsWith("/accept"))?.body as {
        visibility: string;
        grants: unknown[];
      };
      expect(body.visibility).toBe("private");
      expect(body.grants).toContainEqual({ principalKind: "group", principalId: GROUP, role: "editor" });
    });
  });
});

describe("new import sources in the wizard", () => {
  const draft = (overrides: Record<string, unknown> = {}) =>
    importView({
      state: "draft",
      draftStep: 1,
      quarantineSpace: null,
      found: null,
      file: null,
      ...overrides,
    });

  it("tests the Confluence Cloud connection only when asked and never shows the token again", async () => {
    let current = draft({ source: "confluence-cloud" });
    const api = setup(
      {
        [`GET /api/v1/imports/${IMPORT_ID}`]: () => ({ body: current }),
        [`PATCH /api/v1/imports/${IMPORT_ID}`]: () => ({ body: current }),
        [`PUT /api/v1/imports/${IMPORT_ID}/connection`]: () => {
          current = draft({
            source: "confluence-cloud",
            connection: {
              kind: "cloud",
              site: "example.atlassian.net",
              basePath: "",
              email: "olivia@example.org",
              account: "Olivia Owner",
              selection: [],
            },
            peopleSource: {
              kind: "token",
              site: "example.atlassian.net",
              email: null,
              people: null,
              withEmail: null,
            },
          });
          return { body: current };
        },
      },
      ["organization.imports.manage"],
    );
    await open(`/settings/organizations/${ORGANIZATION.id}/imports/${IMPORT_ID}/setup?step=1`);
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Test the connection first, then continue.")).toBeTruthy();
    const site = screen.getByLabelText("Site address");
    await waitFor(() => expect(site.getAttribute("aria-invalid")).toBe("true"));
    await userEvent.type(site, "example.atlassian.net");
    await userEvent.type(screen.getByLabelText("Your Atlassian e-mail address"), "olivia@example.org");
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("Paste the token exactly as Confluence showed it.")).toBeTruthy();
    expect(api.requests.some((request) => request.path.endsWith("/connection"))).toBe(false);
    await userEvent.type(screen.getByLabelText("API token"), "secret-token");
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("Connected to example.atlassian.net")).toBeTruthy();
    expect(api.requests.find((request) => request.path.endsWith("/connection"))?.body).toEqual({
      kind: "cloud",
      site: "example.atlassian.net",
      email: "olivia@example.org",
      token: "secret-token",
    });
    expect(screen.queryByDisplayValue("secret-token")).toBeNull();
  });

  it("lets people choose spaces and page trees and saves the selection when continuing", async () => {
    const connection = {
      kind: "cloud",
      site: "example.atlassian.net",
      basePath: "",
      email: "olivia@example.org",
      account: "Olivia Owner",
      selection: [] as { importId: string; spaceKey: string }[],
    };
    let current: Record<string, unknown> = draft({ source: "confluence-cloud", draftStep: 2, connection });
    const api = setup(
      {
        [`GET /api/v1/imports/${IMPORT_ID}`]: () => ({ body: current }),
        [`PUT /api/v1/imports/${IMPORT_ID}/connection/selection`]: () => {
          const body = api.requests.at(-1)?.body as { spaceKeys: string[] };
          current = {
            ...current,
            options: { spaceKey: body.spaceKeys[0] },
            connection: {
              ...connection,
              selection: body.spaceKeys.map((spaceKey, index) => ({
                importId: index === 0 ? IMPORT_ID : `0190a7c0-0000-7000-8000-00000000000${index}`,
                spaceKey,
              })),
            },
          };
          return { body: current };
        },
        [`PATCH /api/v1/imports/${IMPORT_ID}`]: () => {
          const body = (api.requests.at(-1)?.body ?? {}) as { options?: Record<string, unknown> };
          if (body.options) current = { ...current, options: body.options, state: "analyzing" };
          return { body: current };
        },
        [`GET /api/v1/imports/${IMPORT_ID}/connection/spaces`]: () => ({
          body: [
            { id: "1", key: "ITOPS", name: "IT Operations", personal: false },
            { id: "2", key: "SALES", name: "Sales", personal: false },
          ],
        }),
        [`GET /api/v1/imports/${IMPORT_ID}/connection/spaces/ITOPS`]: () => ({
          body: {
            spaceKey: "ITOPS",
            spaceName: "IT Operations",
            pages: 130,
            blogPosts: 4,
            attachmentBytes: 2048,
            complete: true,
            trees: [
              { id: "11", title: "Network", pages: 86, attachmentBytes: 1024 },
              { id: "12", title: "Onboarding", pages: 41, attachmentBytes: 1024 },
            ],
          },
        }),
      },
      ["organization.imports.manage"],
    );
    await open(`/settings/organizations/${ORGANIZATION.id}/imports/${IMPORT_ID}/setup?step=2`);
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
    const required = await screen.findByText("Choose at least one space to import.");
    await waitFor(() => expect(document.activeElement).toBe(required.closest("[data-field-error]")));
    await userEvent.click(screen.getByRole("checkbox", { name: /IT Operations/ }));
    const onboarding = await screen.findByRole("checkbox", { name: "Onboarding" });
    await userEvent.click(onboarding);
    await userEvent.click(screen.getByRole("checkbox", { name: /Sales/ }));
    expect(screen.getByText("2 imports, one per space")).toBeTruthy();
    expect(screen.getByText("Page trees of IT Operations")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Onboarding" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(
        api.requests.some(
          (request) =>
            request.method === "PATCH" &&
            JSON.stringify(request.body).includes('"pageIds":["11"]') &&
            JSON.stringify(request.body).includes('"spaceKey":"ITOPS"'),
        ),
      ).toBe(true),
    );
    const selections = api.requests.filter((request) => request.path.endsWith("/connection/selection"));
    expect(selections.map((request) => request.body)).toEqual([{ spaceKeys: ["ITOPS", "SALES"] }]);
    const order = api.requests.map((request) => request.method);
    expect(order.indexOf("PUT")).toBeLessThan(order.lastIndexOf("PATCH"));
  });

  it("refuses Word documents with macros before uploading anything", async () => {
    const current = draft({ source: "word", draftStep: 1 });
    const api = setup(
      {
        [`GET /api/v1/imports/${IMPORT_ID}`]: () => ({ body: current }),
        [`PATCH /api/v1/imports/${IMPORT_ID}`]: () => ({ body: current }),
      },
      ["organization.imports.manage"],
    );
    await open(`/settings/organizations/${ORGANIZATION.id}/imports/${IMPORT_ID}/setup?step=1`);
    const input = await screen.findByLabelText(/Drop .docx files here/);
    await userEvent.upload(input, new File(["macro"], "macros.docm"), { applyAccept: false });
    expect(await screen.findByText("macros.docm was not added")).toBeTruthy();
    expect(api.requests.some((request) => request.path.endsWith("/import-uploads"))).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      await screen.findByText("Add at least one Word document and wait until every upload is finished."),
    ).toBeTruthy();
  });

  it("shows when Confluence asked to slow down while reading", async () => {
    const current = draft({
      source: "confluence-cloud",
      draftStep: 4,
      state: "analyzing",
      throttledUntil: new Date(Date.now() + 30_000).toISOString(),
      connection: {
        kind: "cloud",
        site: "example.atlassian.net",
        basePath: "",
        email: "olivia@example.org",
        account: null,
        selection: [],
      },
    });
    setup({ [`GET /api/v1/imports/${IMPORT_ID}`]: () => ({ body: current }) }, [
      "organization.imports.manage",
    ]);
    await open(`/settings/organizations/${ORGANIZATION.id}/imports/${IMPORT_ID}/setup?step=4`);
    expect(await screen.findByText("Confluence asked to slow down")).toBeTruthy();
  });

  it("says which import goes first when imports share a connection", async () => {
    const current = draft({
      source: "confluence-cloud",
      draftStep: 4,
      state: "analyzing",
      waitingFor: "ITOPS",
      connection: {
        kind: "cloud",
        site: "example.atlassian.net",
        basePath: "",
        email: "olivia@example.org",
        account: null,
        selection: [],
      },
    });
    setup({ [`GET /api/v1/imports/${IMPORT_ID}`]: () => ({ body: current }) }, [
      "organization.imports.manage",
    ]);
    await open(`/settings/organizations/${ORGANIZATION.id}/imports/${IMPORT_ID}/setup?step=4`);
    expect(await screen.findByText("Waiting for the import of another space")).toBeTruthy();
    expect(screen.getByText(/with the import of space ITOPS, which goes first/)).toBeTruthy();
  });
});
