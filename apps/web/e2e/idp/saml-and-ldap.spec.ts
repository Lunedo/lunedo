import {
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { BASE_URL, OWNER, OWNER_STORAGE } from "../support/environment.js";
import {
  KEYCLOAK_SAML_METADATA_URL,
  keycloak,
  registerKeycloakSamlClient,
  removeKeycloakClient,
  TEST_DOMAIN,
  TEST_USERS,
} from "../support/idp.js";
import {
  addMember,
  groupId,
  LDAP_BASE,
  LDAP_DOMAIN,
  LDAP_PASSWORD,
  LDAP_SERVICE,
  LDAP_URL,
  removeMember,
  setDisabled,
  userDn,
} from "../support/ldap.js";

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

async function newOrganization(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post("/api/v1/organizations", {
    headers,
    data: { name: `${name} ${Date.now()}` },
  });
  expect(response.status(), await response.text()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function organizationIds(context: BrowserContext): Promise<string[]> {
  const response = await context.request.get("/api/v1/organizations");
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { items: { id: string }[] }).items.map((item) => item.id);
}

async function mapGroup(
  request: APIRequestContext,
  providerId: string,
  group: { id: string; name: string },
  organizationId: string,
  homeOrganization: boolean,
): Promise<void> {
  const response = await request.post(`/api/v1/instance/identity-providers/${providerId}/mapping-rules`, {
    headers,
    data: {
      target: "organization",
      group,
      organizationId,
      role: null,
      synchronizedGroup: false,
      homeOrganization,
    },
  });
  expect(response.status(), await response.text()).toBe(201);
}

async function account(request: APIRequestContext, email: string) {
  const response = await request.get(`/api/v1/instance/accounts?q=${encodeURIComponent(email)}`);
  const [found] = (
    (await response.json()) as {
      items: {
        id: string;
        state: string;
        homeOrganizationId: string | null;
        organizations: { id: string }[];
      }[];
    }
  ).items;
  if (!found) throw new Error(`No account for ${email}`);
  return found;
}

async function synchronize(request: APIRequestContext, providerId: string): Promise<void> {
  const before = await request.get(`/api/v1/instance/identity-providers/${providerId}/sync-runs?limit=1`);
  const previous = ((await before.json()) as { items: { id: string }[] }).items[0]?.id ?? null;
  const started = await request.post(`/api/v1/instance/identity-providers/${providerId}/sync`, { headers });
  expect(started.status(), await started.text()).toBeLessThan(300);
  await expect
    .poll(
      async () => {
        const runs = await request.get(`/api/v1/instance/identity-providers/${providerId}/sync-runs?limit=1`);
        const [latest] = ((await runs.json()) as { items: { id: string; status: string }[] }).items;
        return latest && latest.id !== previous ? latest.status : "pending";
      },
      { timeout: 60_000 },
    )
    .toMatch(/^(succeeded|warnings)$/);
}

async function removeProvider(browser: Browser, providerId: string): Promise<void> {
  if (!providerId) return;
  const owner = await ownerApi(browser);
  await owner.request.delete(`/api/v1/instance/identity-providers/${providerId}`, { headers });
  await owner.close();
}

async function signedIn(page: Page): Promise<void> {
  await page.waitForURL(
    (url) => url.origin === new URL(BASE_URL).origin && !/^\/(sign-in|api)(\/|$)/.test(url.pathname),
  );
}

async function freshPage(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  return { context, page: await context.newPage() };
}

test.describe("sign-in through SAML (Keycloak)", () => {
  test.describe.configure({ mode: "serial" });
  let providerId = "";
  let clientId = "";
  const user = "dave";

  test.beforeAll(async ({ browser }) => {
    await keycloak.reset();
    const owner = await ownerApi(browser);
    const response = await owner.request.post("/api/v1/instance/identity-providers", {
      headers,
      data: {
        type: "saml",
        name: "E2E SAML",
        config: {
          preset: "generic",
          metadata: { source: "url", url: KEYCLOAK_SAML_METADATA_URL },
          domains: [TEST_DOMAIN],
          accountCreation: { enabled: true, requiredGroups: [] },
          attributes: { email: "email", groups: "groups" },
        },
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    providerId = ((await response.json()) as { provider: { id: string } }).provider.id;
    await owner.close();
    const metadata = await fetch(`${BASE_URL}/api/v1/auth/providers/${providerId}/saml/metadata`);
    expect(metadata.ok).toBe(true);
    clientId = await registerKeycloakSamlClient(await metadata.text());
  });

  test.afterAll(async ({ browser }) => {
    await removeProvider(browser, providerId);
    if (clientId) await removeKeycloakClient(clientId);
    await keycloak.reset();
  });

  async function signIn(page: Page) {
    await page.goto("/sign-in");
    await page.getByLabel("Work e-mail address or sign-in name").fill(TEST_USERS[user].email);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue with E2E SAML" }).click();
    await keycloak.signIn(page, user);
    await signedIn(page);
  }

  test("creates the account at the first sign-in through SAML", async ({ browser }) => {
    const { context, page } = await freshPage(browser);
    await signIn(page);
    const session = await context.request.get("/api/v1/auth/session");
    expect(((await session.json()) as { account: { email: string } }).account.email).toBe(
      TEST_USERS[user].email,
    );
    await context.close();
  });

  test("grants organization access through a SAML group and removes it when the person leaves the group", async ({
    browser,
  }) => {
    const owner = await ownerApi(browser);
    const homeId = await firstOrganization(owner.request);
    const person = await account(owner.request, TEST_USERS[user].email);
    if (person.homeOrganizationId === null) {
      const assigned = await owner.request.post(`/api/v1/instance/accounts/${person.id}/organization`, {
        headers,
        data: { organizationId: homeId },
      });
      expect(assigned.status(), await assigned.text()).toBe(204);
    }
    const organizationId = await newOrganization(owner.request, "E2E SAML engineering");
    await mapGroup(
      owner.request,
      providerId,
      { id: "engineering", name: "engineering" },
      organizationId,
      false,
    );
    await owner.close();
    await keycloak.addToGroup(user, "engineering");

    const first = await freshPage(browser);
    await signIn(first.page);
    expect(await organizationIds(first.context)).toContain(organizationId);
    await first.context.close();

    await keycloak.removeFromGroup(user, "engineering");
    const second = await freshPage(browser);
    await signIn(second.page);
    expect(await organizationIds(second.context)).not.toContain(organizationId);
    expect(await organizationIds(second.context)).toContain(homeId);
    await second.context.close();
  });
});

test.describe("sign-in through LDAP (OpenLDAP)", () => {
  test.describe.configure({ mode: "serial" });
  let providerId = "";
  let homeId = "";
  let engineeringId = "";

  test.beforeAll(async ({ browser }) => {
    const owner = await ownerApi(browser);
    const response = await owner.request.post("/api/v1/instance/identity-providers", {
      headers,
      data: {
        type: "ldap",
        name: "E2E Directory",
        config: {
          preset: "generic",
          url: LDAP_URL,
          bindDn: LDAP_SERVICE.dn,
          userBaseDn: LDAP_BASE.users,
          groupBaseDn: LDAP_BASE.groups,
          domains: [LDAP_DOMAIN],
          accountCreation: { enabled: true, requiredGroups: [] },
          secondFactor: { mode: "provider" },
          disabled: { attribute: "employeeType", values: ["disabled"] },
        },
        credential: { kind: "bindPassword", secret: LDAP_SERVICE.password },
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    providerId = ((await response.json()) as { provider: { id: string } }).provider.id;
    homeId = await firstOrganization(owner.request);
    engineeringId = await newOrganization(owner.request, "E2E LDAP engineering");
    await mapGroup(owner.request, providerId, { id: await groupId("staff"), name: "staff" }, homeId, true);
    await mapGroup(
      owner.request,
      providerId,
      { id: await groupId("engineering"), name: "engineering" },
      engineeringId,
      false,
    );
    await owner.close();
  });

  test.afterAll(async ({ browser }) => {
    await removeProvider(browser, providerId);
    await addMember("platform", userDn("lena"));
    await setDisabled("nora", false);
  });

  async function signIn(page: Page, name: "lena" | "nora" | "otto", password = LDAP_PASSWORD) {
    await page.goto("/sign-in");
    await page.getByLabel("Work e-mail address or sign-in name").fill(`${name}@${LDAP_DOMAIN}`);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }

  test("signs in with the directory password and grants access through a nested group", async ({
    browser,
  }) => {
    const { context, page } = await freshPage(browser);
    await signIn(page, "lena");
    await signedIn(page);
    const ids = await organizationIds(context);
    expect(ids).toContain(homeId);
    expect(ids).toContain(engineeringId);
    await context.close();
  });

  test("removes the access at the next sync when the person leaves the nested group", async ({ browser }) => {
    await removeMember("platform", userDn("lena"));
    const owner = await ownerApi(browser);
    await synchronize(owner.request, providerId);
    const ids = (await account(owner.request, `lena@${LDAP_DOMAIN}`)).organizations.map((entry) => entry.id);
    expect(ids).not.toContain(engineeringId);
    expect(ids).toContain(homeId);
    await owner.close();
  });

  test("deactivates a disabled person at the next sync and reactivates them when enabled again", async ({
    browser,
  }) => {
    const first = await freshPage(browser);
    await signIn(first.page, "nora");
    await signedIn(first.page);
    await first.context.close();

    const owner = await ownerApi(browser);
    await setDisabled("nora", true);
    await synchronize(owner.request, providerId);
    expect((await account(owner.request, `nora@${LDAP_DOMAIN}`)).state).toBe("deactivated");
    await setDisabled("nora", false);
    await synchronize(owner.request, providerId);
    expect((await account(owner.request, `nora@${LDAP_DOMAIN}`)).state).toBe("active");
    await owner.close();
  });

  test("explains a disabled directory account and a wrong password", async ({ browser }) => {
    const { context, page } = await freshPage(browser);
    await signIn(page, "otto");
    await expect(page.getByRole("alert")).toContainText("disabled");
    await signIn(page, "lena", "not the password");
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in/);
    await context.close();
  });
});
