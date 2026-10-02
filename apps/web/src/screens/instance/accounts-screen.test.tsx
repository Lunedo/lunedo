import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "../../app.js";
import { initI18n } from "../../i18n/index.js";
import { mockApi, problem } from "../../testing/render.js";

const OLIVIA = {
  id: "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c",
  email: "olivia@example.org",
  name: "Olivia Owner",
};
const MAX = "01929b1e-0000-7000-8000-0000000000cc";

function account(id: string, name: string, email: string) {
  return {
    id,
    type: "standard",
    state: "active",
    email,
    name,
    homeOrganizationId: null,
    createdAt: "2026-09-01T08:00:00.000Z",
    lastSignInAt: "2026-10-01T09:00:00.000Z",
    twoFactorActive: true,
    instanceRoles: id === OLIVIA.id ? [{ builtInRole: "owner", customRoleId: null, name: null }] : [],
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

function api(resetResult: () => { status?: number; body?: unknown }) {
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
      body: {
        sessionKind: "full",
        account: OLIVIA,
        methods: ["password", "totp"],
        recentlyAuthenticated: true,
      },
    }),
    "GET /api/v1/organizations": () => ({ body: { items: [], nextCursor: null } }),
    "GET /api/v1/account/permissions": () => ({
      body: {
        instance: ["instance.accounts.view", "instance.accounts.manage"],
        organization: [],
        grantableAreas: { instance: {}, organization: {} },
      },
    }),
    "GET /api/v1/account/preferences": () => ({ body: [] }),
    "GET /api/v1/notifications/unread-count": () => ({ body: { count: 0 } }),
    "GET /api/v1/instance/accounts": (request) => ({
      body: {
        items: request.path.includes("q=max")
          ? [account(MAX, "Max Member", "max@example.org")]
          : [account(OLIVIA.id, OLIVIA.name, OLIVIA.email), account(MAX, "Max Member", "max@example.org")],
        nextCursor: null,
      },
    }),
    [`GET /api/v1/instance/accounts/${MAX}`]: () => ({
      body: {
        account: account(MAX, "Max Member", "max@example.org"),
        memberships: [
          {
            organizationId: "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f",
            name: "Platform Team",
            kind: "member",
            expiresAt: null,
            home: true,
            roles: [
              {
                assignmentId: "01929b1e-0000-7000-8000-0000000000dd",
                builtInRole: null,
                customRoleId: "01929b1e-0000-7000-8000-0000000000ee",
                name: "Audit readers",
                via: "group",
                groupName: "Auditors",
                expiresAt: null,
              },
            ],
          },
        ],
        sessions: [
          {
            id: "01929b1e-0000-7000-8000-0000000000ff",
            kind: "full",
            methods: ["password"],
            browser: "Firefox",
            operatingSystem: "Linux",
            clientIp: "198.51.100.7",
            createdAt: "2026-10-01T09:00:00.000Z",
            lastUsedAt: "2026-10-01T10:00:00.000Z",
          },
        ],
        tokens: [],
        twoFactor: { totp: true, passkeys: 1, recoveryCodes: 9 },
      },
    }),
    [`POST /api/v1/accounts/${MAX}/second-factor/reset`]: resetResult,
  });
}

async function renderAccounts() {
  window.history.replaceState(null, "", "/settings/instance/accounts");
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
  return screen.findByRole("table", { name: "Accounts" });
}

describe("the accounts page", () => {
  it("searches on the server and opens an account in a side panel", async () => {
    const { requests } = api(() => ({ body: { endedSessions: 1 } }));
    const table = await renderAccounts();
    expect(await within(table).findByText("Olivia Owner")).toBeTruthy();
    expect(within(table).getByText("Owner")).toBeTruthy();
    await userEvent.type(screen.getByRole("searchbox", { name: "Search by name or e-mail" }), "max");
    await waitFor(() => expect(requests.some((request) => request.path.includes("q=max"))).toBe(true));
    await waitFor(() => expect(within(table).queryByText("Olivia Owner")).toBeNull());

    await userEvent.click(within(table).getByText("Max Member"));
    const panel = await screen.findByRole("dialog", { name: "Max Member" });
    expect(await within(panel).findByText("Audit readers through Auditors", { exact: false })).toBeTruthy();
    expect(within(panel).getByText("Firefox · Linux")).toBeTruthy();
    expect(within(panel).getByText("One passkey")).toBeTruthy();
  });

  it("resets a second factor only with a reason and reports the result", async () => {
    const { requests } = api(() => ({ body: { endedSessions: 2 } }));
    const table = await renderAccounts();
    await userEvent.click(await within(table).findByText("Max Member"));
    const panel = await screen.findByRole("dialog", { name: "Max Member" });
    await userEvent.click(within(panel).getByRole("button", { name: "Reset second factor" }));
    const dialog = await screen.findByRole("dialog", { name: "Reset the second factor of Max Member?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Reset second factor" }));
    expect(within(dialog).getByText(/Enter a reason/)).toBeTruthy();
    expect(requests.some((request) => request.path.endsWith("/second-factor/reset"))).toBe(false);
    await userEvent.type(within(dialog).getByLabelText("Reason"), "Lost phone, confirmed by call");
    await userEvent.click(within(dialog).getByRole("button", { name: "Reset second factor" }));
    expect(
      await screen.findByText("The second factor of Max Member was reset. 2 sessions were ended."),
    ).toBeTruthy();
    expect(requests.find((request) => request.path.endsWith("/second-factor/reset"))?.body).toEqual({
      reason: "Lost phone, confirmed by call",
    });
  });

  it("explains why the own account cannot be changed here", async () => {
    api(() => problem(409, "resetOwnSecondFactor"));
    const table = await renderAccounts();
    await userEvent.click(await within(table).findByText("Olivia Owner"));
    const panel = await screen.findByRole("dialog", { name: "Olivia Owner" });
    expect(within(panel).getByText("You manage your own account on the Security page.")).toBeTruthy();
    expect(
      (within(panel).getByRole("button", { name: "Reset second factor" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
