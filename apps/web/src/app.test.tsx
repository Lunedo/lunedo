import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "./app.js";
import { initI18n } from "./i18n/index.js";
import { mockApi, problem, type RecordedRequest } from "./testing/render.js";

const ORGANIZATION = {
  id: "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f",
  name: "Platform Team",
  slug: "platform-team",
  logoRef: null,
  language: "en",
  timeZone: "Europe/Vienna",
  accentColor: "violet",
  createdAt: "2026-10-01T08:00:00.000Z",
  membershipKind: "member",
};

const SESSION = {
  sessionKind: "full",
  account: { id: "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c", email: "olivia@example.org", name: "Olivia Owner" },
  methods: ["password", "totp"],
  recentlyAuthenticated: true,
};

function preference(key: string, value: unknown) {
  return {
    key,
    value,
    defaultValue: value,
    source: "default",
    lockedBy: null,
    locked: false,
    lockable: false,
    levelsBelow: [],
    editable: true,
    levels: [],
  };
}

type Reply = { status?: number; body?: unknown };

function api(overrides: Record<string, (request: RecordedRequest) => Reply | Promise<Reply>> = {}) {
  let signedIn = false;
  return mockApi({
    "GET /api/v1/instance/info": () => ({
      body: {
        name: "Example Wiki",
        setupComplete: true,
        language: "en",
        accentColor: "petrol",
        passwordMinLength: 12,
        selfRegistration: false,
        organization: { id: ORGANIZATION.id, name: ORGANIZATION.name, logoRef: null, accentColor: "violet" },
      },
    }),
    "GET /api/v1/auth/session": () => (signedIn ? { body: SESSION } : problem(401, "notSignedIn")),
    "GET /api/v1/auth/sign-in-options": () => ({
      body: {
        providers: [],
        emailStep: true,
        directProvider: null,
        lastProvider: null,
        passwordSignIn: true,
        passkeys: true,
      },
    }),
    "POST /api/v1/auth/sign-in/discover": () => ({ body: { step: "password" } }),
    "POST /api/v1/auth/sign-in": (request) =>
      (request.body as { password: string }).password === "correct horse battery"
        ? { body: { status: "secondFactorRequired", factors: ["totp", "recoveryCode"] } }
        : problem(401, "invalidCredentials"),
    "POST /api/v1/auth/sign-in/second-factor": (request) => {
      if ((request.body as { code: string }).code !== "123456") return problem(401, "invalidSecondFactor");
      signedIn = true;
      return { body: { status: "signedIn", sessionKind: "full", account: SESSION.account } };
    },
    "GET /api/v1/organizations": () => ({ body: { items: [ORGANIZATION], nextCursor: null } }),
    "GET /api/v1/account/permissions": () => ({
      body: { instance: [], organization: ["organization.view", "organization.members.view"] },
    }),
    "GET /api/v1/account/preferences": () => ({
      body: [
        preference("locale.language", "en"),
        preference("appearance.colorMode", "dark"),
        preference("appearance.textSize", 1.25),
      ],
    }),
    "GET /api/v1/notifications/unread-count": () => ({ body: { count: 2 } }),
    ...overrides,
  });
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

async function renderApp(path: string) {
  window.history.replaceState(null, "", path);
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
}

describe("the web client", () => {
  it("sends a signed-out visitor to the sign-in page and back after both factors", async () => {
    const { requests } = api();
    await renderApp("/settings/security");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(new URL(window.location.href).searchParams.get("redirect")).toBe("/settings/security");

    await userEvent.type(
      await screen.findByLabelText("Work e-mail address or sign-in name"),
      "olivia@example.org",
    );
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.type(await screen.findByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText(/The password is not correct\./)).toBeTruthy();

    await userEvent.type(screen.getByLabelText("Password"), "correct horse battery");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Confirm it's you" })).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Code from your authenticator app"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Verify" }));

    expect(await screen.findByRole("heading", { name: "Sign-in and security", level: 1 })).toBeTruthy();
    const signIn = requests.find((request) => request.path === "/api/v1/auth/sign-in");
    expect(signIn?.headers.get("X-Lunedo-Request")).toBe("1");
  });

  it("makes the language chosen on the sign-in page the person's own when they have none", async () => {
    let signedIn = false;
    const { requests } = api({
      "GET /api/v1/auth/session": () => (signedIn ? { body: SESSION } : problem(401, "notSignedIn")),
      "GET /api/v1/account/preferences": () => ({
        body: [{ ...preference("locale.language", "en"), source: "organization" }],
      }),
      "PUT /api/v1/account/preferences/locale.language": () => ({ status: 204 }),
    });
    await renderApp("/sign-in");
    await userEvent.click(await screen.findByRole("button", { name: /^Language: English/ }));
    await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Deutsch" }));
    cleanup();
    signedIn = true;
    await renderApp("/settings/preferences");
    await waitFor(() =>
      expect(
        requests.find((request) => request.path === "/api/v1/account/preferences/locale.language")?.body,
      ).toEqual({ value: "de" }),
    );
  });

  it("switches the appearance on the sign-in page at once and remembers it in the browser", async () => {
    api({ "GET /api/v1/auth/session": () => problem(401, "notSignedIn") });
    await renderApp("/sign-in");
    localStorage.removeItem("lunedo.appearance");
    await userEvent.click(await screen.findByRole("button", { name: /^Appearance: / }));
    await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "Dark" }));
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(JSON.parse(localStorage.getItem("lunedo.appearance") ?? "{}").colorMode).toBe("dark");
    expect(screen.getByRole("button", { name: "Appearance: Dark" })).toBeTruthy();
  });

  it("keeps a person's own language over the one chosen on the sign-in page", async () => {
    const { requests } = api({
      "GET /api/v1/auth/session": () => ({ body: SESSION }),
      "GET /api/v1/account/preferences": () => ({
        body: [{ ...preference("locale.language", "en"), source: "user" }],
      }),
    });
    localStorage.setItem("lunedo.chosenLanguage", "de");
    await renderApp("/settings/preferences");
    expect(await screen.findByRole("heading", { name: "Preferences", level: 1 })).toBeTruthy();
    await waitFor(() => expect(localStorage.getItem("lunedo.chosenLanguage")).toBeNull());
    expect(requests.some((request) => request.method === "PUT")).toBe(false);
  });

  it("applies the preferences and the organization's accent once signed in", async () => {
    api({ "GET /api/v1/auth/session": () => ({ body: SESSION }) });
    await renderApp("/settings/preferences");
    expect(await screen.findByRole("heading", { name: "Preferences", level: 1 })).toBeTruthy();
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    expect(document.documentElement.dataset.accent).toBe("violet");
    expect(document.documentElement.style.getPropertyValue("--ld-text-scale")).toBe("1.25");
    expect(await screen.findByRole("button", { name: "Notifications, 2 unread" })).toBeTruthy();
    const navigation = screen.getByRole("navigation", { name: "Settings" });
    expect(within(navigation).getByRole("heading", { name: "My account" })).toBeTruthy();
    expect(within(navigation).getByRole("link", { name: "Preferences" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(within(navigation).getByRole("link", { name: "Sign-in and security" })).toBeTruthy();
    expect(within(navigation).queryByRole("link", { name: "Members" })).toBeNull();
  });

  it("shows only the entries of the organization area, grouped, with the parent of a detail page active", async () => {
    api({ "GET /api/v1/auth/session": () => ({ body: SESSION }) });
    await renderApp(`/settings/organizations/${ORGANIZATION.id}/members`);
    const navigation = await screen.findByRole("navigation", { name: "Settings" });
    expect(await within(navigation).findByRole("heading", { name: "Platform Team" })).toBeTruthy();
    const group = within(navigation).getByRole("list", { name: "People and access" });
    expect(within(group).getByRole("link", { name: "Members" }).getAttribute("aria-current")).toBe("page");
    expect(within(navigation).queryByRole("link", { name: "Roles" })).toBeNull();
    expect(within(navigation).queryByRole("link", { name: "Preferences" })).toBeNull();
    expect(within(navigation).queryByRole("link", { name: "Organizations" })).toBeNull();
  });

  it("opens the organization settings directly from the gear for an organization admin", async () => {
    api({ "GET /api/v1/auth/session": () => ({ body: SESSION }) });
    await renderApp("/settings/preferences");
    await screen.findByRole("heading", { name: "Preferences", level: 1 });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Settings" }).getAttribute("aria-haspopup")).toBeNull(),
    );
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    await waitFor(() =>
      expect(window.location.pathname).toBe(`/settings/organizations/${ORGANIZATION.id}/members`),
    );
    expect(screen.queryByRole("menuitem")).toBeNull();
  });

  it("offers organization and instance in the gear to people who manage both", async () => {
    api({
      "GET /api/v1/auth/session": () => ({ body: SESSION }),
      "GET /api/v1/account/permissions": () => ({
        body: {
          instance: ["instance.settings.view"],
          organization: ["organization.view", "organization.members.view"],
        },
      }),
    });
    await renderApp("/settings/preferences");
    await screen.findByRole("heading", { name: "Preferences", level: 1 });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Settings" }).getAttribute("aria-haspopup")).toBe("menu"),
    );
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    await waitFor(() =>
      expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
        "Organization",
        "Instance",
      ]),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "Instance" }));
    await waitFor(() => expect(window.location.pathname.startsWith("/settings/instance/")).toBe(true));
  });

  it("shows no gear to people who manage nothing and reaches the own account through the avatar", async () => {
    api({
      "GET /api/v1/auth/session": () => ({ body: SESSION }),
      "GET /api/v1/account/permissions": () => ({ body: { instance: [], organization: [] } }),
      "GET /api/v1/account/profile": () => ({
        body: { name: "Olivia Owner", jobTitle: null, pictureRef: null, nameProvider: null },
      }),
      "GET /api/v1/account/identities": () => ({ body: [] }),
    });
    await renderApp("/settings/preferences");
    await screen.findByRole("heading", { name: "Preferences", level: 1 });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Settings" })).toBeNull());
    await userEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(await screen.findByText(SESSION.account.email)).toBeTruthy();
    await userEvent.click(screen.getByRole("menuitem", { name: "Profile" }));
    expect(await screen.findByRole("heading", { name: "Profile", level: 1 })).toBeTruthy();
    expect(window.location.pathname).toBe("/settings/profile");
  });

  it("opens the profile first, with the name, the e-mail address and the linked sign-ins", async () => {
    api({
      "GET /api/v1/auth/session": () => ({ body: SESSION }),
      "GET /api/v1/account/profile": () => ({
        body: { name: "Olivia Owner", jobTitle: null, pictureRef: null, nameProvider: null },
      }),
      "GET /api/v1/account/identities": () => ({
        body: [
          {
            id: "01929b1e-0000-7000-8000-0000000000a1",
            providerId: "01929b1e-0000-7000-8000-0000000000a2",
            providerName: "Entra ID",
            subject: "tid:oid",
            email: "olivia@example.org",
            signInName: null,
            displayName: "Olivia",
            lastSignInAt: null,
            createdAt: "2026-09-01T08:00:00.000Z",
          },
        ],
      }),
    });
    await renderApp("/settings");
    expect(await screen.findByRole("heading", { name: "Profile", level: 1 })).toBeTruthy();
    expect(window.location.pathname).toBe("/settings/profile");
    const navigation = screen.getByRole("navigation", { name: "Settings" });
    const links = within(navigation).getAllByRole("link");
    expect(links[0]?.textContent).toBe("Back to For you");
    expect(links[0]?.getAttribute("href")).toBe("/home");
    expect(links[1]?.textContent).toBe("Profile");
    expect(links[1]?.getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("navigation", { name: "Main navigation" })).toBeNull();
    expect(((await screen.findByLabelText("Display name")) as HTMLInputElement).value).toBe("Olivia Owner");
    expect(screen.getByText("olivia@example.org", { selector: "[data-setting-hint]" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change e-mail address" })).toBeTruthy();
    expect(await screen.findByText("Entra ID")).toBeTruthy();
  });

  it("lists watched and muted items in two sections with their counts", async () => {
    api({
      "GET /api/v1/auth/session": () => ({ body: SESSION }),
      "GET /api/v1/account/watches": () => ({
        body: {
          items: [
            {
              target: { type: "item", id: "01929b1e-0000-7000-8000-0000000000d1" },
              state: "watching",
              keepActionable: false,
              automatic: false,
              title: "VPN access",
              kind: "page",
              spaceId: "01929b1e-0000-7000-8000-0000000000d0",
              spaceKey: "OPS",
              spaceName: "Operations",
              updatedAt: "2026-10-01T08:00:00.000Z",
            },
            {
              target: { type: "space", id: "01929b1e-0000-7000-8000-0000000000d0" },
              state: "watching",
              keepActionable: false,
              automatic: false,
              title: "Operations",
              kind: "space",
              spaceId: "01929b1e-0000-7000-8000-0000000000d0",
              spaceKey: "OPS",
              spaceName: "Operations",
              updatedAt: "2026-10-01T08:00:00.000Z",
            },
            {
              target: { type: "item", id: "01929b1e-0000-7000-8000-0000000000d2" },
              state: "muted",
              keepActionable: false,
              automatic: false,
              title: "Old notes",
              kind: "page",
              spaceId: "01929b1e-0000-7000-8000-0000000000d0",
              spaceKey: "OPS",
              spaceName: "Operations",
              updatedAt: "2026-10-01T08:00:00.000Z",
            },
          ],
          counts: { watchedItems: 1, watchedSpaces: 1, mutedItems: 1, mutedSpaces: 0 },
        },
      }),
    });
    await renderApp("/settings/notifications/watching");
    const watched = await screen.findByRole("region", { name: "Watching 2" });
    expect(within(watched).getByRole("link", { name: "VPN access" })).toBeTruthy();
    expect(within(watched).getByRole("link", { name: "Operations" })).toBeTruthy();
    expect(within(watched).getAllByRole("button", { name: "Stop watching" })).toHaveLength(2);
    const muted = screen.getByRole("region", { name: "Muted 1" });
    expect(within(muted).getByRole("link", { name: "Old notes" })).toBeTruthy();
    expect(within(muted).getByRole("button", { name: "Unmute" })).toBeTruthy();
  });

  it("searches the settings of every area it shows and offers to clear an empty result", async () => {
    api({ "GET /api/v1/auth/session": () => ({ body: SESSION }) });
    await renderApp("/settings/preferences");
    await screen.findByRole("heading", { name: "Preferences", level: 1 });
    const navigation = screen.getByRole("navigation", { name: "Settings" });
    const search = within(navigation).getByRole("searchbox", { name: "Search settings" });
    await userEvent.type(search, "scales text");
    expect(await screen.findByText("1 setting matches “scales text”")).toBeTruthy();
    const result = screen.getByRole("link", { name: /Text size/ });
    expect(within(result).getByText("Preferences › Display")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Preferences", level: 1 })).toBeNull();
    await userEvent.clear(search);
    await userEvent.type(search, "password policy of the moon");
    expect(await screen.findByText(/No setting matches “password policy of the moon”/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(await screen.findByRole("heading", { name: "Preferences", level: 1 })).toBeTruthy();
    expect((search as HTMLInputElement).value).toBe("");
  });

  it("steps the text size and offers the default only when it differs", async () => {
    const { requests } = api({
      "GET /api/v1/auth/session": () => ({ body: SESSION }),
      "PUT /api/v1/account/preferences/appearance.textSize": () => ({ status: 204 }),
    });
    await renderApp("/settings/preferences");
    const textSize = await screen.findByRole("group", { name: "Text size" });
    expect(await within(textSize).findByText("125%")).toBeTruthy();
    expect(within(textSize).getByRole("button", { name: "Default" })).toBeTruthy();
    expect(within(textSize).getByRole("button", { name: "Increase" }).getAttribute("aria-disabled")).toBe(
      "true",
    );
    await userEvent.click(within(textSize).getByRole("button", { name: "Decrease" }));
    await waitFor(() =>
      expect(
        requests.find((request) => request.path === "/api/v1/account/preferences/appearance.textSize")?.body,
      ).toEqual({ value: 1.125 }),
    );
  });

  it("names the rule that requires the second factor", async () => {
    api({
      "GET /api/v1/auth/session": () => ({ body: SESSION }),
      "GET /api/v1/account/security": () => ({
        body: {
          totp: true,
          passkeys: [],
          recoveryCodes: 8,
          secondFactorRequired: true,
          secondFactorRequiredBy: "instanceOwner",
        },
      }),
      "GET /api/v1/account/sessions": () => ({ body: { items: [], nextCursor: null } }),
      "GET /api/v1/account/tokens": () => ({ body: { items: [], nextCursor: null } }),
    });
    await renderApp("/settings/security");
    expect(
      await screen.findByText("As the owner of this instance you need a second factor. Keep at least one."),
    ).toBeTruthy();
    expect(screen.queryByText(/Your organization requires/)).toBeNull();
  });

  it("asks for the identity before a sensitive change and repeats it", async () => {
    let confirmed = false;
    const { requests } = api({
      "GET /api/v1/auth/session": () => ({ body: SESSION }),
      "GET /api/v1/account/security": () => ({
        body: {
          totp: true,
          passkeys: [],
          recoveryCodes: 8,
          secondFactorRequired: true,
          secondFactorRequiredBy: "organization",
        },
      }),
      "GET /api/v1/account/sessions": () => ({ body: { items: [], nextCursor: null } }),
      "GET /api/v1/account/tokens": () => ({ body: { items: [], nextCursor: null } }),
      "POST /api/v1/account/password": () =>
        confirmed ? { status: 204 } : problem(403, "reauthenticationRequired"),
      "POST /api/v1/auth/reauthenticate": () => {
        confirmed = true;
        return { status: 204 };
      },
    });
    await renderApp("/settings/security");
    await userEvent.click(await screen.findByRole("button", { name: "Change password" }));
    const dialog = screen.getByRole("dialog", { name: "Change password" });
    await userEvent.type(within(dialog).getByLabelText("New password"), "a new long passphrase");
    await userEvent.type(within(dialog).getByLabelText("Repeat the password"), "a new long passphrase");
    await userEvent.click(within(dialog).getByRole("button", { name: "Change password" }));

    const confirm = await within(dialog).findByRole("region", { name: "Confirm your identity" });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    await userEvent.type(within(confirm).getByLabelText("Password"), "correct horse battery");
    await userEvent.click(within(confirm).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Change password" })).toBeNull());
    const changes = requests.filter((request) => request.path === "/api/v1/account/password");
    expect(changes).toHaveLength(2);
    expect(requests.find((request) => request.path === "/api/v1/auth/reauthenticate")?.body).toEqual({
      method: "password",
      password: "correct horse battery",
    });
  });

  it("binds a personal token to the organization only when asked and never with instance areas", async () => {
    const created = {
      status: 201,
      body: {
        id: "01929b1e-0000-7000-8000-0000000000f8",
        name: "Ops",
        token: "ld_created_secret",
        scopes: { organization: { membersAndGroups: "view" } },
        contentLevel: "read",
        knowledgeBaseIds: null,
        expiresAt: null,
        lastUsedAt: null,
        createdAt: "2026-10-01T08:00:00.000Z",
      },
    };
    const { requests } = api({
      "GET /api/v1/auth/session": () => ({ body: SESSION }),
      "GET /api/v1/account/permissions": () => ({
        body: { instance: ["instance.settings.view"], organization: ["organization.view"] },
      }),
      "GET /api/v1/account/security": () => ({
        body: {
          totp: false,
          passkeys: [],
          recoveryCodes: 0,
          secondFactorRequired: false,
          secondFactorRequiredBy: null,
        },
      }),
      "GET /api/v1/account/sessions": () => ({ body: { items: [], nextCursor: null } }),
      "GET /api/v1/account/tokens": () => ({ body: { items: [], nextCursor: null } }),
      "POST /api/v1/account/tokens": () => created,
    });
    const tokenBodies = () =>
      requests
        .filter((request) => request.method === "POST" && request.path === "/api/v1/account/tokens")
        .map((request) => request.body as { organizationId?: string; scopes: Record<string, unknown> });
    await renderApp("/settings/security");

    await userEvent.click(await screen.findByRole("button", { name: "Create token" }));
    let dialog = await screen.findByRole("dialog", { name: "Create API token" });
    await userEvent.type(within(dialog).getByLabelText("Name"), "Ops");
    const appliesTo = within(dialog).getByRole("radiogroup", { name: "Applies to" });
    expect(
      within(appliesTo)
        .getByRole("radio", { name: `Only ${ORGANIZATION.name}` })
        .getAttribute("aria-checked"),
    ).toBe("true");
    await userEvent.click(
      within(within(dialog).getByRole("radiogroup", { name: "Members and groups" })).getByRole("radio", {
        name: "View",
      }),
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Create token" }));
    await waitFor(() => expect(tokenBodies()).toHaveLength(1));
    expect(tokenBodies()[0]?.organizationId).toBe(ORGANIZATION.id);
    await userEvent.click(await within(dialog).findByRole("button", { name: "Done" }));

    await userEvent.click(screen.getByRole("button", { name: "Create token" }));
    dialog = await screen.findByRole("dialog", { name: "Create API token" });
    await userEvent.type(within(dialog).getByLabelText("Name"), "Ops everywhere");
    await userEvent.click(
      within(within(dialog).getByRole("radiogroup", { name: "Members and groups" })).getByRole("radio", {
        name: "View",
      }),
    );
    const instanceSettings = within(
      within(dialog).getByRole("group", { name: "Access to the instance" }),
    ).getByRole("radiogroup", { name: "Settings" });
    expect(within(instanceSettings).getByRole("radio", { name: "View" }).hasAttribute("disabled")).toBe(true);
    expect(within(dialog).getByText(/Instance rights belong to no single organization/)).toBeTruthy();
    await userEvent.click(
      within(within(dialog).getByRole("radiogroup", { name: "Applies to" })).getByRole("radio", {
        name: "All my organizations",
      }),
    );
    await userEvent.click(
      within(
        within(within(dialog).getByRole("group", { name: "Access to the instance" })).getByRole(
          "radiogroup",
          {
            name: "Settings",
          },
        ),
      ).getByRole("radio", {
        name: "View",
      }),
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Create token" }));
    await waitFor(() => expect(tokenBodies()).toHaveLength(2));
    expect(tokenBodies()[1]).not.toHaveProperty("organizationId");
    expect(tokenBodies()[1]?.scopes).toMatchObject({
      instance: { settings: "view" },
      organization: { membersAndGroups: "view" },
    });
    expect(tokenBodies()[1]).not.toHaveProperty("limitedToOrganization");
  });

  it("asks for the identity inside the token dialog instead of opening a second dialog", async () => {
    let confirmed = false;
    api({
      "GET /api/v1/auth/session": () => ({ body: SESSION }),
      "GET /api/v1/account/security": () => ({
        body: {
          totp: false,
          passkeys: [],
          recoveryCodes: 0,
          secondFactorRequired: false,
          secondFactorRequiredBy: null,
        },
      }),
      "GET /api/v1/account/sessions": () => ({ body: { items: [], nextCursor: null } }),
      "GET /api/v1/account/tokens": () => ({ body: { items: [], nextCursor: null } }),
      "POST /api/v1/account/tokens": () =>
        confirmed
          ? {
              status: 201,
              body: {
                id: "01929b1e-0000-7000-8000-0000000000f9",
                name: "Chatbot",
                token: "ld_created_secret",
                scopes: { organization: { members: "view" } },
                contentLevel: "read",
                knowledgeBaseIds: null,
                expiresAt: null,
                lastUsedAt: null,
                createdAt: "2026-10-01T08:00:00.000Z",
              },
            }
          : problem(403, "reauthenticationRequired"),
      "POST /api/v1/auth/reauthenticate": () => {
        confirmed = true;
        return { status: 204 };
      },
    });
    await renderApp("/settings/security");
    await userEvent.click(await screen.findByRole("button", { name: "Create token" }));
    const dialog = await screen.findByRole("dialog", { name: "Create API token" });
    await userEvent.type(within(dialog).getByLabelText("Name"), "Chatbot");
    await userEvent.click(
      within(within(dialog).getByRole("radiogroup", { name: "Members and groups" })).getByRole("radio", {
        name: "View",
      }),
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Create token" }));
    const confirm = await within(dialog).findByRole("region", { name: "Confirm your identity" });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    await userEvent.type(within(confirm).getByLabelText("Password"), "correct horse battery");
    await userEvent.click(within(confirm).getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("ld_created_secret")).toBeTruthy();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });
});

describe("the shell while it loads", () => {
  it("appears only once permissions and notices are known, so nothing moves afterwards", async () => {
    let release: () => void = () => {};
    const permissions = new Promise<void>((resolve) => {
      release = resolve;
    });
    api({
      "GET /api/v1/auth/session": () => ({ body: SESSION }),
      "GET /api/v1/account/permissions": async () => {
        await permissions;
        return { body: { instance: ["instance.settings.view"], organization: ["organization.view"] } };
      },
      "GET /api/v1/announcements": () => ({
        body: [
          {
            id: "01929b1e-0000-7000-8000-0000000000f1",
            scope: "instance",
            organizationId: null,
            version: "1",
            severity: "warning",
            text: "Planned update tonight",
            link: null,
            startsAt: "2020-01-01T00:00:00.000Z",
            endsAt: "2999-01-01T00:00:00.000Z",
            dismissed: false,
          },
        ],
      }),
    });
    await renderApp("/settings/preferences");
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).not.toBeNull());
    expect(screen.queryByRole("button", { name: "Create" })).toBeNull();
    expect(screen.queryByText("Planned update tonight")).toBeNull();
    release();
    expect(await screen.findByRole("button", { name: "Create" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Settings" })).toBeTruthy();
    expect(screen.getByText("Planned update tonight")).toBeTruthy();
  });
});

describe("the search", () => {
  it("opens the same search with commands from the top bar field and with Ctrl K", async () => {
    api({
      "GET /api/v1/auth/session": () => ({ body: SESSION }),
      "GET /api/v1/account/permissions": () => ({
        body: { instance: [], organization: ["organization.view"] },
      }),
    });
    await renderApp("/settings/preferences");
    await screen.findByRole("heading", { name: "Preferences", level: 1 });
    await userEvent.click(screen.getAllByRole("button", { name: "Search" })[0] as HTMLElement);
    const fromField = await screen.findByRole("dialog", { name: "Search" });
    expect(within(fromField).getByRole("group", { name: "Actions" })).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await userEvent.keyboard("{Control>}k{/Control}");
    const fromKeys = await screen.findByRole("dialog", { name: "Search" });
    expect(within(fromKeys).getByRole("group", { name: "Actions" })).toBeTruthy();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("names the scope of settings pages that share a name", async () => {
    api({
      "GET /api/v1/auth/session": () => ({ body: SESSION }),
      "GET /api/v1/account/permissions": () => ({
        body: {
          instance: ["instance.settings.view"],
          organization: ["organization.view", "organization.settings.view"],
        },
      }),
      "GET /api/v1/search/quick": () => ({ body: { results: [] } }),
    });
    await renderApp("/settings/preferences");
    await screen.findByRole("heading", { name: "Preferences", level: 1 });
    await userEvent.keyboard("{Control>}k{/Control}");
    await userEvent.type(await screen.findByRole("combobox"), "notifcations");
    await waitFor(() =>
      expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(
        expect.arrayContaining([
          "Notifications · Personal",
          "Notifications · Organization",
          "Notifications · Instance",
        ]),
      ),
    );
  });
});
