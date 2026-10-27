import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "../../app.js";
import { initI18n } from "../../i18n/index.js";
import { mockApi, problem, type RecordedRequest } from "../../testing/render.js";

const OIDC = "01929b1e-0000-7000-8000-0000000000b1";
const LDAP = "01929b1e-0000-7000-8000-0000000000b2";
const GONE = "01929b1e-0000-7000-8000-0000000000b3";

type Handler = (request: RecordedRequest) => { status?: number; body?: unknown };

const INFO = {
  name: "Example Wiki",
  setupComplete: true,
  language: "en",
  accentColor: "petrol",
  passwordMinLength: 12,
  selfRegistration: false,
  organization: null,
};

const PROVIDERS = [
  { id: OIDC, type: "oidc", name: "Company login", preset: "generic", logoRef: null },
  { id: LDAP, type: "ldap", name: "Verlag AD", preset: "activeDirectory", logoRef: null },
];

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
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

function signInApi(
  refusal: { providerId: string; providerName: string },
  overrides: Record<string, Handler> = {},
) {
  return mockApi({
    "GET /api/v1/instance/info": () => ({ body: INFO }),
    "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
    "GET /api/v1/auth/sign-in-options": () => ({
      body: { providers: PROVIDERS, lastProvider: null, passkeys: true },
    }),
    "POST /api/v1/auth/sign-in/discover": () => ({ body: { step: "password" } }),
    "POST /api/v1/auth/sign-in": () => problem(403, "managedAccount", refusal),
    [`POST /api/v1/auth/providers/${OIDC}/start`]: () => ({
      body: { url: "https://login.example/authorize" },
    }),
    ...overrides,
  });
}

async function signInWithPassword(email = "ada@example.org") {
  window.history.replaceState(null, "", "/sign-in");
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
  await userEvent.type(await screen.findByLabelText("Work e-mail address or sign-in name"), email);
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  await userEvent.type(await screen.findByLabelText("Password"), "a long enough passphrase");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("signing in with a password to a managed account", () => {
  it("names the provider and continues there instead of asking for the password again", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    signInApi({ providerId: OIDC, providerName: "Company login" });
    await signInWithPassword();

    expect(await screen.findByText("Sign in through Company login")).toBeTruthy();
    expect(
      screen.getByText(
        "This account signs in through Company login, not with a password in Lunedo. Continue there.",
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.queryByRole("link", { name: "Forgot password?" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Continue with Company login" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://login.example/authorize"));
  });

  it("opens the directory form with the e-mail address for an account of a directory", async () => {
    signInApi({ providerId: LDAP, providerName: "Verlag AD" });
    await signInWithPassword("lena.hofer@verlag.example");

    await userEvent.click(await screen.findByRole("button", { name: "Continue with Verlag AD" }));
    expect(await screen.findByLabelText("Sign-in name at Verlag AD")).toBeTruthy();
    expect(screen.queryByText("Sign in through Verlag AD")).toBeNull();
  });

  it("explains a provider that is not offered and lets the person use another account", async () => {
    signInApi({ providerId: GONE, providerName: "Old login" });
    await signInWithPassword();

    expect(
      await screen.findByText(
        "This account signs in through Old login, which is not available at the moment. Ask your administrator.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue with Old login" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Use another account" }));
    expect(await screen.findByLabelText("Work e-mail address or sign-in name")).toBeTruthy();
    expect(screen.queryByText("Sign in through Old login")).toBeNull();
  });
});
