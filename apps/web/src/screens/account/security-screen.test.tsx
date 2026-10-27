import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "../../api/queries.js";
import { PreferencesProvider } from "../../preferences/preferences-provider.js";
import { mockApi, renderWithProviders } from "../../testing/render.js";
import { SignInSection, TwoFactorSection } from "./security-screen.js";

const session = {
  sessionKind: "full",
  account: {
    id: "01929b1e-0000-7000-8000-0000000000a1",
    email: "ada@example.org",
    name: "Ada Lovelace",
    pictureRef: null,
    type: "standard",
    homeOrganizationId: null,
  },
  methods: ["identityProvider"],
  recentlyAuthenticated: false,
};

function overview(managedBy: Record<string, string> | null) {
  return {
    totp: false,
    passkeys: [],
    recoveryCodes: 0,
    secondFactorRequired: false,
    secondFactorRequiredBy: null,
    managedBy,
  };
}

function managedBy(providerType: string, providerName: string) {
  return {
    providerId: "01929b1f-1b7e-7b62-938f-7a6b5c4d9e0f",
    providerName,
    providerType,
    source: "domain",
    since: "2026-09-14T07:45:00.000Z",
  };
}

async function renderSections(security: ReturnType<typeof overview>) {
  mockApi({
    "GET /api/v1/auth/session": () => ({ body: session }),
    "GET /api/v1/account/security": () => ({ body: security }),
    "GET /api/v1/account/preferences": () => ({ body: [] }),
    "GET /api/v1/instance/info": () => ({
      body: { name: "Example Wiki", setupComplete: true, passwordMinLength: 12 },
    }),
  });
  const root = createRootRoute({
    component: () => (
      <PreferencesProvider>
        <SignInSection withEmail />
        <TwoFactorSection />
      </PreferencesProvider>
    ),
  });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) });
  await renderWithProviders(<RouterProvider router={router} />, "en", (queryClient) =>
    queryClient.setQueryData(queryKeys.session, session),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sign-in and security of the own account", () => {
  it("shows the password, the e-mail address and the second factors of a local account", async () => {
    await renderSections(overview(null));
    expect(await screen.findByRole("button", { name: "Change password" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change e-mail address" })).toBeTruthy();
    expect(await screen.findByText("Authenticator app")).toBeTruthy();
    expect(screen.queryByText(/Signed in through/)).toBeNull();
  });

  it("names the provider instead of password and second factors for an account of an OpenID Connect provider", async () => {
    await renderSections(overview(managedBy("oidc", "Company login")));
    expect(await screen.findByText("Signed in through Company login")).toBeTruthy();
    expect(screen.getByText("Password and second factor are managed there.")).toBeTruthy();
    expect(screen.getByText("From Company login. Change it there.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Change password" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change e-mail address" })).toBeNull();
    expect(screen.queryByText("Authenticator app")).toBeNull();
    expect(screen.queryByText("Passkeys")).toBeNull();
    expect(screen.queryByText("Recovery codes")).toBeNull();
  });

  it("keeps the second factor but not the password for an account of a directory", async () => {
    await renderSections(overview(managedBy("ldap", "Verlag AD")));
    expect(await screen.findByText("Signed in through Verlag AD")).toBeTruthy();
    expect(screen.getByText("Password there, second factor in Lunedo.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Change password" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change e-mail address" })).toBeNull();
    expect(await screen.findByText("Authenticator app")).toBeTruthy();
    expect(screen.getByText("Passkeys")).toBeTruthy();
  });
});
