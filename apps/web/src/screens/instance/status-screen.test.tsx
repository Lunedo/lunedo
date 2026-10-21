import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "../../app.js";
import { initI18n } from "../../i18n/index.js";
import { mockApi } from "../../testing/render.js";

const OLIVIA = {
  id: "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c",
  email: "olivia@example.org",
  name: "Olivia Owner",
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

const now = new Date().toISOString();

function item(
  id: string,
  status: string,
  reason: string | null,
  facts: Record<string, unknown> = {},
  page: string | null = null,
) {
  return { id, status, reason, facts, page, docs: `operations.md#${id}` };
}

function api(status: unknown, permissions = ["instance.operations.view", "instance.settings.view"]) {
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
    "GET /api/v1/instance/operations/status": () => ({ body: status }),
  });
}

async function renderScreen() {
  window.history.replaceState(null, "", "/settings/instance/status");
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
}

describe("the system status", () => {
  it("shows each check with its status, the reason and where it is fixed", async () => {
    api({
      checkedAt: now,
      status: "error",
      items: [
        item("version", "ok", null, { version: "1.4.2" }),
        item(
          "storage",
          "warning",
          "warning",
          { store: "local", usedBytes: 86 * 1024 ** 3, totalBytes: 100 * 1024 ** 3, percent: 86, level: 1 },
          "/settings/instance/storage",
        ),
        item("collaboration", "error", "unavailable"),
        item("fileStorage", "error", "notWritable", {
          path: "/var/lib/pagehall/files",
          freeBytes: null,
          fixCommand: "chown -R 1000:1000 /var/lib/pagehall/files",
        }),
        item("futureCheck", "warning", "somethingNew"),
      ],
      queues: [{ queue: "copies.run", queued: 0, active: 0, deferred: 0, failed: 2 }],
      recentErrors: [{ type: "Copy failed", code: null, services: ["worker"], count: 3, lastAt: now }],
    });
    await renderScreen();
    expect(await screen.findByRole("heading", { name: "System status" })).toBeTruthy();
    expect(await screen.findByText("Some checks failed")).toBeTruthy();
    expect(screen.getByText("2 errors and 2 warnings. Each check below says what to do.")).toBeTruthy();
    expect(screen.getByText("Pagehall 1.4.2")).toBeTruthy();
    expect(
      screen.getByText(
        "86% of the file store is used. Free space or enlarge the volume before writes are paused.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open settings" }).getAttribute("href")).toBe(
      "/settings/instance/storage",
    );
    expect(screen.getByText(/The collaboration server does not answer/)).toBeTruthy();
    expect(screen.getByText("chown -R 1000:1000 /var/lib/pagehall/files")).toBeTruthy();
    expect(screen.getByText("Check futureCheck")).toBeTruthy();
    const queues = screen.getByRole("table", { name: "Job queues" });
    expect(within(queues).getByText("copies.run")).toBeTruthy();
    const errors = screen.getByRole("table", { name: "Recent errors" });
    expect(within(errors).getByText("Copy failed")).toBeTruthy();
    expect(within(errors).getByText("worker")).toBeTruthy();
  });

  it("says when everything works", async () => {
    api({
      checkedAt: now,
      status: "ok",
      items: [item("recentErrors", "ok", null, { count: 0, types: 0, hours: 24 })],
      queues: [],
      recentErrors: [],
    });
    await renderScreen();
    expect(await screen.findByText("Everything is working")).toBeTruthy();
    expect(screen.getByText("No errors in the last 24 hours.")).toBeTruthy();
    expect(screen.getByText("No jobs are waiting, running or failed.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Open settings" })).toBeNull();
  });
});
