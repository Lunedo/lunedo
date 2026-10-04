import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "../../app.js";
import { initI18n } from "../../i18n/index.js";
import { mockApi, problem, type RecordedRequest } from "../../testing/render.js";

const LDAP = "01929b1e-0000-7000-8000-0000000000a3";
const OLIVIA = {
  id: "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c",
  email: "olivia@example.org",
  name: "Olivia Owner",
};

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

async function renderPath(path: string) {
  window.history.replaceState(null, "", path);
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
}

function signedOutApi(options: Record<string, unknown>, overrides: Record<string, Handler> = {}) {
  return mockApi({
    "GET /api/v1/instance/info": () => ({ body: INFO }),
    "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
    "GET /api/v1/auth/sign-in-options": () => ({
      body: {
        emailStep: true,
        directProvider: null,
        lastProvider: null,
        passwordSignIn: false,
        passkeys: true,
        ...options,
      },
    }),
    ...overrides,
  });
}

function directoryApi(
  signInName: "email" | "userPrincipalName" | "sAMAccountName" | "uid",
  answer: Handler,
  overrides: Record<string, Handler> = {},
) {
  return signedOutApi(
    {},
    {
      "POST /api/v1/auth/sign-in/discover": () => ({
        body: {
          step: "directory",
          providerId: LDAP,
          name: "Verlag AD",
          preset: "activeDirectory",
          signInName,
        },
      }),
      [`POST /api/v1/auth/providers/${LDAP}/password`]: answer,
      ...overrides,
    },
  );
}

async function enterEmail(email = "lena.hofer@verlag.example") {
  await userEvent.type(await screen.findByLabelText("Work e-mail address or sign-in name"), email);
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
}

function passwordRequests(requests: RecordedRequest[]) {
  return requests.filter((request) => request.path === `/api/v1/auth/providers/${LDAP}/password`);
}

describe("signing in with a directory password", () => {
  it("prefills the Windows user name, refuses an empty password and signs in", async () => {
    let signedIn = false;
    const { requests } = directoryApi(
      "sAMAccountName",
      () => {
        signedIn = true;
        return { body: { status: "signedIn", sessionKind: "full", account: null } };
      },
      {
        "GET /api/v1/auth/session": () =>
          signedIn
            ? {
                body: {
                  sessionKind: "full",
                  account: OLIVIA,
                  methods: ["identityProvider"],
                  recentlyAuthenticated: true,
                },
              }
            : problem(401, "notSignedIn"),
      },
    );
    await renderPath("/sign-in");
    await enterEmail();
    expect(await screen.findByText("verlag.example signs in with Verlag AD")).toBeTruthy();
    const name = screen.getByLabelText("Sign-in name at Verlag AD") as HTMLInputElement;
    expect(name.value).toBe("lena.hofer");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("This field is required.")).toBeTruthy();
    expect(passwordRequests(requests)).toHaveLength(0);

    await userEvent.type(screen.getByLabelText("Password"), "directory password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(passwordRequests(requests)[0]?.body).toEqual({
        signInName: "lena.hofer",
        password: "directory password",
      }),
    );
    await waitFor(() => expect(window.location.pathname).not.toBe("/sign-in"));
  });

  it("uses the e-mail address without asking when the directory signs in with it", async () => {
    const { requests } = directoryApi("email", () => ({
      body: { status: "secondFactorRequired", factors: ["totp"] },
    }));
    await renderPath("/sign-in");
    await enterEmail();
    await userEvent.type(await screen.findByLabelText("Password"), "directory password");
    expect(screen.queryByLabelText("Sign-in name at Verlag AD")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Confirm it's you" })).toBeTruthy();
    expect(passwordRequests(requests)[0]?.body).toEqual({
      signInName: "lena.hofer@verlag.example",
      password: "directory password",
    });
  });

  it("prefills the user principal name and continues with linking an existing account", async () => {
    const { requests } = directoryApi("userPrincipalName", () => ({ body: { status: "linkRequired" } }), {
      "GET /api/v1/auth/link": () => ({
        body: {
          providerName: "Verlag AD",
          email: "lena.hofer@verlag.example",
          accountName: "Lena Hofer",
          factors: ["totp"],
        },
      }),
    });
    await renderPath("/sign-in");
    await enterEmail();
    expect(((await screen.findByLabelText("Sign-in name at Verlag AD")) as HTMLInputElement).value).toBe(
      "lena.hofer@verlag.example",
    );
    await userEvent.type(screen.getByLabelText("Password"), "directory password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Link your Verlag AD account" })).toBeTruthy();
    expect(passwordRequests(requests)).toHaveLength(1);
  });

  it("explains a refused sign-in with its reference", async () => {
    directoryApi("uid", () => ({
      body: { status: "refused", reference: "7KQ2-M9XA", reason: "accountCreationDisabled" },
    }));
    await renderPath("/sign-in");
    await enterEmail();
    expect(((await screen.findByLabelText("Sign-in name at Verlag AD")) as HTMLInputElement).value).toBe(
      "lena.hofer",
    );
    await userEvent.type(screen.getByLabelText("Password"), "directory password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("No account exists for you in Example Wiki")).toBeTruthy();
    expect(screen.getByText("7KQ2-M9XA")).toBeTruthy();
  });

  it.each([
    [401, "invalidCredentials", /The sign-in name or the password is not correct/],
    [
      403,
      "passwordExpired",
      /Your directory password has expired.*Pagehall never changes directory passwords/,
    ],
    [403, "passwordMustChange", /must be changed before you can sign in.*contact IT/],
    [403, "accountLocked", /Your directory account is locked/],
    [403, "accountDisabled", /Your directory account is disabled/],
    [403, "outsideSignInHours", /may not sign in at this time/],
    [429, "locked", /Too many failed attempts/],
    [429, "rateLimited", /Too many requests/],
    [502, "providerUnavailable", /The directory could not be reached.*contact IT/],
  ])("explains %s %s and clears the password", async (status, code, message) => {
    directoryApi("email", () => problem(status, code));
    await renderPath("/sign-in");
    await enterEmail();
    const password = (await screen.findByLabelText("Password")) as HTMLInputElement;
    await userEvent.type(password, "directory password");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Sign-in with Verlag AD did not work")).toBeTruthy();
    expect(screen.getByText(message)).toBeTruthy();
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe("");
  });

  it("asks for the sign-in name when the directory is the only way to sign in", async () => {
    const { requests } = signedOutApi(
      {
        emailStep: false,
        directProvider: {
          id: LDAP,
          type: "ldap",
          name: "Verlag AD",
          preset: "activeDirectory",
          logoRef: null,
        },
      },
      {
        [`POST /api/v1/auth/providers/${LDAP}/password`]: () => ({
          body: { status: "secondFactorRequired", factors: ["totp"] },
        }),
      },
    );
    await renderPath("/sign-in");
    await userEvent.type(await screen.findByLabelText("Sign-in name at Verlag AD"), "lhofer");
    await userEvent.type(screen.getByLabelText("Password"), "directory password");
    expect(screen.queryByRole("button", { name: "Continue with Verlag AD" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Confirm it's you" })).toBeTruthy();
    expect(passwordRequests(requests)[0]?.body).toEqual({
      signInName: "lhofer",
      password: "directory password",
    });
  });

  it("shows the password form for a directory used last instead of a redirect", async () => {
    const { requests } = signedOutApi({
      lastProvider: { id: LDAP, type: "ldap", name: "Verlag AD", preset: "activeDirectory", logoRef: null },
    });
    await renderPath("/sign-in");
    await userEvent.click(await screen.findByRole("button", { name: "Verlag AD" }));
    expect(await screen.findByLabelText("Sign-in name at Verlag AD")).toBeTruthy();
    expect(requests.some((request) => request.path.endsWith("/start"))).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(await screen.findByLabelText("Work e-mail address or sign-in name")).toBeTruthy();
  });

  it("explains that sign-in started at the identity provider is off", async () => {
    signedOutApi({});
    await renderPath("/sign-in?error=providerInitiatedSignIn");
    expect(await screen.findByText(/Start on the Pagehall sign-in page instead/)).toBeTruthy();
  });
});

describe("confirming the identity with a directory password", () => {
  it("asks for the directory password instead of a redirect and repeats the change", async () => {
    let confirmed = false;
    const identity = {
      id: "01929b1e-0000-7000-8000-0000000000c3",
      providerId: LDAP,
      providerType: "ldap",
      providerName: "Verlag AD",
      subject: "6f1b2c3d-0000-4000-8000-000000000001",
      email: "olivia@example.org",
      signInName: "olivia@verlag.example",
      displayName: "Olivia",
      lastSignInAt: null,
      createdAt: "2026-09-01T08:00:00.000Z",
    };
    const { requests } = mockApi({
      "GET /api/v1/instance/info": () => ({ body: INFO }),
      "GET /api/v1/auth/session": () => ({
        body: {
          sessionKind: "full",
          account: OLIVIA,
          methods: ["identityProvider"],
          recentlyAuthenticated: confirmed,
        },
      }),
      "GET /api/v1/organizations": () => ({ body: { items: [], nextCursor: null } }),
      "GET /api/v1/account/permissions": () => ({
        body: { instance: [], organization: [], grantableAreas: { instance: {}, organization: {} } },
      }),
      "GET /api/v1/account/preferences": () => ({ body: [] }),
      "GET /api/v1/notifications/unread-count": () => ({ body: { count: 0 } }),
      "GET /api/v1/account/identities": () => ({
        body: [identity],
      }),
      "GET /api/v1/account/security": () => ({
        body: { totp: false, passkeys: [], recoveryCodes: 0, secondFactorRequired: false },
      }),
      "GET /api/v1/account/sessions": () => ({ body: { items: [], nextCursor: null } }),
      "GET /api/v1/account/tokens": () => ({ body: { items: [], nextCursor: null } }),
      "POST /api/v1/auth/reauthenticate/directory": (request) => {
        if ((request.body as { password: string }).password !== "right password") {
          return problem(401, "invalidCredentials");
        }
        confirmed = true;
        return { status: 204 };
      },
      [`DELETE /api/v1/account/identities/${identity.id}`]: () =>
        confirmed ? { status: 204 } : problem(403, "reauthenticationRequired"),
    });
    await renderPath("/settings/security");
    await userEvent.click(await screen.findByRole("button", { name: "Unlink" }));
    const confirm = await screen.findByRole("dialog", { name: "Unlink Verlag AD?" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Unlink" }));
    const dialog = await screen.findByRole("dialog", { name: "Confirm your identity" });
    expect(within(dialog).queryByRole("button", { name: "Continue with Verlag AD" })).toBeNull();
    await userEvent.type(within(dialog).getByLabelText("Password at Verlag AD"), "wrong password");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm with Verlag AD" }));
    expect(await within(dialog).findByText(/The sign-in name or the password is not correct/)).toBeTruthy();
    await userEvent.type(within(dialog).getByLabelText("Password at Verlag AD"), "right password");
    await userEvent.click(within(dialog).getByRole("button", { name: "Confirm with Verlag AD" }));
    await waitFor(() => expect(requests.filter((request) => request.method === "DELETE")).toHaveLength(2));
    expect(
      requests
        .filter((request) => request.path === "/api/v1/auth/reauthenticate/directory")
        .map((r) => r.body),
    ).toEqual([
      { providerId: LDAP, password: "wrong password" },
      { providerId: LDAP, password: "right password" },
    ]);
  });
});
