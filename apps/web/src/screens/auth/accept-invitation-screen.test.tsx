import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
        name: "Lunedo",
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
        type: "urn:lunedo:problem:notSignedIn",
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
  knowledgeBaseName: null,
  newAccount: false,
};

describe("accepting an invitation", () => {
  it("names the organization and the person who invited, also after a reload", async () => {
    const { requests } = api(() => ({ body: OPEN }));
    await open(`/accept-invitation#token=${TOKEN}`);
    expect(await screen.findByRole("heading", { name: "Join Engineering" })).toBeTruthy();
    expect(
      screen.getByText(
        "Olivia Owner invited you (lena@example.org) to work together in Engineering on Lunedo.",
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
        type: "urn:lunedo:problem:invalidToken",
        title: "Invalid",
        status: 400,
        code: "invalidToken",
      },
    }));
    await open(`/accept-invitation#token=${TOKEN}`);
    expect(await screen.findByText(/This invitation link is not valid/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeTruthy();
  });

  it("invites a reader to a help portal and leads to it after the account is created", async () => {
    mockApi({
      "GET /api/v1/instance/info": () => ({
        body: {
          name: "Lunedo",
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
          type: "urn:lunedo:problem:notSignedIn",
          title: "Not signed in",
          status: 401,
          code: "notSignedIn",
        },
      }),
      "POST /api/v1/invitations/preview": () => ({ body: { ...OPEN, knowledgeBaseName: "Kundenhilfe" } }),
      "POST /api/v1/invitations/accept": () => ({
        body: {
          accountId: "01929b1e-0000-7000-8000-0000000000a1",
          organizationId: "01929b1e-0000-7000-8000-0000000000a2",
          accountCreated: true,
          portalUrl: "https://help.example.org/",
        },
      }),
    });
    await open(`/accept-invitation#token=${TOKEN}`);
    expect(await screen.findByRole("heading", { name: "Read Kundenhilfe" })).toBeTruthy();
    screen.getByRole("button", { name: "Accept invitation" }).click();
    const link = await screen.findByRole("link", { name: "Open Kundenhilfe" });
    expect(link.getAttribute("href")).toBe("https://help.example.org/");
  });

  it("shows the account form at once when accepting creates an account and marks every invalid field", async () => {
    const { requests } = api(() => ({
      body: { ...OPEN, knowledgeBaseName: "Kundenhilfe", newAccount: true },
    }));
    await open(`/accept-invitation#token=${TOKEN}`);
    expect(await screen.findByRole("heading", { name: "Read Kundenhilfe" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept invitation" })).toBeNull();
    const user = userEvent.setup();
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Klara Kundin");
    const password = screen.getByLabelText("Password");
    await user.type(password, "short");
    expect(screen.getByText(/Not met yet/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Use at least 12 characters.")).toBeTruthy();
    expect(screen.getByText("The passwords do not match.")).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(password));
    expect(requests.some((request) => request.path === "/api/v1/invitations/accept")).toBe(false);
    await user.clear(password);
    await user.type(password, "a long reader passphrase");
    expect(screen.getByText(/Met\./)).toBeTruthy();
  });
});
