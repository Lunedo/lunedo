import { randomBytes, randomInt } from "node:crypto";
import {
  type APIRequestContext,
  type APIResponse,
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { BASE_URL, OWNER, OWNER_STORAGE, readState } from "../support/environment.js";
import {
  addVirtualAuthenticator,
  freshTotp,
  linkFrom,
  signInWithPassword,
  waitForMail,
} from "../support/helpers.js";
import { keycloak, type NewTestUser, newTestUser, TEST_DOMAIN } from "../support/idp.js";
import {
  createUser as createLdapUser,
  deleteUser as deleteLdapUser,
  LDAP_BASE,
  LDAP_DOMAIN,
  LDAP_PASSWORD,
  LDAP_SERVICE,
  LDAP_URL,
} from "../support/ldap.js";
import { deleteProvider } from "../support/providers.js";
import { waitForSignInBudget } from "../support/throttle.js";

const headers = { "X-Lunedo-Request": "1", origin: BASE_URL };

function clientAddress(): string {
  return `10.${randomInt(1, 255)}.${randomInt(1, 255)}.${randomInt(1, 255)}`;
}

function unique(): string {
  return randomBytes(5).toString("hex");
}

async function freshContext(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { "x-forwarded-for": clientAddress() },
  });
  return { context, page: await context.newPage() };
}

let reauthenticated = false;

async function ownerApi(
  browser: Browser,
): Promise<{ request: APIRequestContext; close: () => Promise<void> }> {
  const context = await browser.newContext({
    storageState: OWNER_STORAGE,
    extraHTTPHeaders: { "x-forwarded-for": clientAddress() },
  });
  if (!reauthenticated) {
    await waitForSignInBudget(OWNER.email, 1);
    const response = await context.request.post("/api/v1/auth/reauthenticate", {
      data: { method: "password", password: OWNER.password },
      headers,
    });
    expect(response.status(), await response.text()).toBeLessThan(300);
    await context.storageState({ path: OWNER_STORAGE });
    reauthenticated = true;
  }
  return { request: context.request, close: () => context.close() };
}

async function body<T>(response: APIResponse, status: number): Promise<T> {
  const text = await response.text();
  expect(response.status(), text).toBe(status);
  return (text === "" ? undefined : JSON.parse(text)) as T;
}

async function call<T>(request: APIRequestContext, path: string, data: unknown = {}): Promise<T> {
  const response = await request.post(path, { headers, data });
  const text = await response.text();
  expect(response.status(), `POST ${path}: ${text}`).toBeLessThan(300);
  return (text === "" ? undefined : JSON.parse(text)) as T;
}

async function problemCode(response: APIResponse): Promise<string> {
  return ((await response.json()) as { code?: string }).code ?? `status ${response.status()}`;
}

async function firstOrganization(request: APIRequestContext): Promise<string> {
  const response = await request.get("/api/v1/organizations");
  return (await body<{ items: { id: string }[] }>(response, 200)).items[0]?.id ?? "";
}

async function createLocalAccount(
  browser: Browser,
  email: string,
): Promise<{ id: string; email: string; password: string }> {
  const password = `local passphrase ${unique()}`;
  const owner = await ownerApi(browser);
  const organizationId = await firstOrganization(owner.request);
  await call(owner.request, `/api/v1/organizations/${organizationId}/invitations`, { email, kind: "member" });
  await owner.close();
  const token = /#token=([\w-]+)/.exec(linkFrom((await waitForMail(email, /invit/i)).text))?.[1] ?? "";
  const { context } = await freshContext(browser);
  const { accountId } = await call<{ accountId: string }>(context.request, "/api/v1/invitations/accept", {
    token,
    name: `Local ${unique()}`,
    password,
  });
  await context.close();
  return { id: accountId, email, password };
}

async function passwordSignIn(
  browser: Browser,
  email: string,
  password: string,
): Promise<{ status: number; code: string | null; outcome: string | null }> {
  const { context } = await freshContext(browser);
  const response = await context.request.post("/api/v1/auth/sign-in", {
    headers,
    data: { email, password },
  });
  const result = (await response.json()) as { code?: string; status?: string };
  await context.close();
  return { status: response.status(), code: result.code ?? null, outcome: result.status ?? null };
}

async function addAuthenticatorApp(request: APIRequestContext): Promise<string> {
  const { secret } = await call<{ secret: string }>(request, "/api/v1/account/totp");
  await call(request, "/api/v1/account/totp/confirm", { code: await freshTotp(secret) });
  return secret;
}

interface JsonCredentials {
  parseCreationOptionsFromJSON(options: unknown): CredentialCreationOptions["publicKey"];
}

async function addPasskey(context: BrowserContext, page: Page): Promise<void> {
  await page.goto("/api/v1/auth/session");
  const remove = await addVirtualAuthenticator(context, page);
  const options = await call<unknown>(context.request, "/api/v1/account/passkeys/registration-options");
  const response = await page.evaluate(async (json) => {
    const parser = PublicKeyCredential as unknown as JsonCredentials;
    const credential = (await navigator.credentials.create({
      publicKey: parser.parseCreationOptionsFromJSON(json),
    })) as PublicKeyCredential & { toJSON(): unknown };
    return credential.toJSON();
  }, options);
  await call(context.request, "/api/v1/account/passkeys", { name: `Key ${unique()}`, response });
  await remove();
}

async function createKeycloakProvider(
  request: APIRequestContext,
  name: string,
  domains: string[],
): Promise<string> {
  const response = await request.post("/api/v1/instance/identity-providers", {
    headers,
    data: {
      type: "oidc",
      name,
      config: {
        preset: "generic",
        clientId: keycloak.clientId,
        issuer: keycloak.issuer,
        domains,
        scopes: keycloak.scopes.split(" "),
        accountCreation: { enabled: true, requiredGroups: [] },
        claims: {
          email: "email",
          signInName: "preferred_username",
          displayName: "name",
          groups: "groups",
          groupNames: "group_names",
        },
      },
      credential: { kind: "clientSecret", secret: keycloak.clientSecret, expiresAt: null },
    },
  });
  return (await body<{ provider: { id: string } }>(response, 201)).provider.id;
}

async function signedIn(page: Page): Promise<void> {
  await page.waitForURL(
    (url) => url.origin === new URL(BASE_URL).origin && !/^\/(sign-in|api)(\/|$)/.test(url.pathname),
  );
}

async function signInAtKeycloak(page: Page, providerName: string, user: NewTestUser): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Work e-mail address or sign-in name").fill(user.email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: `Continue with ${providerName}` }).click();
  await keycloak.signIn(page, user.username);
  await signedIn(page);
}

async function discover(
  request: APIRequestContext,
  email: string,
): Promise<{ step: string; providerId?: string }> {
  return call(request, "/api/v1/auth/sign-in/discover", { email });
}

async function enterAuthenticatorCode(page: Page, secret: string): Promise<void> {
  await page.getByLabel("Code from your authenticator app").fill(await freshTotp(secret));
  await page.getByRole("button", { name: "Verify" }).click();
}

async function sessionOf(request: APIRequestContext): Promise<{
  sessionKind: string;
  methods: string[];
  account: { id: string; email: string };
}> {
  return body(await request.get("/api/v1/auth/session"), 200);
}

test.describe("accounts managed by an identity provider", () => {
  const providers: string[] = [];
  const keycloakUsers: string[] = [];
  const ldapUsers: string[] = [];

  async function keycloakUser(prefix: string): Promise<NewTestUser> {
    const user = newTestUser(prefix);
    keycloakUsers.push(user.username);
    await keycloak.createUser(user);
    return user;
  }

  async function keycloakProvider(
    browser: Browser,
    domains = [TEST_DOMAIN],
  ): Promise<{ id: string; name: string }> {
    const name = `E2E Keycloak ${unique()}`;
    const owner = await ownerApi(browser);
    const id = await createKeycloakProvider(owner.request, name, domains);
    providers.push(id);
    await owner.close();
    return { id, name };
  }

  test.afterEach(async ({ browser }) => {
    const owner = await ownerApi(browser);
    for (const id of providers.splice(0)) await deleteProvider(owner.request, headers, id);
    await owner.close();
    for (const username of keycloakUsers.splice(0)) await keycloak.deleteUser(username);
    for (const uid of ldapUsers.splice(0)) await deleteLdapUser(uid, ["staff"]);
  });

  test("an OpenID Connect account signs in only through its provider", async ({ browser }) => {
    const user = await keycloakUser("managed");
    const provider = await keycloakProvider(browser);

    const first = await freshContext(browser);
    await signInAtKeycloak(first.page, provider.name, user);
    const session = await sessionOf(first.context.request);
    expect(session.account.email).toBe(user.email);
    expect(session.sessionKind).toBe("full");
    for (const path of ["/api/v1/account/totp", "/api/v1/account/passkeys/registration-options"]) {
      const refused = await first.context.request.post(path, { headers, data: {} });
      expect(refused.status(), path).toBe(403);
      expect(await problemCode(refused), path).toBe("managedAccount");
    }
    const changed = await first.context.request.post("/api/v1/account/password", {
      headers,
      data: { password: `a new passphrase ${unique()}` },
    });
    expect(changed.status()).toBe(403);
    expect(await problemCode(changed)).toBe("managedAccount");
    await first.context.close();

    const anonymous = await freshContext(browser);
    expect(await discover(anonymous.context.request, user.email)).toMatchObject({
      step: "provider",
      providerId: provider.id,
    });
    const refused = await passwordSignIn(browser, user.email, `a guessed passphrase ${unique()}`);
    expect(refused).toMatchObject({ status: 401, code: "invalidCredentials" });

    await anonymous.page.goto("/sign-in");
    await anonymous.page.getByLabel("Work e-mail address or sign-in name").fill(user.email);
    await anonymous.page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(
      anonymous.page.getByRole("button", { name: `Continue with ${provider.name}` }),
    ).toBeVisible();
    await expect(anonymous.page.getByLabel("Password", { exact: true })).toHaveCount(0);
    await anonymous.context.close();

    const again = await freshContext(browser);
    await signInAtKeycloak(again.page, provider.name, user);
    expect((await sessionOf(again.context.request)).account.email).toBe(user.email);
    await again.context.close();
  });

  test("a local account signs in with password and authenticator app while a provider is active", async ({
    browser,
  }) => {
    await keycloakProvider(browser);
    const local = await createLocalAccount(browser, `local-${unique()}@lunedo.test`);
    const setup = await freshContext(browser);
    await call(setup.context.request, "/api/v1/auth/sign-in", {
      email: local.email,
      password: local.password,
    });
    const secret = await addAuthenticatorApp(setup.context.request);
    await setup.context.close();

    const { context, page } = await freshContext(browser);
    expect(await discover(context.request, local.email)).toMatchObject({ step: "password" });
    await page.goto("/sign-in");
    await signInWithPassword(page, local.email, local.password);
    await enterAuthenticatorCode(page, secret);
    await signedIn(page);
    const session = await sessionOf(context.request);
    expect(session.account.id).toBe(local.id);
    expect(session.sessionKind).toBe("full");
    expect(session.methods).toEqual(expect.arrayContaining(["password", "totp"]));
    await context.close();
  });

  test("a directory account signs in with its directory password and a Lunedo second factor", async ({
    browser,
  }) => {
    const owner = await ownerApi(browser);
    const created = await owner.request.post("/api/v1/instance/identity-providers", {
      headers,
      data: {
        type: "ldap",
        name: `E2E Directory ${unique()}`,
        config: {
          preset: "generic",
          url: LDAP_URL,
          bindDn: LDAP_SERVICE.dn,
          userBaseDn: LDAP_BASE.users,
          groupBaseDn: LDAP_BASE.groups,
          domains: [LDAP_DOMAIN],
          accountCreation: { enabled: true, requiredGroups: [] },
          secondFactor: { mode: "lunedo" },
          disabled: { attribute: "employeeType", values: ["disabled"] },
          sync: { intervalMinutes: 60, deactivationLimitPercent: 100 },
        },
        credential: { kind: "bindPassword", secret: LDAP_SERVICE.password },
      },
    });
    const providerId = (await body<{ provider: { id: string } }>(created, 201)).provider.id;
    providers.push(providerId);
    const groups = await owner.request.get(
      `/api/v1/instance/identity-providers/${providerId}/groups?q=staff`,
    );
    const staff = (await body<{ id: string; name: string | null }[]>(groups, 200)).find(
      (group) => group.name === "staff",
    );
    if (!staff) throw new Error("The directory has no group named staff");
    await call(owner.request, `/api/v1/instance/identity-providers/${providerId}/mapping-rules`, {
      target: "organization",
      group: { id: staff.id, name: "staff" },
      organizationId: await firstOrganization(owner.request),
      role: null,
      synchronizedGroup: false,
      homeOrganization: true,
    });
    await owner.close();
    const uid = `member-${unique()}`;
    ldapUsers.push(uid);
    await createLdapUser(uid, { groups: ["staff"] });
    const email = `${uid}@${LDAP_DOMAIN}`;

    async function directorySignIn(page: Page) {
      await page.goto("/sign-in");
      await page.getByLabel("Work e-mail address or sign-in name").fill(email);
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByLabel("Password", { exact: true }).fill(LDAP_PASSWORD);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
    }

    const first = await freshContext(browser);
    await directorySignIn(first.page);
    await expect(first.page).toHaveURL(/\/second-factor-setup/);
    expect((await sessionOf(first.context.request)).sessionKind).toBe("secondFactorSetup");
    const secret = await addAuthenticatorApp(first.context.request);
    await call(first.context.request, "/api/v1/auth/sign-out");
    await first.context.close();

    const refused = await passwordSignIn(browser, email, LDAP_PASSWORD);
    expect(refused).toMatchObject({ status: 401, code: "invalidCredentials" });

    const { context, page } = await freshContext(browser);
    await directorySignIn(page);
    await enterAuthenticatorCode(page, secret);
    await signedIn(page);
    await expect(page).not.toHaveURL(/\/second-factor-setup/);
    const session = await sessionOf(context.request);
    expect(session.account.email).toBe(email);
    expect(session.sessionKind).toBe("full");
    const security = await body<{ totp: boolean }>(
      await context.request.get("/api/v1/account/security"),
      200,
    );
    expect(security.totp).toBe(true);
    await context.close();
  });

  test("a local account becomes managed at its first sign-in through the provider", async ({ browser }) => {
    const user = newTestUser("takeover");
    const local = await createLocalAccount(browser, user.email);
    const before = await freshContext(browser);
    await call(before.context.request, "/api/v1/auth/sign-in", {
      email: local.email,
      password: local.password,
    });
    await addAuthenticatorApp(before.context.request);
    await addPasskey(before.context, before.page);
    const factors = await body<{ totp: boolean; passkeys: unknown[]; recoveryCodes: number }>(
      await before.context.request.get("/api/v1/account/security"),
      200,
    );
    expect(factors.totp).toBe(true);
    expect(factors.passkeys).toHaveLength(1);

    keycloakUsers.push(user.username);
    await keycloak.createUser(user);
    const provider = await keycloakProvider(browser);

    const managedByDomain = await passwordSignIn(browser, local.email, local.password);
    expect(managedByDomain).toMatchObject({ status: 403, code: "managedAccount" });

    const { context, page } = await freshContext(browser);
    await signInAtKeycloak(page, provider.name, user);
    const session = await sessionOf(context.request);
    expect(session.account.id).toBe(local.id);
    expect(session.sessionKind).toBe("full");
    const security = await body<{ totp: boolean; passkeys: unknown[]; recoveryCodes: number }>(
      await context.request.get("/api/v1/account/security"),
      200,
    );
    expect(security).toMatchObject({ totp: false, passkeys: [], recoveryCodes: 0 });
    await context.close();

    expect((await before.context.request.get("/api/v1/auth/session")).status()).toBe(401);
    await before.context.close();

    for (const password of [local.password, `a guessed passphrase ${unique()}`]) {
      const refused = await passwordSignIn(browser, local.email, password);
      expect(refused).toMatchObject({ status: 401, code: "invalidCredentials" });
    }

    const mail = await waitForMail(local.email, /now signs in through/);
    expect(mail.text).toContain(provider.name);

    const owner = await ownerApi(browser);
    const events = await body<{
      items: { name: string; targetId: string | null; fields: Record<string, unknown> }[];
    }>(
      await owner.request.get(
        `/api/v1/instance/audit-events?name=account.localCredentialsRemoved&targetType=account&targetId=${local.id}`,
      ),
      200,
    );
    expect(events.items).toHaveLength(1);
    expect(events.items[0]?.fields).toMatchObject({
      providerId: provider.id,
      localSignIn: true,
      authenticatorApp: true,
      passkeys: 1,
    });
    await owner.close();
  });

  test("the instance owner signs in with password and second factor while the provider is down", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const domain = `down-${unique()}.example.com`;
    const local = await createLocalAccount(browser, `person-${unique()}@${domain}`);
    const owner = await ownerApi(browser);
    const created = await owner.request.post("/api/v1/instance/identity-providers", {
      headers,
      data: {
        type: "oidc",
        name: `E2E Unreachable ${unique()}`,
        config: {
          preset: "generic",
          clientId: "lunedo",
          issuer: "http://unreachable.localhost:9/realms/none",
          domains: [domain],
          scopes: ["openid", "email", "profile"],
          accountCreation: { enabled: false, requiredGroups: [] },
        },
        credential: { kind: "clientSecret", secret: `secret-${unique()}`, expiresAt: null },
      },
    });
    const providerId = (await body<{ provider: { id: string } }>(created, 201)).provider.id;
    providers.push(providerId);
    await owner.close();

    const anonymous = await freshContext(browser);
    expect(await discover(anonymous.context.request, local.email)).toMatchObject({
      step: "provider",
      providerId,
    });
    const started = await anonymous.context.request.post(`/api/v1/auth/providers/${providerId}/start`, {
      headers,
      data: {},
    });
    expect(started.status(), await started.text()).toBeGreaterThanOrEqual(400);
    await anonymous.context.close();
    const managed = await passwordSignIn(browser, local.email, local.password);
    expect(managed).toMatchObject({ status: 403, code: "managedAccount" });

    const ownerSecret = readState().ownerSecret ?? "";
    await waitForSignInBudget(OWNER.email, 2);
    const signIn = await freshContext(browser);
    await signIn.page.goto("/sign-in");
    await signInWithPassword(signIn.page, OWNER.email, OWNER.password);
    await enterAuthenticatorCode(signIn.page, ownerSecret);
    await signedIn(signIn.page);
    expect((await sessionOf(signIn.context.request)).account.email).toBe(OWNER.email);
    await signIn.context.close();

    const deactivating = await ownerApi(browser);
    await call(deactivating.request, `/api/v1/instance/identity-providers/${providerId}/deactivate`);
    await deactivating.close();
    const stillManaged = await passwordSignIn(browser, local.email, local.password);
    expect(stillManaged).toMatchObject({ status: 403, code: "managedAccount" });

    await waitForSignInBudget(OWNER.email, 2);
    const emergency = await freshContext(browser);
    await emergency.page.goto("/sign-in?emergency=true");
    const dialog = emergency.page.getByRole("dialog", { name: "Emergency sign-in" });
    await dialog.getByLabel("E-mail").fill(OWNER.email);
    await dialog.getByLabel("Password", { exact: true }).fill(OWNER.password);
    await dialog.getByRole("button", { name: "Continue" }).click();
    await enterAuthenticatorCode(emergency.page, ownerSecret);
    await signedIn(emergency.page);
    expect((await sessionOf(emergency.context.request)).account.email).toBe(OWNER.email);
    await emergency.context.close();
  });
});
