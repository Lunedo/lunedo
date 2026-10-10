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
    sourceUrl: null,
    reviewers: [{ id: "01929b1e-0000-7000-8000-0000000000c4", name: "Lukas Hofer" }],
    phase: null,
    progress: { done: 0, total: 0 },
    found: {
      pages: 12,
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
        [`GET /api/v1/imports/${IMPORT_ID}`]: () => ({ body: importView({ canManage: false }) }),
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
