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
const NAME = "pagehall-backup-20261021T000000Z-manual-0a1b2c3d.phbak";

type Handler = (request: RecordedRequest) => { status?: number; body?: unknown };

function overview(overrides: Record<string, unknown> = {}) {
  return {
    settings: {
      enabled: true,
      dailyTime: "02:00",
      weeklyDay: 7,
      monthlyDay: 1,
      retention: { daily: 7, weekly: 4, monthly: 6, beforeUpdate: 3 },
      scope: "all",
      beforeUpdate: true,
      missingDays: 2,
      autoTestRestore: true,
    },
    target: { kind: "local", path: "/var/lib/pagehall/backups", sameVolumeAsFiles: true },
    timeZone: "Europe/Vienna",
    nextRunAt: "2026-10-22T00:00:00.000Z",
    beforeUpdate: { enabled: true, disabledBy: null },
    keyConfirmed: null,
    running: false,
    testRestoreRunning: false,
    alert: "none",
    warning: null,
    lastSuccess: null,
    lastFailure: null,
    runs: [],
    ...overrides,
  };
}

function files() {
  return {
    available: true,
    error: null,
    backups: [
      {
        name: NAME,
        backupClass: "manual",
        createdAt: "2026-10-21T00:00:00.000Z",
        sizeBytes: 10 * 1024 * 1024,
        readable: true,
        pagehallVersion: "1.0.0",
        schemaVersion: "0094_backup_schedules",
        scope: "all",
        testRestore: {
          id: "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7d",
          trigger: "manual",
          state: "verified",
          stage: "done",
          checks: [
            { check: "verify", passed: true, detail: { entries: 3 } },
            { check: "privilege", passed: false, detail: { grant: 'ALTER ROLE "pagehall" CREATEDB;' } },
          ],
          error: null,
          actor: { id: OLIVIA.id, name: OLIVIA.name },
          startedAt: "2026-10-21T01:00:00.000Z",
          finishedAt: "2026-10-21T01:01:00.000Z",
        },
      },
    ],
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

function api(
  overrides: Record<string, Handler> = {},
  permissions = ["instance.operations.view", "instance.operations.manage", "instance.settings.view"],
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
    "GET /api/v1/organizations": () => ({ body: { items: [], nextCursor: null } }),
    "GET /api/v1/account/permissions": () => ({
      body: { instance: permissions, organization: [], grantableAreas: { instance: {}, organization: {} } },
    }),
    "GET /api/v1/account/preferences": () => ({ body: [] }),
    "GET /api/v1/notifications/unread-count": () => ({ body: { count: 0 } }),
    "GET /api/v1/instance/storage": () => ({ body: { level: 0 } }),
    "GET /api/v1/instance/backups": () => ({ body: overview() }),
    "GET /api/v1/instance/backups/files": () => ({ body: files() }),
    ...overrides,
  });
}

async function renderAt(path: string) {
  window.history.replaceState(null, "", path);
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
}

describe("the backup settings", () => {
  it("shows the schedule, the key warning and warns about a target on the file store volume", async () => {
    api();
    await renderAt("/settings/instance/backups");
    expect(await screen.findByText("A backup cannot be restored without this key")).toBeTruthy();
    expect(screen.getByText("On the same disk as the file store")).toBeTruthy();
    expect(screen.getByText("In the time zone of the instance: Europe/Vienna.")).toBeTruthy();
    expect((screen.getByLabelText("Time") as HTMLInputElement).value).toBe("02:00");
    expect(screen.getByRole("button", { name: "Back up now" })).toBeTruthy();
    expect(await screen.findByRole("heading", { name: "Manual backups" })).toBeTruthy();
  });

  it("starts a backup and says that it runs", async () => {
    const mocked = api({ "POST /api/v1/instance/backups/runs": () => ({ status: 202 }) });
    await renderAt("/settings/instance/backups");
    await userEvent.click(await screen.findByRole("button", { name: "Back up now" }));
    expect(
      await screen.findByText("The backup has started. It appears in the list when it is done."),
    ).toBeTruthy();
    expect(
      mocked.requests.some((request) => request.method === "POST" && request.path.endsWith("/runs")),
    ).toBe(true);
  });

  it("saves an S3 target with explicit Save and shows the refused field", async () => {
    const mocked = api({
      "PUT /api/v1/instance/backups/target": () =>
        problem(400, "invalidBackupSettings", { problem: "invalidBucket", fields: ["body.bucket"] }),
    });
    await renderAt("/settings/instance/backups");
    await userEvent.click(await screen.findByRole("radio", { name: /S3-compatible storage/ }));
    await userEvent.type(screen.getByLabelText("Region"), "eu-central-1");
    await userEvent.type(screen.getByLabelText("Bucket"), "backups");
    await userEvent.type(screen.getByLabelText("Access key"), "AKIAEXAMPLE");
    await userEvent.click(screen.getByRole("button", { name: "Save target" }));
    expect(await screen.findByText("Enter the secret key.")).toBeTruthy();
    expect(mocked.requests.some((request) => request.method === "PUT")).toBe(false);
    await userEvent.type(screen.getByLabelText("Secret key"), "very secret");
    await userEvent.click(screen.getByRole("button", { name: "Save target" }));
    expect(
      await screen.findByText(
        "Enter the bucket name: 3 to 63 lowercase letters, digits, dots, hyphens or underscores.",
      ),
    ).toBeTruthy();
    const put = mocked.requests.find((request) => request.method === "PUT");
    expect(put?.body).toMatchObject({ kind: "s3", bucket: "backups", secretAccessKey: "very secret" });
  });

  it("names the failed step of the connection test", async () => {
    api({
      "POST /api/v1/instance/backups/target/test": () => ({
        body: { ok: false, failure: "notFound", step: "write", message: "x" },
      }),
    });
    await renderAt("/settings/instance/backups");
    await userEvent.click(await screen.findByRole("button", { name: "Test connection" }));
    expect(
      await screen.findByText(
        "Writing failed: the directory does not exist in the container. Create it or mount the volume there.",
      ),
    ).toBeTruthy();
  });

  it("deletes a backup only after its name was typed", async () => {
    const mocked = api({ [`DELETE /api/v1/instance/backups/files/${NAME}`]: () => ({ status: 204 }) });
    await renderAt("/settings/instance/backups");
    await userEvent.click(await screen.findByRole("button", { name: `Actions for ${NAME}` }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete backup" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete backup" }));
    expect(mocked.requests.some((request) => request.method === "DELETE")).toBe(false);
    await userEvent.type(within(dialog).getByRole("textbox"), NAME);
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete backup" }));
    await waitFor(() => expect(mocked.requests.some((request) => request.method === "DELETE")).toBe(true));
  });

  it("shows how to grant the privilege a full test restore needs", async () => {
    api();
    await renderAt("/settings/instance/backups");
    await userEvent.click(await screen.findByRole("button", { name: `Actions for ${NAME}` }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Show test restore result" }));
    expect(await screen.findByText('ALTER ROLE "pagehall" CREATEDB;')).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy SQL" })).toBeTruthy();
  });

  it("warns on every settings page while backups have no target", async () => {
    api({
      "GET /api/v1/instance/backups": () => ({ body: overview({ target: null, warning: "noTarget" }) }),
    });
    await renderAt("/settings/instance/storage");
    expect(await screen.findByText("Backups are not set up")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the backup settings" })).toBeTruthy();
  });
});
