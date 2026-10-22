import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "../../app.js";
import { initI18n } from "../../i18n/index.js";
import { mockApi, type RecordedRequest } from "../../testing/render.js";

const OLIVIA = {
  id: "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c",
  email: "olivia@example.org",
  name: "Olivia Owner",
};

type Handler = (request: RecordedRequest) => { status?: number; body?: unknown };

const EMPTY = {
  reason: null,
  url: null,
  checkedAt: null,
  version: null,
  browser: null,
  concurrency: null,
  running: null,
  waiting: null,
  maxBytes: null,
  timeoutSeconds: null,
};

function rendering(pdf: Record<string, unknown>) {
  return { pdf: { ...EMPTY, ...pdf }, word: { available: true } };
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

function api(status: unknown, overrides: Record<string, Handler> = {}) {
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
      body: {
        instance: ["instance.settings.view"],
        organization: [],
        grantableAreas: { instance: {}, organization: {} },
      },
    }),
    "GET /api/v1/account/preferences": () => ({ body: [] }),
    "GET /api/v1/notifications/unread-count": () => ({ body: { count: 0 } }),
    "GET /api/v1/instance/rendering": () => ({ body: status }),
    ...overrides,
  });
}

async function renderScreen() {
  window.history.replaceState(null, "", "/settings/instance/rendering");
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
}

describe("the rendering settings", () => {
  it("explains that browser printing works without the render container and how to add it", async () => {
    api(rendering({ state: "notConfigured" }));
    await renderScreen();
    expect(await screen.findByText("Not configured")).toBeTruthy();
    expect(screen.getByText("Interactive export works without it.")).toBeTruthy();
    expect(screen.getByText(/LUNEDO_RENDER_URL: http:\/\/lunedo-render:3000/)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "How to set up the render container" }).getAttribute("href"),
    ).toContain("docs/rendering.md");
    expect(screen.getByText("Created by Lunedo itself. Always available.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
  });

  it("shows a healthy container with its version, browser and jobs, and checks it again", async () => {
    const { requests } = api(
      rendering({
        state: "healthy",
        url: "http://lunedo-render:3000",
        checkedAt: new Date().toISOString(),
        version: "1.0.2",
        browser: "Chromium 140.0.7339.80",
        concurrency: 2,
        running: 1,
        waiting: 3,
        maxBytes: 200 * 1024 * 1024,
        timeoutSeconds: 300,
      }),
    );
    await renderScreen();
    expect(await screen.findByText("Healthy")).toBeTruthy();
    expect(screen.getByText("http://lunedo-render:3000")).toBeTruthy();
    expect(screen.getByText("1.0.2")).toBeTruthy();
    expect(screen.getByText("Chromium 140.0.7339.80")).toBeTruthy();
    expect(screen.getByText("1 rendering, 3 waiting")).toBeTruthy();
    expect(screen.getByText("200 MB · 300 seconds")).toBeTruthy();
    const before = requests.filter((request) => request.path === "/api/v1/instance/rendering").length;
    await userEvent.setup().click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() =>
      expect(
        requests.filter((request) => request.path === "/api/v1/instance/rendering").length,
      ).toBeGreaterThan(before),
    );
  });

  it("says what to fix when the container refuses the token", async () => {
    api(
      rendering({
        state: "unreachable",
        reason: "token",
        url: "http://lunedo-render:3000",
        checkedAt: new Date().toISOString(),
      }),
    );
    await renderScreen();
    expect(await screen.findAllByText("Unreachable")).toHaveLength(2);
    expect(
      screen.getByText(/Set the same token in LUNEDO_RENDER_TOKEN of Lunedo and RENDER_TOKEN/),
    ).toBeTruthy();
  });
});
