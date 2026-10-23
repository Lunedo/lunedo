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
const ORGANIZATION = "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f";
const RESEARCH = "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e60";

function account(id: string, name: string, email: string) {
  const own = id === OLIVIA.id;
  return {
    id,
    type: "standard",
    state: "active",
    email,
    name,
    homeOrganizationId: own ? ORGANIZATION : null,
    organizations: own
      ? [
          { id: ORGANIZATION, name: "Platform Team", home: true },
          { id: RESEARCH, name: "Research", home: false },
        ]
      : [],
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

function api(
  resetResult: () => { status?: number; body?: unknown },
  overrides: Record<string, (request: { path: string }) => { status?: number; body?: unknown }> = {},
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
          {
            organizationId: RESEARCH,
            name: "Research",
            kind: "member",
            expiresAt: null,
            home: false,
            roles: [],
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
    [`GET /api/v1/instance/accounts/${OLIVIA.id}`]: () => ({
      body: {
        account: account(OLIVIA.id, OLIVIA.name, OLIVIA.email),
        memberships: [],
        sessions: [],
        tokens: [],
        twoFactor: { totp: true, passkeys: 0, recoveryCodes: 10 },
      },
    }),
    [`POST /api/v1/accounts/${MAX}/second-factor/reset`]: resetResult,
    "GET /api/v1/instance/organizations": () => ({
      body: { items: [{ id: ORGANIZATION, name: "Platform Team", slug: "platform" }], nextCursor: null },
    }),
    [`POST /api/v1/instance/accounts/${MAX}/organization`]: () => ({ status: 204 }),
    [`POST /api/v1/instance/accounts/${MAX}/anonymize`]: () => ({
      body: { endedSessions: 1, removedIdentities: 0, endedMemberships: 2 },
    }),
    [`PUT /api/v1/accounts/${MAX}/home-organization`]: () => ({ status: 204 }),
    "POST /api/v1/instance/accounts/placeholders": () => ({
      status: 201,
      body: {
        id: "01929b1e-0000-7000-8000-0000000000ab",
        name: "Imported Author",
        email: "imported@example.org",
      },
    }),
    ...overrides,
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

  it("lists the organizations of each account, marks the home organization and names who manages it", async () => {
    api(() => ({ body: { endedSessions: 0 } }));
    const table = await renderAccounts();
    const olivia = (await within(table).findByText("Olivia Owner")).closest("tr");
    const max = within(table).getByText("Max Member").closest("tr");
    if (!olivia || !max) throw new Error("Rows not found");
    expect(within(table).getByRole("columnheader", { name: "Organizations" })).toBeTruthy();
    expect(within(olivia).getByText("Platform Team")).toBeTruthy();
    expect(within(olivia).getByText("Research")).toBeTruthy();
    const marks = within(olivia).getAllByRole("img", { name: /^Home organization:/ });
    expect(marks).toHaveLength(1);
    expect(marks[0]?.closest("li")?.textContent).toBe("Platform Team");
    expect(within(max).getByText("Without organization")).toBeTruthy();

    await userEvent.click(within(table).getByText("Olivia Owner"));
    const panel = await screen.findByRole("dialog", { name: "Olivia Owner" });
    expect(within(panel).getByText("Managed by: Platform Team")).toBeTruthy();
  });

  it("shows no two-factor status for accounts that cannot have a second factor", async () => {
    api(() => ({ body: {} }), {
      "GET /api/v1/instance/accounts": () => ({
        body: {
          items: [
            { ...account(MAX, "CI pipeline", ""), type: "service", email: null, twoFactorActive: false },
            { ...account(OLIVIA.id, "Imported Author", ""), state: "placeholder", twoFactorActive: false },
            { ...account(RESEARCH, "Lena Lind", "lena@example.org"), twoFactorActive: false },
          ],
          nextCursor: null,
        },
      }),
    });
    const table = await renderAccounts();
    const row = (name: string) => within(table).getByText(name).closest("tr") as HTMLElement;
    await within(table).findByText("CI pipeline");
    expect(within(row("CI pipeline")).queryByText("Not set up")).toBeNull();
    expect(within(row("Imported Author")).queryByText("Not set up")).toBeNull();
    expect(within(row("Lena Lind")).getByText("Not set up")).toBeTruthy();
  });

  it("shows the home organization also when the account belongs to one organization only", async () => {
    api(() => ({ body: {} }), {
      [`GET /api/v1/instance/accounts/${MAX}`]: () => ({
        body: {
          account: { ...account(MAX, "Max Member", "max@example.org"), homeOrganizationId: ORGANIZATION },
          memberships: [
            {
              organizationId: ORGANIZATION,
              name: "Platform Team",
              kind: "member",
              expiresAt: null,
              home: true,
              roles: [],
            },
          ],
          sessions: [],
          tokens: [],
          twoFactor: { totp: true, passkeys: 0, recoveryCodes: 10 },
        },
      }),
    });
    const table = await renderAccounts();
    await userEvent.click(await within(table).findByText("Max Member"));
    const panel = await screen.findByRole("dialog", { name: "Max Member" });
    const home = (await within(panel).findByRole("heading", { name: "Home organization" })).closest(
      "section",
    ) as HTMLElement;
    expect(within(home).getByText("Platform Team")).toBeTruthy();
    expect(within(home).getByText(/first add the person as a member to another organization/)).toBeTruthy();
  });

  it("filters accounts without an organization and assigns one", async () => {
    const { requests } = api(() => ({ body: { endedSessions: 0 } }));
    const table = await renderAccounts();
    await userEvent.click(await screen.findByRole("combobox", { name: "Filter accounts" }));
    await userEvent.click(await screen.findByRole("option", { name: "Without organization" }));
    await waitFor(() =>
      expect(requests.some((request) => request.path.includes("withoutOrganization=true"))).toBe(true),
    );
    await userEvent.click(await within(table).findByText("Max Member"));
    const panel = await screen.findByRole("dialog", { name: "Max Member" });
    await userEvent.click(within(panel).getByRole("combobox", { name: "Organization" }));
    await userEvent.click(await screen.findByRole("option", { name: "Platform Team" }));
    await userEvent.click(within(panel).getByRole("button", { name: "Assign organization" }));
    await waitFor(() =>
      expect(
        requests.find((request) => request.path.endsWith(`/accounts/${MAX}/organization`))?.body,
      ).toEqual({
        organizationId: ORGANIZATION,
      }),
    );
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

  it("anonymizes an account only after the reason and the typed name", async () => {
    const { requests } = api(() => ({ body: { endedSessions: 0 } }));
    const table = await renderAccounts();
    await userEvent.click(await within(table).findByText("Max Member"));
    const panel = await screen.findByRole("dialog", { name: "Max Member" });
    await userEvent.click(within(panel).getByRole("button", { name: "Anonymize account…" }));
    const dialog = await screen.findByRole("dialog", { name: "Anonymize account" });
    expect(within(dialog).getByText(/exported or streamed to other systems are outside Lunedo/)).toBeTruthy();
    const confirm = within(dialog).getByRole("button", { name: "Anonymize" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    await userEvent.click(confirm);
    expect(document.activeElement).toBe(within(dialog).getByLabelText("Reason"));
    expect(within(dialog).getByText(/Enter why the account is anonymized/)).toBeTruthy();
    await userEvent.type(within(dialog).getByLabelText("Reason"), "Erasure request of 1 October 2026");
    await userEvent.type(within(dialog).getByLabelText("Type Max Member to confirm"), "Max");
    await userEvent.click(confirm);
    expect(document.activeElement).toBe(within(dialog).getByLabelText("Type Max Member to confirm"));
    expect(requests.some((request) => request.path.endsWith("/anonymize"))).toBe(false);
    await userEvent.type(within(dialog).getByLabelText("Type Max Member to confirm"), " Member");
    await userEvent.click(confirm);
    expect(await screen.findByText("The account was anonymized")).toBeTruthy();
    expect(requests.find((request) => request.path.endsWith(`/accounts/${MAX}/anonymize`))?.body).toEqual({
      reason: "Erasure request of 1 October 2026",
      confirmation: "Max Member",
    });
  });

  it("adds a placeholder with a name and an e-mail address", async () => {
    const { requests } = api(() => ({ body: { endedSessions: 0 } }));
    await renderAccounts();
    await userEvent.click(await screen.findByRole("button", { name: "Add placeholder" }));
    const dialog = await screen.findByRole("dialog", { name: "Add placeholder" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Create placeholder" }));
    expect(requests.some((request) => request.path.endsWith("/placeholders"))).toBe(false);
    await userEvent.type(within(dialog).getByLabelText("Name"), "Imported Author");
    await userEvent.type(within(dialog).getByLabelText("E-mail address"), "imported@example.org");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create placeholder" }));
    expect(await screen.findByText("Placeholder for Imported Author created")).toBeTruthy();
    expect(requests.find((request) => request.path.endsWith("/placeholders"))?.body).toEqual({
      name: "Imported Author",
      email: "imported@example.org",
    });
  });

  it("changes the home organization to another organization the account belongs to", async () => {
    const { requests } = api(() => ({ body: { endedSessions: 0 } }), {
      "GET /api/v1/instance/accounts": () => ({
        body: {
          items: [{ ...account(MAX, "Max Member", "max@example.org"), homeOrganizationId: ORGANIZATION }],
          nextCursor: null,
        },
      }),
      [`GET /api/v1/instance/accounts/${MAX}`]: () => ({
        body: {
          account: { ...account(MAX, "Max Member", "max@example.org"), homeOrganizationId: ORGANIZATION },
          memberships: [
            {
              organizationId: ORGANIZATION,
              name: "Platform Team",
              kind: "member",
              expiresAt: null,
              home: true,
              roles: [],
            },
            {
              organizationId: RESEARCH,
              name: "Research",
              kind: "member",
              expiresAt: null,
              home: false,
              roles: [],
            },
          ],
          sessions: [],
          tokens: [],
          twoFactor: { totp: true, passkeys: 0, recoveryCodes: 10 },
        },
      }),
    });
    const table = await renderAccounts();
    await userEvent.click(await within(table).findByText("Max Member"));
    const panel = await screen.findByRole("dialog", { name: "Max Member" });
    const change = (await within(panel).findByRole("button", {
      name: "Change home organization",
    })) as HTMLButtonElement;
    await userEvent.click(change);
    expect(
      within(panel).getByText(/Choose an organization other than the current home organization/),
    ).toBeTruthy();
    expect(requests.some((request) => request.path.endsWith("/home-organization"))).toBe(false);
    await userEvent.click(within(panel).getByRole("combobox", { name: "New home organization" }));
    await userEvent.click(await screen.findByRole("option", { name: "Research" }));
    await userEvent.click(change);
    expect(await screen.findByText("Research is the home organization now")).toBeTruthy();
    expect(
      requests.find((request) => request.path.endsWith(`/accounts/${MAX}/home-organization`))?.body,
    ).toEqual({
      organizationId: RESEARCH,
    });
  });

  it("merges a placeholder into another account but not into the own one", async () => {
    const PLACEHOLDER = "01929b1e-0000-7000-8000-0000000000ab";
    const placeholder = {
      ...account(PLACEHOLDER, "Imported Author", "imported@example.org"),
      state: "placeholder",
    };
    const { requests } = api(() => ({ body: { endedSessions: 0 } }), {
      "GET /api/v1/instance/accounts": (request) => ({
        body: {
          items: request.path.includes("state=active")
            ? [account(OLIVIA.id, OLIVIA.name, OLIVIA.email), account(MAX, "Max Member", "max@example.org")]
            : [placeholder],
          nextCursor: null,
        },
      }),
      [`GET /api/v1/instance/accounts/${PLACEHOLDER}`]: () => ({
        body: {
          account: placeholder,
          memberships: [],
          sessions: [],
          tokens: [],
          twoFactor: { totp: false, passkeys: 0, recoveryCodes: 0 },
        },
      }),
      [`POST /api/v1/instance/accounts/${PLACEHOLDER}/merge`]: () => ({
        body: { memberships: 1, groups: 0, roles: 0 },
      }),
    });
    const table = await renderAccounts();
    await userEvent.click(await within(table).findByText("Imported Author"));
    const panel = await screen.findByRole("dialog", { name: "Imported Author" });
    const field = await within(panel).findByRole("combobox", { name: "Account" });
    await userEvent.type(field, "o");
    await userEvent.click(await screen.findByRole("option", { name: /Olivia Owner/ }));
    expect(
      await within(panel).findByText("You cannot merge a placeholder into your own account."),
    ).toBeTruthy();
    await userEvent.click(within(panel).getByRole("button", { name: "Merge" }));
    expect(requests.some((request) => request.path.endsWith("/merge"))).toBe(false);
    await userEvent.clear(field);
    await userEvent.type(field, "m");
    await userEvent.click(await screen.findByRole("option", { name: /Max Member/ }));
    await userEvent.click(within(panel).getByRole("button", { name: "Merge" }));
    expect(await screen.findByText(/Imported Author merged into Max Member/)).toBeTruthy();
    expect(requests.find((request) => request.path.endsWith(`/${PLACEHOLDER}/merge`))?.body).toEqual({
      accountId: MAX,
    });
  });

  it("explains why the own account cannot be changed here", async () => {
    api(() => problem(409, "resetOwnSecondFactor"));
    const table = await renderAccounts();
    await userEvent.click(await within(table).findByText("Olivia Owner"));
    const panel = await screen.findByRole("dialog", { name: "Olivia Owner" });
    expect(
      within(panel).getByText("You manage your own account on the Sign-in and security page."),
    ).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "Reset second factor" })).toBeNull();
    expect(within(panel).queryByRole("region", { name: "Danger zone" })).toBeNull();
  });

  it("keeps lasting actions in a danger zone at the end and names their effects", async () => {
    const { requests } = api(() => ({ body: { endedSessions: 0 } }), {
      [`POST /api/v1/accounts/${MAX}/deactivate`]: () => ({ status: 204 }),
    });
    const table = await renderAccounts();
    await userEvent.click(await within(table).findByText("Max Member"));
    const panel = await screen.findByRole("dialog", { name: "Max Member" });
    await within(panel).findByText("Audit readers through Auditors", { exact: false });
    const zone = within(panel).getByRole("region", { name: "Danger zone" });
    const sections = within(panel).getAllByRole("region");
    expect(sections.at(-1)).toBe(zone);
    expect(
      within(zone)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["End all sessions", "Reset second factor", "Deactivate account", "Anonymize account…"]);
    await userEvent.click(within(zone).getByRole("button", { name: "Deactivate account" }));
    const dialog = await screen.findByRole("dialog", { name: "Deactivate Max Member?" });
    expect(
      within(dialog).getByText(/sessions end at once and its API tokens are revoked for good/),
    ).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Deactivate account" }));
    await waitFor(() =>
      expect(requests.some((request) => request.path.endsWith(`/accounts/${MAX}/deactivate`))).toBe(true),
    );
  });
});
