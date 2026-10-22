import { render, screen } from "@testing-library/react";
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

const CHECK = {
  enabled: true,
  disabledBy: null,
  url: "https://github.com/pagehall/pagehall/releases/latest/download/pagehall-versions.json",
  checkedAt: new Date().toISOString(),
  succeeded: true,
  failure: null,
};

const NOTES = { new: [], improved: [], fixed: [], breaking: [], manualSteps: [] };

function updates(overrides: Record<string, unknown> = {}) {
  return {
    running: "1.4.2",
    runningIsRelease: true,
    check: CHECK,
    latest: null,
    available: [],
    commands: null,
    whatsNew: {
      available: true,
      version: "1.4.2",
      date: "2026-10-01",
      notes: { ...NOTES, fixed: ["Uploads through Nginx."] },
    },
    ...overrides,
  };
}

function api(
  body: unknown,
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
    "GET /api/v1/maintenance": () => ({
      body: { enabled: false, message: "", blockSignIn: false, startedAt: null },
    }),
    "GET /api/v1/instance/settings": () => ({ body: { items: [], nextCursor: null } }),
    "GET /api/v1/instance/updates": () => ({ body }),
    "POST /api/v1/instance/updates/check": () => ({ body }),
  });
}

async function renderScreen() {
  window.history.replaceState(null, "", "/settings/instance/updates");
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
}

describe("the updates screen", () => {
  it("shows the available release with its breaking changes and the commands for this installation", async () => {
    api(
      updates({
        latest: "1.5.0",
        available: [
          {
            version: "1.5.0",
            date: "2026-11-02",
            minimumUpdateFrom: "1.3.0",
            url: "https://github.com/pagehall/pagehall/releases/tag/v1.5.0",
            notes: { ...NOTES, new: ["Maintenance mode."], breaking: ["<b>The metrics port moved.</b>"] },
          },
        ],
        commands: {
          method: "script",
          steps: [
            { kind: "command", text: "cd /opt/pagehall" },
            { kind: "command", text: "./pagehall update 1.5.0" },
          ],
        },
      }),
    );
    await renderScreen();
    expect(await screen.findByText("Pagehall 1.5.0 is available")).toBeTruthy();
    expect(screen.getByText("./pagehall update 1.5.0")).toBeTruthy();
    expect(screen.getByText("Breaking changes: read before you update")).toBeTruthy();
    expect(screen.getByText("<b>The metrics port moved.</b>")).toBeTruthy();
    expect(screen.getByText("Update to it from 1.3.0 or later.")).toBeTruthy();
    expect(screen.getByText("Uploads through Nginx.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check now" })).toBeTruthy();
  });

  it("says when the configuration turns the check off and still shows what is new", async () => {
    api(updates({ check: { ...CHECK, enabled: false, disabledBy: "environment", checkedAt: null } }));
    await renderScreen();
    expect(await screen.findByText("Turned off by the configuration")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Check now" })).toBeNull();
    expect(screen.getByText("Uploads through Nginx.")).toBeTruthy();
  });

  it("names why the last check failed", async () => {
    api(updates({ check: { ...CHECK, succeeded: false, failure: "httpStatus" } }));
    await renderScreen();
    expect(await screen.findByText("Update check failed")).toBeTruthy();
    expect(screen.getByText(/The server answered with an error/)).toBeTruthy();
  });
});
