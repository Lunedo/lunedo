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
    await userEvent.type(await screen.findByLabelText("Work e-mail address"), "lena@example.org");
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
    await userEvent.type(await screen.findByLabelText("Work e-mail address"), "guest@partner.example");
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
    await userEvent.type(await screen.findByLabelText("Work e-mail address"), OLIVIA.email);
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
    expect(screen.queryByLabelText("Work e-mail address")).toBeNull();

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
});

describe("linked identities", () => {
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
