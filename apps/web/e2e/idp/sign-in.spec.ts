import { type APIRequestContext, type Browser, expect, type Page, test } from "@playwright/test";
import { BASE_URL, OWNER, OWNER_STORAGE, readState } from "../support/environment.js";
import { freshTotp, linkFrom, waitForMail } from "../support/helpers.js";
import { type IdentityProviderFixture, identityProviders, TEST_DOMAIN, TEST_USERS } from "../support/idp.js";

const HOST_FROM_PROVIDER = BASE_URL.replace("localhost", "host.docker.internal");

const headers = { "X-Pagehall-Request": "1", origin: BASE_URL };

async function ownerApi(
  browser: Browser,
): Promise<{ request: APIRequestContext; close: () => Promise<void> }> {
  const context = await browser.newContext({ storageState: OWNER_STORAGE });
  const reauthenticated = await context.request.post("/api/v1/auth/reauthenticate", {
    data: { method: "password", password: OWNER.password },
    headers,
  });
  expect(reauthenticated.status()).toBeLessThan(300);
  return { request: context.request, close: () => context.close() };
}

async function createProvider(
  request: APIRequestContext,
  provider: IdentityProviderFixture,
  accountCreation: boolean,
): Promise<string> {
  const response = await request.post("/api/v1/instance/identity-providers", {
    headers,
    data: {
      name: `E2E ${provider.name}`,
      config: {
        preset: "generic",
        clientId: provider.clientId,
        issuer: provider.issuer,
        domains: [TEST_DOMAIN],
        scopes: provider.scopes.split(" "),
        accountCreation: { enabled: accountCreation, requiredGroups: [] },
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

async function signInThroughProvider(
  page: Page,
  provider: IdentityProviderFixture,
  user: keyof typeof TEST_USERS,
) {
  await page.goto("/sign-in");
  await page.getByLabel("Work e-mail address").fill(TEST_USERS[user].email);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(`${TEST_DOMAIN} signs in with E2E ${provider.name}`)).toBeVisible();
  await page.getByRole("button", { name: `Continue with E2E ${provider.name}` }).click();
  await provider.signIn(page, user);
}

for (const provider of identityProviders) {
  test.describe(`sign-in through ${provider.name}`, () => {
    test.describe.configure({ mode: "serial" });
    let providerId = "";

    test.beforeAll(async ({ browser }) => {
      const owner = await ownerApi(browser);
      providerId = await createProvider(owner.request, provider, true);
      await owner.close();
    });

    test.afterAll(async ({ browser }) => {
      const owner = await ownerApi(browser);
      await setPasswordSignIn(owner.request, undefined);
      if (providerId)
        await owner.request.delete(`/api/v1/instance/identity-providers/${providerId}`, { headers });
      await owner.close();
      await provider.reset();
    });

    test("chooses the provider by domain and creates the account at first sign-in", async ({ browser }) => {
      const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const page = await context.newPage();
      await signInThroughProvider(page, provider, "alice");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const session = await context.request.get("/api/v1/auth/session");
      expect(((await session.json()) as { account: { email: string } }).account.email).toBe(
        TEST_USERS.alice.email,
      );
      await page.goto("/sign-in");
      await expect(page.getByRole("button", { name: `E2E ${provider.name}` })).toBeVisible();
      await context.close();
    });

    test("refuses an address outside the provider's domains with a reference", async ({ browser }) => {
      const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const page = await context.newPage();
      await page.goto("/sign-in");
      await page.getByLabel("Work e-mail address").fill(TEST_USERS.alice.email);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByRole("button", { name: `Continue with E2E ${provider.name}` }).click();
      await provider.signIn(page, "erin");
      await expect(page).toHaveURL(/\/sign-in\/refused/);
      await expect(page.getByText("Reference for your administrator:")).toBeVisible();
      await context.close();
    });

    test("ends the Pagehall session when the provider signs the person out", async ({ browser }) => {
      test.skip(!provider.endSessions, "The provider fixture cannot end sessions");
      const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const page = await context.newPage();
      await signInThroughProvider(page, provider, "alice");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await provider.endSessions?.("alice");
      await expect
        .poll(async () => (await context.request.get("/api/v1/auth/session")).status(), { timeout: 20_000 })
        .toBe(401);
      await context.close();
    });

    test("shows the only provider directly when password sign-in is off, and keeps the emergency sign-in", async ({
      browser,
    }) => {
      const owner = await ownerApi(browser);
      await setPasswordSignIn(owner.request, false);
      await owner.close();
      const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const page = await context.newPage();
      await page.goto("/sign-in");
      await expect(page.getByRole("button", { name: `Continue with E2E ${provider.name}` })).toBeVisible();
      await expect(page.getByLabel("Work e-mail address")).toHaveCount(0);

      await page.getByRole("button", { name: "Emergency sign-in for the instance owner" }).click();
      const dialog = page.getByRole("dialog", { name: "Emergency sign-in" });
      await dialog.getByLabel("E-mail").fill(OWNER.email);
      await dialog.getByLabel("Password").fill(OWNER.password);
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
  if (!provider) return;
  let providerId = "";
  const password = "a long passphrase of bob";

  test.beforeAll(async ({ browser }) => {
    const owner = await ownerApi(browser);
    providerId = await createProvider(owner.request, provider, true);
    const organizationId = readState().organizationId ?? "";
    const invited = await owner.request.post(`/api/v1/organizations/${organizationId}/invitations`, {
      headers,
      data: { email: TEST_USERS.bob.email, kind: "member" },
    });
    expect(invited.status()).toBeLessThan(300);
    await owner.close();
    const mail = await waitForMail(TEST_USERS.bob.email, /invit/i);
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto(linkFrom(mail.text).replace(/^https?:\/\/[^/]+/, ""));
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await page.getByLabel("Name", { exact: true }).fill(TEST_USERS.bob.name);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Repeat the password").fill(password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Your account is ready. Sign in to start.")).toBeVisible();
    await context.close();
  });

  test.afterAll(async ({ browser }) => {
    const owner = await ownerApi(browser);
    if (providerId)
      await owner.request.delete(`/api/v1/instance/identity-providers/${providerId}`, { headers });
    await owner.close();
  });

  test("links only after the password of the existing account", async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await signInThroughProvider(page, provider, "bob");
    await expect(page.getByRole("heading", { name: `Link your E2E ${provider.name} account` })).toBeVisible();
    await page.getByLabel(`Password of ${TEST_USERS.bob.name}`).fill("not the password");
    await page.getByRole("button", { name: "Confirm and link" }).click();
    await expect(page.getByText("The e-mail address or the password is not correct.")).toBeVisible();
    await page.getByLabel(`Password of ${TEST_USERS.bob.name}`).fill(password);
    await page.getByRole("button", { name: "Confirm and link" }).click();
    await expect(page).not.toHaveURL(/\/sign-in/);
    const identities = await context.request.get("/api/v1/account/identities");
    expect((await identities.json()) as unknown[]).toHaveLength(1);
    await context.close();
  });
});
