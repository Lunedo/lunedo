import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

const OFF = {
  enabled: false,
  message: "",
  blockSignIn: false,
  startedAt: null,
  changedAt: null,
  changedBy: null,
};

function api(options: { permissions?: string[]; details?: Record<string, unknown> } = {}) {
  let details: Record<string, unknown> = { ...OFF, ...options.details };
  const recorded = mockApi({
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
        instance: options.permissions ?? ["instance.operations.view", "instance.operations.manage"],
        organization: [],
        grantableAreas: { instance: {}, organization: {} },
      },
    }),
    "GET /api/v1/account/preferences": () => ({ body: [] }),
    "GET /api/v1/notifications/unread-count": () => ({ body: { count: 0 } }),
    "GET /api/v1/maintenance": () => ({
      body: {
        enabled: details.enabled,
        message: details.message,
        blockSignIn: details.blockSignIn,
        startedAt: details.startedAt,
      },
    }),
    "GET /api/v1/instance/maintenance": () => ({ body: details }),
    "PUT /api/v1/instance/maintenance": (request) => {
      const body = request.body as { enabled: boolean; message?: string; blockSignIn?: boolean };
      const now = new Date().toISOString();
      details = body.enabled
        ? {
            enabled: true,
            message: body.message ?? "",
            blockSignIn: body.blockSignIn ?? false,
            startedAt: details.startedAt ?? now,
            changedAt: now,
            changedBy: { id: OLIVIA.id, name: OLIVIA.name },
          }
        : { ...OFF, changedAt: now, changedBy: { id: OLIVIA.id, name: OLIVIA.name } };
      return { body: details };
    },
  });
  return recorded;
}

async function renderScreen() {
  window.history.replaceState(null, "", "/settings/instance/maintenance");
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
}

describe("the maintenance mode screen", () => {
  it("switches maintenance on with a message, shows the banner and switches it off again", async () => {
    const { requests } = api();
    await renderScreen();
    expect(await screen.findByText("Everyone can make changes.")).toBeTruthy();
    expect(screen.queryByText("Maintenance in progress")).toBeNull();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Message" }), "Update until 18:00");
    await user.click(screen.getByRole("checkbox", { name: /Pause signing in/ }));
    await user.click(screen.getByRole("button", { name: "Switch on maintenance mode" }));

    await waitFor(() =>
      expect(requests.find((request) => request.method === "PUT")?.body).toEqual({
        enabled: true,
        message: "Update until 18:00",
        blockSignIn: true,
      }),
    );
    expect(await screen.findByText("Maintenance mode is on")).toBeTruthy();
    expect(await screen.findByText("Maintenance in progress")).toBeTruthy();
    const banner = screen.getByText("Maintenance in progress").closest("[role=status]");
    expect(banner?.textContent).toContain("From the administrators: Update until 18:00");
    expect(
      screen.getAllByText(/Signing in is paused for everyone except instance administrators/).length,
    ).toBe(2);

    await user.click(screen.getByRole("button", { name: "Switch off maintenance mode" }));
    expect(await screen.findByText("Maintenance mode is off")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Maintenance in progress")).toBeNull());
  });

  it("checks the length of the message on click and moves focus to it", async () => {
    const { requests } = api();
    await renderScreen();
    const field = await screen.findByRole("textbox", { name: "Message" });
    const user = userEvent.setup();
    await user.click(field);
    await user.paste("x".repeat(501));
    await user.click(screen.getByRole("button", { name: "Switch on maintenance mode" }));
    expect(
      await screen.findByText("The message has 501 characters. Shorten it to at most 500."),
    ).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(requests.some((request) => request.method === "PUT")).toBe(false);
  });

  it("shows the state without the form to people who may only view it", async () => {
    api({
      permissions: ["instance.operations.view"],
      details: {
        enabled: true,
        message: "Migration",
        startedAt: new Date().toISOString(),
        changedAt: new Date().toISOString(),
        changedBy: { id: OLIVIA.id, name: OLIVIA.name },
      },
    });
    await renderScreen();
    expect(await screen.findByText(/switched by Olivia Owner/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Switch off maintenance mode" })).toBeNull();
  });
});
