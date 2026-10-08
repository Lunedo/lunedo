import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { BASE_URL, OWNER, OWNER_STORAGE, readState } from "../support/environment.js";
import { freshTotp, linkFrom, waitForMail } from "../support/helpers.js";
import {
  createKeycloakUser,
  deleteKeycloakUser,
  type IdentityProviderFixture,
  identityProviders,
  type NewTestUser,
  newTestUser,
  signInAtKeycloak,
  TEST_DOMAIN,
} from "../support/idp.js";

const HOST_FROM_PROVIDER = BASE_URL.replace("localhost", "host.docker.internal");

const headers = { "X-Pagehall-Request": "1", origin: BASE_URL };

let reauthenticated = false;

async function ownerApi(
  browser: Browser,
): Promise<{ request: APIRequestContext; close: () => Promise<void> }> {
  const context = await browser.newContext({ storageState: OWNER_STORAGE });
  if (!reauthenticated) {
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

async function firstOrganization(request: APIRequestContext): Promise<string> {
  const response = await request.get("/api/v1/organizations");
  return ((await response.json()) as { items: { id: string }[] }).items[0]?.id ?? "";
}

async function organizationIds(context: BrowserContext): Promise<string[]> {
  const response = await context.request.get("/api/v1/organizations");
  return ((await response.json()) as { items: { id: string }[] }).items.map((item) => item.id);
}

async function createProvider(
  request: APIRequestContext,
  provider: IdentityProviderFixture,
  accountCreation: boolean,
): Promise<string> {
  const response = await request.post("/api/v1/instance/identity-providers", {
    headers,
    data: {
      type: "oidc",
      name: `E2E ${provider.name}`,
      config: {
        preset: "generic",
        clientId: provider.clientId,
        issuer: provider.issuer,
        domains: [TEST_DOMAIN],
        scopes: provider.scopes.split(" "),
        accountCreation: { enabled: accountCreation, requiredGroups: [] },
        claims: {
          email: "email",
          signInName: "preferred_username",
          displayName: "name",
          groups: "groups",
          groupNames: "group_names",
        },
      },
      credential: { kind: "clientSecret", secret: provider.clientSecret, expiresAt: null },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const created = (await response.json()) as { provider: { id: string } };
  await provider.setBackchannelLogoutUrl(
    `${HOST_FROM_PROVIDER}/api/v1/auth/providers/${created.provider.id}/backchannel-logout`,
  );
  return created.provider.id;
}

async function setPasswordSignIn(request: APIRequestContext, value: boolean | undefined): Promise<void> {
  const response = await request.put("/api/v1/instance/settings/auth.passwordSignIn", {
    headers,
    data: value === undefined ? { clear: true } : { value },
  });
  expect(response.status()).toBeLessThan(300);
}

async function signInThroughProvider(page: Page, provider: IdentityProviderFixture, user: NewTestUser) {
  await page.goto("/sign-in");
  await page.getByLabel("Work e-mail address or sign-in name").fill(user.email);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(`${TEST_DOMAIN} signs in with E2E ${provider.name}`)).toBeVisible();
  await page.getByRole("button", { name: `Continue with E2E ${provider.name}` }).click();
  await provider.signIn(page, user.username);
}

async function freshContext(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  return { context, page: await context.newPage() };
}

for (const provider of identityProviders) {
  test.describe(`sign-in through ${provider.name}`, () => {
    let providerId = "";
    let user: NewTestUser = newTestUser("person");
    const created: string[] = [];

    async function createUser(person: NewTestUser): Promise<NewTestUser> {
      created.push(person.username);
      await provider.createUser(person);
      return person;
    }

    test.beforeEach(async ({ browser }) => {
      user = await createUser(newTestUser("person"));
      const owner = await ownerApi(browser);
      providerId = await createProvider(owner.request, provider, true);
      await owner.close();
    });

    test.afterEach(async ({ browser }) => {
      const owner = await ownerApi(browser);
      await setPasswordSignIn(owner.request, undefined);
      if (providerId)
        await owner.request.delete(`/api/v1/instance/identity-providers/${providerId}`, { headers });
      providerId = "";
      await owner.close();
      for (const username of created.splice(0)) await provider.deleteUser(username);
    });

    test("chooses the provider by domain and creates the account at first sign-in", async ({ browser }) => {
      const { context, page } = await freshContext(browser);
      await signInThroughProvider(page, provider, user);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const session = await context.request.get("/api/v1/auth/session");
      expect(((await session.json()) as { account: { email: string } }).account.email).toBe(user.email);
      await context.clearCookies({ name: "__Host-pagehall-session" });
      await page.goto("/sign-in");
      await expect(page.getByRole("button", { name: `E2E ${provider.name}` })).toBeVisible();
      await context.close();
    });

    test("refuses an address outside the provider's domains with a reference", async ({ browser }) => {
      const outsider = await createUser(newTestUser("outsider", "example.net"));
      const { context, page } = await freshContext(browser);
      await page.goto("/sign-in");
      await page.getByLabel("Work e-mail address or sign-in name").fill(user.email);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: `Continue with E2E ${provider.name}` }).click();
      await provider.signIn(page, outsider.username);
      await expect(page).toHaveURL(/\/sign-in\/refused/);
      await expect(page.getByText("Reference for your administrator:")).toBeVisible();
      await context.close();
    });

    test("ends the Pagehall session when the provider signs the person out", async ({ browser }) => {
      const { context, page } = await freshContext(browser);
      await signInThroughProvider(page, provider, user);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await provider.endSessions(user.username);
      await expect
        .poll(async () => (await context.request.get("/api/v1/auth/session")).status(), { timeout: 20_000 })
        .toBe(401);
      await context.close();
    });

    test("grants organization access through a group and removes it when the person leaves the group", async ({
      browser,
    }) => {
      const synchronize = provider.name === "keycloak";
      const first = await freshContext(browser);
      await signInThroughProvider(first.page, provider, user);
      await expect(first.page.getByRole("heading", { level: 1 })).toBeVisible();
      await first.context.close();

      const owner = await ownerApi(browser);
      const homeId = await firstOrganization(owner.request);
      const accounts = await owner.request.get(
        `/api/v1/instance/accounts?q=${encodeURIComponent(user.email)}`,
      );
      const [account] = (
        (await accounts.json()) as { items: { id: string; homeOrganizationId: string | null }[] }
      ).items;
      if (!account) throw new Error("The account from the first sign-in was not found");
      if (account.homeOrganizationId === null) {
        const assigned = await owner.request.post(`/api/v1/instance/accounts/${account.id}/organization`, {
          headers,
          data: { organizationId: homeId },
        });
        expect(assigned.status(), await assigned.text()).toBe(204);
      }
      const organization = await owner.request.post("/api/v1/organizations", {
        headers,
        data: { name: `E2E ${provider.name} engineering ${Date.now()}` },
      });
      expect(organization.status(), await organization.text()).toBe(201);
      const organizationId = ((await organization.json()) as { id: string }).id;
      const groupId = await provider.groupId("engineering");
      const rule = await owner.request.post(
        `/api/v1/instance/identity-providers/${providerId}/mapping-rules`,
        {
          headers,
          data: {
            target: "organization",
            group: { id: groupId, name: "engineering" },
            organizationId,
            role: null,
            synchronizedGroup: synchronize,
            homeOrganization: false,
          },
        },
      );
      expect(rule.status(), await rule.text()).toBe(201);
      await owner.close();
      await provider.addToGroup(user.username, "engineering");

      const { context, page } = await freshContext(browser);
      await signInThroughProvider(page, provider, user);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await organizationIds(context)).toContain(organizationId);

      if (synchronize) {
        const admin = await browser.newContext({ storageState: OWNER_STORAGE });
        const groups = await admin.newPage();
        await groups.goto(`/settings/organizations/${organizationId}/groups`);
        const row = groups.getByRole("row", { name: /engineering/ });
        await expect(row.getByText(`E2E ${provider.name}`)).toBeVisible();
        await admin.close();
      }
      await context.close();

      await provider.removeFromGroup(user.username, "engineering");
      const again = await freshContext(browser);
      await signInThroughProvider(again.page, provider, user);
      await expect(again.page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await organizationIds(again.context)).not.toContain(organizationId);
      expect(await organizationIds(again.context)).toContain(homeId);
      await again.context.close();
    });

    test("shows the only provider directly when password sign-in is off, and keeps the emergency sign-in", async ({
      browser,
    }) => {
      const owner = await ownerApi(browser);
      await setPasswordSignIn(owner.request, false);
      await owner.close();
      const { context, page } = await freshContext(browser);
      await page.goto("/sign-in");
      await expect(page.getByRole("button", { name: `Continue with E2E ${provider.name}` })).toBeVisible();
      await expect(page.getByLabel("Work e-mail address or sign-in name")).toHaveCount(0);

      await page.getByRole("button", { name: "Emergency sign-in for the instance owner" }).click();
      const dialog = page.getByRole("dialog", { name: "Emergency sign-in" });
      await dialog.getByLabel("E-mail").fill(OWNER.email);
      await dialog.getByLabel("Password", { exact: true }).fill(OWNER.password);
      await dialog.getByRole("button", { name: "Continue" }).click();
      await page
        .getByLabel("Code from your authenticator app")
        .fill(await freshTotp(readState().ownerSecret ?? ""));
      await page.getByRole("button", { name: "Verify" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await context.close();
    });
  });
}

test.describe("linking an existing account", () => {
  const provider = identityProviders[0];
  if (provider?.name !== "keycloak") return;
  let providerId = "";
  let username = "";
  const person = { name: "Link Example", password: "a long passphrase of the linked person" };
  const email = () => `${username}@${TEST_DOMAIN}`;

  test.beforeAll(async ({ browser }) => {
    username = `link-${Date.now().toString(36)}`;
    await createKeycloakUser(username, { email: email(), firstName: "Link", lastName: "Example" });
    const owner = await ownerApi(browser);
    providerId = await createProvider(owner.request, provider, true);
    const organizationId = await firstOrganization(owner.request);
    const invited = await owner.request.post(`/api/v1/organizations/${organizationId}/invitations`, {
      headers,
      data: { email: email(), kind: "member" },
    });
    expect(invited.status()).toBeLessThan(300);
    await owner.close();
    const mail = await waitForMail(email(), /invit/i);
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto(linkFrom(mail.text).replace(/^https?:\/\/[^/]+/, ""));
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await page.getByLabel("Name", { exact: true }).fill(person.name);
    await page.getByLabel("Password", { exact: true }).fill(person.password);
    await page.getByLabel("Repeat the password").fill(person.password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Your account is ready. Sign in to start.")).toBeVisible();
    await context.close();
  });

  test.afterAll(async ({ browser }) => {
    const owner = await ownerApi(browser);
    if (providerId)
      await owner.request.delete(`/api/v1/instance/identity-providers/${providerId}`, { headers });
    await owner.close();
    if (username) await deleteKeycloakUser(username);
  });

  test("links only after the password of the existing account", async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto("/sign-in");
    await page.getByLabel("Work e-mail address or sign-in name").fill(email());
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: `Continue with E2E ${provider.name}` }).click();
    await signInAtKeycloak(page, username);
    await expect(page.getByRole("heading", { name: `Link your E2E ${provider.name} account` })).toBeVisible();
    await page.getByLabel(`Password of ${person.name}`).fill("not the password");
    await page.getByRole("button", { name: "Confirm and link" }).click();
    await expect(
      page.getByText(`This is not the Pagehall password of ${person.name}.`, { exact: false }),
    ).toBeVisible();
    await page.getByLabel(`Password of ${person.name}`).fill(person.password);
    await page.getByRole("button", { name: "Confirm and link" }).click();
    await expect(page).not.toHaveURL(/\/sign-in/);
    const identities = await context.request.get("/api/v1/account/identities");
    expect((await identities.json()) as unknown[]).toHaveLength(1);
    await context.close();
  });
});
