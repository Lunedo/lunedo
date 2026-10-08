import { randomBytes } from "node:crypto";
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
  newTestUser,
  registerKeycloakSamlClient,
  removeKeycloakClient,
  TEST_DOMAIN,
} from "../support/idp.js";
import {
  createUser as createLdapUser,
  deleteUser as deleteLdapUser,
  groupId,
  LDAP_BASE,
  LDAP_DOMAIN,
  LDAP_PASSWORD,
  LDAP_SERVICE,
  LDAP_URL,
  type LdapGroup,
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

async function groupByName(
  request: APIRequestContext,
  providerId: string,
  name: string,
): Promise<{ id: string; name: string }> {
  const response = await request.get(
    `/api/v1/instance/identity-providers/${providerId}/groups?q=${encodeURIComponent(name)}`,
  );
  expect(response.status(), await response.text()).toBe(200);
  const found = ((await response.json()) as { id: string; name: string | null }[]).find(
    (group) => group.name === name,
  );
  if (!found) throw new Error(`The directory has no group named ${name}`);
  return { id: found.id, name };
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
  let providerId = "";
  let clientId = "";
  let user = newTestUser("saml");

  test.beforeEach(async ({ browser }) => {
    user = newTestUser("saml");
    await keycloak.createUser(user);
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

  test.afterEach(async ({ browser }) => {
    await removeProvider(browser, providerId);
    providerId = "";
    if (clientId) await removeKeycloakClient(clientId);
    clientId = "";
    await keycloak.deleteUser(user.username);
  });

  async function signIn(page: Page) {
    await page.goto("/sign-in");
    await page.getByLabel("Work e-mail address or sign-in name").fill(user.email);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue with E2E SAML" }).click();
    await keycloak.signIn(page, user.username);
    await signedIn(page);
  }

  test("creates the account at the first sign-in through SAML", async ({ browser }) => {
    const { context, page } = await freshPage(browser);
    await signIn(page);
    const session = await context.request.get("/api/v1/auth/session");
    expect(((await session.json()) as { account: { email: string } }).account.email).toBe(user.email);
    await context.close();
  });

  test("grants organization access through a SAML group and removes it when the person leaves the group", async ({
    browser,
  }) => {
    const created = await freshPage(browser);
    await signIn(created.page);
    await created.context.close();

    const owner = await ownerApi(browser);
    const homeId = await firstOrganization(owner.request);
    const person = await account(owner.request, user.email);
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
    await keycloak.addToGroup(user.username, "admins");
    await keycloak.addToGroup(user.username, "engineering");

    const first = await freshPage(browser);
    await signIn(first.page);
    expect(await organizationIds(first.context)).toContain(organizationId);
    await first.context.close();

    await keycloak.removeFromGroup(user.username, "engineering");
    const second = await freshPage(browser);
    await signIn(second.page);
    expect(await organizationIds(second.context)).not.toContain(organizationId);
    expect(await organizationIds(second.context)).toContain(homeId);
    await second.context.close();
  });
});

test.describe("sign-in through LDAP (OpenLDAP)", () => {
  let providerId = "";
  let homeId = "";
  let engineeringId = "";
  const created: { uid: string; groups: LdapGroup[] }[] = [];

  async function directoryUser(prefix: string, groups: LdapGroup[], disabled = false): Promise<string> {
    const uid = `${prefix}-${randomBytes(5).toString("hex")}`;
    created.push({ uid, groups });
    await createLdapUser(uid, { groups, disabled });
    return uid;
  }

  test.beforeEach(async ({ browser }) => {
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
          sync: { intervalMinutes: 60, deactivationLimitPercent: 100 },
        },
        credential: { kind: "bindPassword", secret: LDAP_SERVICE.password },
      },
    });
    expect(response.status(), await response.text()).toBe(201);
    providerId = ((await response.json()) as { provider: { id: string } }).provider.id;
    homeId = await firstOrganization(owner.request);
    engineeringId = await newOrganization(owner.request, "E2E LDAP engineering");
    const refused = await owner.request.post(
      `/api/v1/instance/identity-providers/${providerId}/mapping-rules`,
      {
        headers,
        data: {
          target: "instance",
          group: { id: "engineering", name: null },
          role: { builtIn: "administrator" },
        },
      },
    );
    expect(refused.status()).toBe(400);
    expect(((await refused.json()) as { code: string }).code).toBe("providerGroupNotFound");
    const staff = await groupByName(owner.request, providerId, "staff");
    expect(staff.id).toBe(await groupId("staff"));
    await mapGroup(owner.request, providerId, staff, homeId, true);
    await mapGroup(
      owner.request,
      providerId,
      await groupByName(owner.request, providerId, "engineering"),
      engineeringId,
      false,
    );
    await owner.close();
  });

  test.afterEach(async ({ browser }) => {
    await removeProvider(browser, providerId);
    providerId = "";
    for (const entry of created.splice(0)) await deleteLdapUser(entry.uid, entry.groups);
  });

  async function signIn(page: Page, uid: string, password = LDAP_PASSWORD) {
    await page.goto("/sign-in");
    await page.getByLabel("Work e-mail address or sign-in name").fill(`${uid}@${LDAP_DOMAIN}`);
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }

  test("signs in with the directory password and grants access through a nested group", async ({
    browser,
  }) => {
    const uid = await directoryUser("member", ["staff", "platform"]);
    const { context, page } = await freshPage(browser);
    await signIn(page, uid);
    await signedIn(page);
    const ids = await organizationIds(context);
    expect(ids).toContain(homeId);
    expect(ids).toContain(engineeringId);
    await context.close();
  });

  test("removes the access at the next sync when the person leaves the nested group", async ({ browser }) => {
    const uid = await directoryUser("member", ["staff", "platform"]);
    const first = await freshPage(browser);
    await signIn(first.page, uid);
    await signedIn(first.page);
    expect(await organizationIds(first.context)).toContain(engineeringId);
    await first.context.close();

    await removeMember("platform", userDn(uid));
    const owner = await ownerApi(browser);
    await synchronize(owner.request, providerId);
    const ids = (await account(owner.request, `${uid}@${LDAP_DOMAIN}`)).organizations.map(
      (entry) => entry.id,
    );
    expect(ids).not.toContain(engineeringId);
    expect(ids).toContain(homeId);
    await owner.close();
  });

  test("deactivates a disabled person at the next sync and reactivates them when enabled again", async ({
    browser,
  }) => {
    const uid = await directoryUser("member", ["staff"]);
    const first = await freshPage(browser);
    await signIn(first.page, uid);
    await signedIn(first.page);
    await first.context.close();

    const owner = await ownerApi(browser);
    await setDisabled(uid, true);
    await synchronize(owner.request, providerId);
    expect((await account(owner.request, `${uid}@${LDAP_DOMAIN}`)).state).toBe("deactivated");
    await setDisabled(uid, false);
    await synchronize(owner.request, providerId);
    expect((await account(owner.request, `${uid}@${LDAP_DOMAIN}`)).state).toBe("active");
    await owner.close();
  });

  test("explains a disabled directory account and a wrong password", async ({ browser }) => {
    const disabled = await directoryUser("disabled", [], true);
    const member = await directoryUser("member", ["staff"]);
    const { context, page } = await freshPage(browser);
    await signIn(page, disabled);
    await expect(page.getByRole("alert")).toContainText("disabled");
    await signIn(page, member, "not the password");
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in/);
    await context.close();
  });
});
