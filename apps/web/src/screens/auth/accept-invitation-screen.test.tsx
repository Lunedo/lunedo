import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "../../app.js";
import { initI18n } from "../../i18n/index.js";
import { mockApi } from "../../testing/render.js";

const TOKEN = "t".repeat(43);

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
  sessionStorage.clear();
});

function api(preview: () => { status?: number; body?: unknown }) {
  return mockApi({
    "GET /api/v1/instance/info": () => ({
      body: {
        name: "Pagehall",
        setupComplete: true,
        language: "en",
        accentColor: "petrol",
        passwordMinLength: 12,
        selfRegistration: false,
        organization: null,
      },
    }),
    "GET /api/v1/auth/session": () => ({
      status: 401,
      body: {
        type: "urn:pagehall:problem:notSignedIn",
        title: "Not signed in",
        status: 401,
        code: "notSignedIn",
      },
    }),
    "POST /api/v1/invitations/preview": preview,
  });
}

async function open(path: string) {
  window.history.replaceState(null, "", path);
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
}

const OPEN = {
  state: "open",
  email: "lena@example.org",
  expiresAt: "2030-01-01T00:00:00.000Z",
  organizationName: "Engineering",
  invitedByName: "Olivia Owner",
};

describe("accepting an invitation", () => {
  it("names the organization and the person who invited, also after a reload", async () => {
    const { requests } = api(() => ({ body: OPEN }));
    await open(`/accept-invitation#token=${TOKEN}`);
    expect(await screen.findByRole("heading", { name: "Join Engineering" })).toBeTruthy();
    expect(
      screen.getByText(
        "Olivia Owner invited you (lena@example.org) to work together in Engineering on Pagehall.",
      ),
    ).toBeTruthy();
    expect(window.location.hash).toBe("");

    cleanup();
    await open("/accept-invitation");
    expect(await screen.findByRole("heading", { name: "Join Engineering" })).toBeTruthy();
    expect(
      requests.filter((request) => request.path === "/api/v1/invitations/preview").map((r) => r.body),
    ).toEqual([{ token: TOKEN }, { token: TOKEN }]);
  });

  it("says that an invitation expired and whom to ask", async () => {
    api(() => ({ body: { ...OPEN, state: "expired" } }));
    await open(`/accept-invitation#token=${TOKEN}`);
    expect(
      await screen.findByText(
        "The invitation to Engineering has expired. Ask Olivia Owner for a new invitation.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept invitation" })).toBeNull();
  });

  it("says that a link is not valid", async () => {
    api(() => ({
      status: 400,
      body: {
        type: "urn:pagehall:problem:invalidToken",
        title: "Invalid",
        status: 400,
        code: "invalidToken",
      },
    }));
    await open(`/accept-invitation#token=${TOKEN}`);
    expect(await screen.findByText(/This invitation link is not valid/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
  });
});
