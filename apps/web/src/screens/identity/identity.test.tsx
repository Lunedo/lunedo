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
const PROVIDER = "01929b1e-0000-7000-8000-0000000000a1";
const MAX = "01929b1e-0000-7000-8000-0000000000cc";

type Handler = (request: RecordedRequest) => { status?: number; body?: unknown };

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

const INFO = {
  name: "Example Wiki",
  setupComplete: true,
  language: "en",
  accentColor: "petrol",
  passwordMinLength: 12,
  selfRegistration: false,
  organization: null,
};

function signedOutApi(options: Record<string, unknown>, overrides: Record<string, Handler> = {}) {
  return mockApi({
    "GET /api/v1/instance/info": () => ({ body: INFO }),
    "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
    "GET /api/v1/auth/sign-in-options": () => ({
      body: {
        emailStep: true,
        directProvider: null,
        lastProvider: null,
        passwordSignIn: true,
        passkeys: true,
        ...options,
      },
    }),
    [`POST /api/v1/auth/providers/${PROVIDER}/start`]: () => ({ body: { url: "#provider-start" } }),
    ...overrides,
  });
}

async function renderPath(path: string) {
  window.history.replaceState(null, "", path);
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
}

const ENTRA = { id: PROVIDER, name: "Microsoft", preset: "entraId", logoRef: null };

describe("the sign-in page", () => {
  it("asks for the e-mail address first and continues with the provider of its domain", async () => {
    const { requests } = signedOutApi(
      {},
      {
        "POST /api/v1/auth/sign-in/discover": () => ({
          body: { step: "provider", providerId: PROVIDER, name: "Microsoft", preset: "entraId" },
        }),
      },
    );
    await renderPath("/sign-in?redirect=%2Fsettings%2Fsecurity");
    await userEvent.type(
      await screen.findByLabelText("Work e-mail address or sign-in name"),
      "lena@example.org",
    );
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("example.org signs in with Microsoft")).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Sign in with Microsoft" }));
    await waitFor(() =>
      expect(requests.find((request) => request.path.endsWith("/start"))?.body).toEqual({
        returnTo: "/settings/security",
      }),
    );
    expect(requests.find((request) => request.path === "/api/v1/auth/sign-in/discover")?.body).toEqual({
      email: "lena@example.org",
    });
  });

  it("offers the password for other addresses and says when no method is set up", async () => {
    let step = "password";
    signedOutApi({}, { "POST /api/v1/auth/sign-in/discover": () => ({ body: { step } }) });
    await renderPath("/sign-in");
    await userEvent.type(
      await screen.findByLabelText("Work e-mail address or sign-in name"),
      "guest@partner.example",
    );
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByLabelText("Password")).toBeTruthy();

    step = "none";
    await userEvent.click(screen.getByRole("button", { name: "Change" }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("No sign-in method is set up for this address")).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  it("keeps the emergency sign-in reachable when the owner's domain belongs to a provider", async () => {
    const { requests } = signedOutApi(
      { passwordSignIn: true },
      {
        "POST /api/v1/auth/sign-in/discover": () => ({
          body: { step: "provider", providerId: PROVIDER, name: "Microsoft", preset: "entraId" },
        }),
        "POST /api/v1/auth/sign-in": () => ({
          body: { status: "secondFactorRequired", factors: ["totp"] },
        }),
      },
    );
    await renderPath("/sign-in");
    await userEvent.type(await screen.findByLabelText("Work e-mail address or sign-in name"), OLIVIA.email);
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("button", { name: "Sign in with Microsoft" })).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Emergency sign-in for the instance owner" }));
    const dialog = await screen.findByRole("dialog", { name: "Emergency sign-in" });
    await userEvent.type(within(dialog).getByLabelText("E-mail"), OLIVIA.email);
    await userEvent.type(within(dialog).getByLabelText("Password"), "correct horse battery");
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Confirm it's you" })).toBeTruthy();
    expect(requests.find((request) => request.path === "/api/v1/auth/sign-in")?.body).toEqual({
      email: OLIVIA.email,
      password: "correct horse battery",
    });
  });

  it("shows the only provider directly and keeps the emergency sign-in when passwords are off", async () => {
    const { requests } = signedOutApi(
      { emailStep: false, directProvider: ENTRA, passwordSignIn: false },
      {
        "POST /api/v1/auth/sign-in": () => ({
          body: { status: "secondFactorRequired", factors: ["totp"] },
        }),
      },
    );
    await renderPath("/sign-in");
    expect(await screen.findByRole("button", { name: "Sign in with Microsoft" })).toBeTruthy();
    expect(screen.queryByLabelText("Work e-mail address or sign-in name")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Emergency sign-in for the instance owner" }));
    const dialog = await screen.findByRole("dialog", { name: "Emergency sign-in" });
    await userEvent.type(within(dialog).getByLabelText("E-mail"), OLIVIA.email);
    await userEvent.type(within(dialog).getByLabelText("Password"), "correct horse battery");
    await userEvent.click(within(dialog).getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Confirm it's you" })).toBeTruthy();
    expect(requests.find((request) => request.path === "/api/v1/auth/sign-in")?.body).toEqual({
      email: OLIVIA.email,
      password: "correct horse battery",
    });
  });

  it("offers the provider used last as a shortcut", async () => {
    const { requests } = signedOutApi({ lastProvider: { ...ENTRA, name: "Microsoft Entra ID" } });
    await renderPath("/sign-in");
    await userEvent.click(await screen.findByRole("button", { name: "Microsoft Entra ID" }));
    await waitFor(() => expect(requests.some((request) => request.path.endsWith("/start"))).toBe(true));
  });

  it("explains a refused sign-in with what to do and the reference", async () => {
    signedOutApi({});
    await renderPath("/sign-in/refused?reason=domainNotAllowed&reference=01JB7Q4K2M9X");
    expect(await screen.findByText("Your address is not accepted by this provider")).toBeTruthy();
    expect(screen.getByText(/sign in with your work account instead/)).toBeTruthy();
    expect(screen.getByText("01JB7Q4K2M9X")).toBeTruthy();
  });
});

describe("linking an existing account", () => {
  function linkApi() {
    return signedOutApi(
      {},
      {
        "GET /api/v1/auth/link": () => ({
          body: {
            providerName: "Microsoft",
            email: "lena@example.org",
            accountName: "Lena Hofer",
            factors: ["totp"],
          },
        }),
        "POST /api/v1/auth/link": (request) =>
          (request.body as { password: string }).password === "right password"
            ? { body: { status: "signedIn", sessionKind: "full", account: OLIVIA } }
            : problem(401, "invalidCredentials"),
        "POST /api/v1/auth/link/decline": () => ({ body: { reference: "01JB7R2T9QW4" } }),
      },
    );
  }

  it("links only with the password and the second factor of the account", async () => {
    const { requests } = linkApi();
    await renderPath("/sign-in/link");
    expect(await screen.findByRole("heading", { name: "Link your Microsoft account" })).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Password of Lena Hofer"), "right password");
    await userEvent.type(screen.getByLabelText("Code from your authenticator app"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Confirm and link" }));
    await waitFor(() =>
      expect(
        requests.find((request) => request.method === "POST" && request.path === "/api/v1/auth/link")?.body,
      ).toEqual({
        password: "right password",
        factor: { type: "totp", code: "123456" },
      }),
    );
  });

  it("ends the sign-in with a reference when the account is not theirs", async () => {
    linkApi();
    await renderPath("/sign-in/link");
    await userEvent.click(await screen.findByRole("button", { name: "This is not my account" }));
    expect(await screen.findByText("01JB7R2T9QW4")).toBeTruthy();
  });
});

function adminApi(overrides: Record<string, Handler> = {}) {
  return mockApi({
    "GET /api/v1/instance/info": () => ({ body: INFO }),
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
        instance: [
          "instance.signIn.view",
          "instance.signIn.manage",
          "instance.accounts.view",
          "instance.accounts.manage",
        ],
        organization: [],
        grantableAreas: { instance: {}, organization: {} },
      },
    }),
    "GET /api/v1/account/preferences": () => ({ body: [] }),
    "GET /api/v1/notifications/unread-count": () => ({ body: { count: 0 } }),
    "GET /api/v1/instance/settings": () => ({
      body: {
        items: [
          {
            key: "auth.passwordSignIn",
            value: true,
            defaultValue: true,
            source: "default",
            lockedBy: null,
            locked: false,
            lockable: false,
            levelsBelow: [],
            editable: true,
            levels: [{ level: "instance", value: null, locked: false, effective: true }],
          },
        ],
        nextCursor: null,
      },
    }),
    ...overrides,
  });
}

function provider(patch: Record<string, unknown> = {}) {
  return {
    id: PROVIDER,
    type: "oidc",
    name: "Microsoft Entra ID · Example",
    config: {
      preset: "entraId",
      clientId: "a91b7e04-2c6d-4f13-8e5a-0b9d4c7f2a61",
      domains: ["example.org", "example.at"],
      idTokenAlgorithm: "RS256",
      accountCreation: { enabled: true, requiredGroups: [] },
      tenantId: "3f2a9c1e-7b4d-4e8a-9c21-5d6f0a8b2e17",
      authority: "https://login.microsoftonline.com",
      graphUrl: "https://graph.microsoft.com",
      emailSource: "email",
      signInNameSource: "userPrincipalName",
      sync: { intervalMinutes: 60 },
      secondFactor: { mode: "provider", proofValues: ["mfa"] },
    },
    issuer: "https://login.microsoftonline.com/3f2a9c1e-7b4d-4e8a-9c21-5d6f0a8b2e17/v2.0",
    redirectUri: `https://wiki.example.org/api/v1/auth/providers/${PROVIDER}/callback`,
    logoRef: null,
    credentials: [
      {
        id: "01929b1e-0000-7000-8000-0000000000b1",
        kind: "clientSecret",
        keyId: null,
        expiresAt: "2026-10-23T00:00:00.000Z",
        createdAt: "2024-10-23T00:00:00.000Z",
      },
    ],
    warnings: ["credentialExpiring"],
    directoryKey: false,
    capabilities: { groups: true, directorySync: true, disabledAccounts: true },
    deactivatedAt: null,
    createdAt: "2026-09-01T08:00:00.000Z",
    updatedAt: "2026-09-01T08:00:00.000Z",
    ...patch,
  };
}

describe("the sign-in settings of the instance", () => {
  it("lists the providers with their domains, warns about expiring credentials and offers password sign-in", async () => {
    adminApi({ "GET /api/v1/instance/identity-providers": () => ({ body: [provider()] }) });
    await renderPath("/settings/instance/sign-in-providers");
    const table = await screen.findByRole("table", { name: "Identity providers" });
    expect(within(table).getByText("example.org, example.at")).toBeTruthy();
    expect(screen.getByText(/The credential of Microsoft Entra ID · Example expires soon/)).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Password sign-in" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add provider" })).toBeTruthy();
  });

  it("shows the redirect URI and the credentials of a provider", async () => {
    adminApi({
      [`GET /api/v1/instance/identity-providers/${PROVIDER}`]: () => ({ body: provider() }),
      "GET /api/v1/instance/identity-providers": () => ({ body: [provider()] }),
    });
    await renderPath(`/settings/instance/sign-in-providers/${PROVIDER}`);
    expect(
      await screen.findByRole("heading", { name: "Microsoft Entra ID · Example", level: 1 }),
    ).toBeTruthy();
    expect(
      screen.getByDisplayValue(`https://wiki.example.org/api/v1/auth/providers/${PROVIDER}/callback`),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add credential" })).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: "Settings" }));
    expect(await screen.findByText("Existing accounts")).toBeTruthy();
    expect(screen.queryByText(/Organizations/)).toBeNull();
  });

  it("deactivates a provider instead of removing it and activates it again", async () => {
    let deactivatedAt: string | null = null;
    const current = () => provider({ deactivatedAt });
    const { requests } = adminApi({
      [`GET /api/v1/instance/identity-providers/${PROVIDER}`]: () => ({ body: current() }),
      "GET /api/v1/instance/identity-providers": () => ({ body: [current()] }),
      [`POST /api/v1/instance/identity-providers/${PROVIDER}/deactivate`]: () => {
        deactivatedAt = "2026-10-02T08:00:00.000Z";
        return { body: current() };
      },
      [`POST /api/v1/instance/identity-providers/${PROVIDER}/activate`]: () => {
        deactivatedAt = null;
        return { body: current() };
      },
    });
    await renderPath(`/settings/instance/sign-in-providers/${PROVIDER}?tab=settings`);
    await userEvent.click(await screen.findByRole("button", { name: "Deactivate" }));
    const confirm = await screen.findByRole("dialog", { name: "Deactivate Microsoft Entra ID · Example" });
    expect(within(confirm).getByText(/sessions that came from it end now/)).toBeTruthy();
    await userEvent.click(within(confirm).getByRole("button", { name: "Deactivate" }));
    expect(await screen.findByText("This provider is deactivated")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Activate" }));
    await waitFor(() => expect(screen.queryByText("This provider is deactivated")).toBeNull());
    expect(requests.filter((request) => request.method === "POST").map((request) => request.path)).toEqual([
      `/api/v1/instance/identity-providers/${PROVIDER}/deactivate`,
      `/api/v1/instance/identity-providers/${PROVIDER}/activate`,
    ]);
  });

  it("explains paused administrative roles to the person", async () => {
    adminApi({
      "GET /api/v1/instance/identity-providers": () => ({ body: [provider()] }),
      "GET /api/v1/account/withheld-roles": () => ({
        body: [
          {
            assignmentId: "01929b1e-0000-7000-8000-0000000000d1",
            scope: "organization",
            organizationId: "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f",
            organizationName: "Platform Team",
            builtInRole: "administrator",
            roleName: null,
            providerName: "Microsoft",
            groupsReadAt: "2026-10-01T08:00:00.000Z",
          },
        ],
      }),
    });
    await renderPath("/settings/instance/sign-in-providers");
    expect(await screen.findByText("One of your administrative roles is paused")).toBeTruthy();
    expect(screen.getByText(/could not read your groups from Microsoft/)).toBeTruthy();
  });

  it("tells a person without an organization that the administrators were informed", async () => {
    adminApi({
      "GET /api/v1/instance/identity-providers": () => ({ body: [provider()] }),
      "GET /api/v1/auth/session": () => ({
        body: {
          sessionKind: "full",
          account: { ...OLIVIA, type: "standard", homeOrganizationId: null },
          methods: ["identityProvider"],
          recentlyAuthenticated: true,
        },
      }),
    });
    await renderPath("/settings/instance/sign-in-providers");
    expect(await screen.findByText("No organization is assigned to you yet")).toBeTruthy();
  });

  it("warns sign-in administrators when identity providers are not checked strictly", async () => {
    adminApi({
      "GET /api/v1/instance/identity-providers": () => ({ body: [provider()] }),
      "GET /api/v1/instance/sign-in-security": () => ({ body: { insecureIdentityProviders: true } }),
    });
    await renderPath("/settings/instance/sign-in-providers");
    expect(await screen.findByText("Identity providers are not checked strictly")).toBeTruthy();
  });

  it("lets only the instance owner choose who is told about an emergency sign-in", async () => {
    const recipients = { instanceAdministrators: true, accounts: [], addresses: ["alarm@example.net"] };
    adminApi({
      "GET /api/v1/instance/identity-providers": () => ({ body: [provider()] }),
      "GET /api/v1/instance/emergency-sign-in-recipients": () => ({ body: recipients }),
    });
    await renderPath("/settings/instance/sign-in-providers");
    expect((await screen.findAllByText(/Only the instance owner can change/)).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("switch", { name: "Tell instance administrators" }).getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("saves the emergency sign-in recipients of the instance owner at once", async () => {
    const recipients = { instanceAdministrators: true, accounts: [], addresses: ["alarm@example.net"] };
    const { requests } = adminApi({
      "GET /api/v1/instance/identity-providers": () => ({ body: [provider()] }),
      "GET /api/v1/instance/emergency-sign-in-recipients": () => ({ body: recipients }),
      "PUT /api/v1/instance/emergency-sign-in-recipients": (request) => {
        const body = request.body as { instanceAdministrators: boolean; addresses: string[] };
        return { body: { ...recipients, ...body, accounts: [] } };
      },
      "GET /api/v1/account/permissions": () => ({
        body: {
          instance: ["instance.signIn.view", "instance.signIn.manage", "instance.emergencyRecipients.manage"],
          organization: [],
          grantableAreas: { instance: {}, organization: {} },
        },
      }),
    });
    await renderPath("/settings/instance/sign-in-providers");
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: "Tell instance administrators" }).getAttribute("aria-disabled"),
      ).not.toBe("true"),
    );
    await userEvent.click(screen.getByRole("switch", { name: "Tell instance administrators" }));
    await waitFor(() =>
      expect(requests.find((request) => request.method === "PUT")?.body).toEqual({
        instanceAdministrators: false,
        accountIds: [],
        addresses: ["alarm@example.net"],
      }),
    );
  });

  it("saves the second factor setting of a provider at once", async () => {
    const { requests } = adminApi({
      [`GET /api/v1/instance/identity-providers/${PROVIDER}`]: () => ({ body: provider() }),
      "GET /api/v1/instance/identity-providers": () => ({ body: [provider()] }),
      [`PATCH /api/v1/instance/identity-providers/${PROVIDER}`]: (request) => ({
        body: provider({ config: (request.body as { config: unknown }).config }),
      }),
    });
    await renderPath(`/settings/instance/sign-in-providers/${PROVIDER}?tab=settings`);
    await userEvent.click(
      await screen.findByRole("combobox", { name: "Second factor after a sign-in through this provider" }),
    );
    await userEvent.click(await screen.findByRole("option", { name: "Require proof from the provider" }));
    expect(await screen.findByLabelText("Accepted proof values")).toBeTruthy();
    const patch = requests.find((request) => request.method === "PATCH");
    expect((patch?.body as { config: { secondFactor: unknown } } | undefined)?.config.secondFactor).toEqual({
      mode: "providerProof",
      proofValues: ["mfa"],
    });
  });

  it("shows what the removal changes before a provider is removed", async () => {
    const { requests } = adminApi({
      [`GET /api/v1/instance/identity-providers/${PROVIDER}`]: () => ({ body: provider() }),
      "GET /api/v1/instance/identity-providers": () => ({ body: [provider()] }),
      [`GET /api/v1/instance/identity-providers/${PROVIDER}/removal-preview`]: () => ({
        body: { accounts: 12, accountsWithoutSignIn: 3, groups: 2, rules: 4, grants: 9 },
      }),
      [`DELETE /api/v1/instance/identity-providers/${PROVIDER}`]: () => ({ status: 204 }),
    });
    await renderPath(`/settings/instance/sign-in-providers/${PROVIDER}?tab=settings`);
    await userEvent.click(await screen.findByRole("button", { name: "Remove provider" }));
    const confirm = await screen.findByRole("dialog", { name: "Remove Microsoft Entra ID · Example?" });
    expect(
      await within(confirm).findByText(
        "3 accounts have no other way to sign in and cannot sign in any more.",
      ),
    ).toBeTruthy();
    const list = within(confirm).getByRole("list", { name: "What the removal changes" });
    expect(
      within(list).getByText("9 memberships and roles granted by its rules are withdrawn."),
    ).toBeTruthy();
    expect(within(list).getByText("4 mapping rules are removed.")).toBeTruthy();
    expect(
      within(list).getByText(
        "2 synchronized groups become ordinary groups and keep their members and permissions.",
      ),
    ).toBeTruthy();
    await userEvent.click(within(confirm).getByRole("button", { name: "Remove provider" }));
    await waitFor(() => expect(requests.some((request) => request.method === "DELETE")).toBe(true));
  });
});

describe("linked identities", () => {
  it("lets people unlink their own identity and explains a refusal", async () => {
    let refuse = true;
    const { requests } = adminApi({
      "GET /api/v1/account/identities": () => ({
        body: [
          {
            id: "01929b1e-0000-7000-8000-0000000000c2",
            providerId: PROVIDER,
            providerName: "Microsoft",
            subject: "tid:oid",
            email: "olivia@example.org",
            signInName: null,
            displayName: "Olivia",
            lastSignInAt: null,
            createdAt: "2026-09-01T08:00:00.000Z",
          },
        ],
      }),
      "GET /api/v1/account/security": () => ({
        body: { totp: true, passkeys: [], recoveryCodes: 8, secondFactorRequired: true },
      }),
      "GET /api/v1/account/sessions": () => ({ body: { items: [], nextCursor: null } }),
      "GET /api/v1/account/tokens": () => ({ body: { items: [], nextCursor: null } }),
      "DELETE /api/v1/account/identities/01929b1e-0000-7000-8000-0000000000c2": () =>
        refuse ? problem(409, "lastSignInMethod") : { status: 204 },
    });
    await renderPath("/settings/security");
    await userEvent.click(await screen.findByRole("button", { name: "Unlink" }));
    let confirm = await screen.findByRole("dialog", { name: "Unlink Microsoft?" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Unlink" }));
    expect(await screen.findByText(/This is the last working way to sign in/)).toBeTruthy();
    refuse = false;
    await userEvent.click(screen.getByRole("button", { name: "Unlink" }));
    confirm = await screen.findByRole("dialog", { name: "Unlink Microsoft?" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Unlink" }));
    await waitFor(() => expect(requests.filter((request) => request.method === "DELETE")).toHaveLength(2));
  });

  it("lets administrators unlink an identity in the account panel", { timeout: 15_000 }, async () => {
    const { requests } = adminApi({
      "GET /api/v1/instance/accounts": () => ({
        body: {
          items: [
            {
              id: MAX,
              type: "standard",
              state: "active",
              email: "max@example.org",
              name: "Max Member",
              homeOrganizationId: null,
              createdAt: "2026-09-01T08:00:00.000Z",
              lastSignInAt: null,
              twoFactorActive: false,
              instanceRoles: [],
            },
          ],
          nextCursor: null,
        },
      }),
      [`GET /api/v1/instance/accounts/${MAX}`]: () => ({
        body: {
          account: {
            id: MAX,
            type: "standard",
            state: "active",
            email: "max@example.org",
            name: "Max Member",
            homeOrganizationId: null,
            createdAt: "2026-09-01T08:00:00.000Z",
            lastSignInAt: null,
            twoFactorActive: false,
            instanceRoles: [],
          },
          memberships: [],
          sessions: [],
          tokens: [],
          twoFactor: { totp: false, passkeys: 0, recoveryCodes: 0 },
        },
      }),
      [`GET /api/v1/accounts/${MAX}/identities`]: () => ({
        body: [
          {
            id: "01929b1e-0000-7000-8000-0000000000c1",
            providerId: PROVIDER,
            providerName: "Microsoft",
            subject: "tid:oid",
            email: "max@example.org",
            signInName: "mmember@example.org",
            displayName: "Max Member",
            lastSignInAt: null,
            createdAt: "2026-09-01T08:00:00.000Z",
          },
        ],
      }),
      [`DELETE /api/v1/accounts/${MAX}/identities/01929b1e-0000-7000-8000-0000000000c1`]: () => ({
        status: 204,
      }),
    });
    await renderPath("/settings/instance/accounts");
    const table = await screen.findByRole("table", { name: "Accounts" });
    await userEvent.click(await within(table).findByText("Max Member"));
    const panel = await screen.findByRole("dialog", { name: "Max Member" });
    expect(await within(panel).findByText(/Signs in as mmember@example.org/)).toBeTruthy();
    await userEvent.click(within(panel).getByRole("button", { name: "Unlink" }));
    const confirm = await screen.findByRole("dialog", { name: "Unlink Microsoft?" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Unlink" }));
    await waitFor(() => expect(requests.some((request) => request.method === "DELETE")).toBe(true));
  });
});
