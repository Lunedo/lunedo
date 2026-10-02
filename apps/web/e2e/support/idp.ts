import type { Page } from "@playwright/test";

export type IdentityProviderName = "keycloak" | "authentik";
export type TestUserName = "alice" | "bob" | "carol" | "dave" | "erin";
export type TestGroupName = "engineering" | "admins";

export const TEST_PASSWORD = "pagehall-test-password";

export const TEST_USERS: Record<TestUserName, { email: string; name: string; groups: TestGroupName[] }> = {
  alice: { email: "alice@example.org", name: "Alice Example", groups: ["engineering", "admins"] },
  bob: { email: "bob@example.org", name: "Bob Example", groups: ["engineering"] },
  carol: { email: "carol@example.org", name: "Carol Example", groups: [] },
  dave: { email: "dave@example.org", name: "Dave Example", groups: ["engineering"] },
  erin: { email: "erin@example.net", name: "Erin Outside", groups: [] },
};

export const TEST_DOMAIN = "example.org";

export interface IdentityProviderFixture {
  readonly name: IdentityProviderName;
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly scopes: string;
  groupId(group: TestGroupName): Promise<string>;
  setUserEnabled(user: TestUserName, enabled: boolean): Promise<void>;
  isUserEnabled(user: TestUserName): Promise<boolean>;
  userGroups(user: TestUserName): Promise<string[]>;
  addToGroup(user: TestUserName, group: TestGroupName): Promise<void>;
  removeFromGroup(user: TestUserName, group: TestGroupName): Promise<void>;
  renameGroup(group: TestGroupName, name: string): Promise<void>;
  setBackchannelLogoutUrl(url: string): Promise<void>;
  reset(): Promise<void>;
  signIn(page: Page, user: TestUserName, password?: string): Promise<void>;
}

const env = (name: string, fallback: string) => process.env[name] || fallback;

async function json<T>(response: Response, action: string): Promise<T> {
  if (!response.ok) throw new Error(`${action} failed with ${response.status}: ${await response.text()}`);
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

const KEYCLOAK_URL = env("PAGEHALL_E2E_KEYCLOAK_URL", "http://keycloak.localhost:8080");
const KEYCLOAK_REALM = "pagehall";

const KEYCLOAK_GROUP_IDS: Record<TestGroupName, string> = {
  engineering: "6f1c2b8e-3a4d-4c5e-9f60-7a8b9c0d1e2f",
  admins: "0b9a8c7d-6e5f-4a3b-8c2d-1e0f9a8b7c6d",
};

const KEYCLOAK_GROUP_NAMES: Record<TestGroupName, string> = { engineering: "engineering", admins: "admins" };

async function keycloakToken(): Promise<string> {
  const response = await fetch(`${KEYCLOAK_URL}/realms/master/protocol/openid-connect/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "password",
      client_id: "admin-cli",
      username: env("PAGEHALL_E2E_KEYCLOAK_ADMIN", "admin"),
      password: env("PAGEHALL_E2E_KEYCLOAK_ADMIN_PASSWORD", "admin"),
    }),
  });
  return (await json<{ access_token: string }>(response, "Keycloak admin sign-in")).access_token;
}

async function keycloakAdmin<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${await keycloakToken()}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return json<T>(response, `Keycloak ${method} ${path}`);
}

async function keycloakUserId(user: TestUserName): Promise<string> {
  const users = await keycloakAdmin<{ id: string }[]>("GET", `/users?username=${user}&exact=true`);
  const found = users[0];
  if (!found) throw new Error(`Keycloak user ${user} does not exist`);
  return found.id;
}

export const keycloak: IdentityProviderFixture = {
  name: "keycloak",
  issuer: `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}`,
  clientId: "pagehall",
  clientSecret: env("PAGEHALL_E2E_KEYCLOAK_CLIENT_SECRET", "pagehall-keycloak-secret"),
  scopes: "openid email profile",
  async groupId(group) {
    return KEYCLOAK_GROUP_IDS[group];
  },
  async setUserEnabled(user, enabled) {
    await keycloakAdmin("PUT", `/users/${await keycloakUserId(user)}`, { enabled });
  },
  async isUserEnabled(user) {
    return (await keycloakAdmin<{ enabled: boolean }>("GET", `/users/${await keycloakUserId(user)}`)).enabled;
  },
  async userGroups(user) {
    const groups = await keycloakAdmin<{ id: string }[]>(
      "GET",
      `/users/${await keycloakUserId(user)}/groups`,
    );
    return groups.map((group) => group.id).sort();
  },
  async addToGroup(user, group) {
    await keycloakAdmin("PUT", `/users/${await keycloakUserId(user)}/groups/${KEYCLOAK_GROUP_IDS[group]}`);
  },
  async removeFromGroup(user, group) {
    await keycloakAdmin("DELETE", `/users/${await keycloakUserId(user)}/groups/${KEYCLOAK_GROUP_IDS[group]}`);
  },
  async renameGroup(group, name) {
    const current = await keycloakAdmin<Record<string, unknown>>(
      "GET",
      `/groups/${KEYCLOAK_GROUP_IDS[group]}`,
    );
    await keycloakAdmin("PUT", `/groups/${KEYCLOAK_GROUP_IDS[group]}`, { ...current, name });
  },
  async setBackchannelLogoutUrl(url) {
    const clients = await keycloakAdmin<{ id: string; attributes?: Record<string, string> }[]>(
      "GET",
      "/clients?clientId=pagehall",
    );
    const client = clients[0];
    if (!client) throw new Error("Keycloak client pagehall does not exist");
    await keycloakAdmin("PUT", `/clients/${client.id}`, {
      ...client,
      attributes: { ...client.attributes, "backchannel.logout.url": url },
    });
  },
  async reset() {
    for (const group of Object.keys(KEYCLOAK_GROUP_IDS) as TestGroupName[]) {
      await this.renameGroup(group, KEYCLOAK_GROUP_NAMES[group]);
    }
    for (const [user, details] of Object.entries(TEST_USERS) as [
      TestUserName,
      (typeof TEST_USERS)[TestUserName],
    ][]) {
      await this.setUserEnabled(user, true);
      for (const group of Object.keys(KEYCLOAK_GROUP_IDS) as TestGroupName[]) {
        if (details.groups.includes(group)) await this.addToGroup(user, group);
        else await this.removeFromGroup(user, group);
      }
    }
  },
  async signIn(page, user, password = TEST_PASSWORD) {
    await page.locator("#username").fill(user);
    await page.locator("#password").fill(password);
    await page.locator("#kc-login").click();
  },
};

const AUTHENTIK_URL = env("PAGEHALL_E2E_AUTHENTIK_URL", "http://authentik.localhost:9000");

async function authentikApi<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${AUTHENTIK_URL}/api/v3${path}`, {
    method,
    headers: {
      authorization: `Bearer ${env("PAGEHALL_E2E_AUTHENTIK_TOKEN", "pagehall-authentik-api-token")}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return json<T>(response, `Authentik ${method} ${path}`);
}

async function authentikUserPk(user: TestUserName): Promise<number> {
  const page = await authentikApi<{ results: { pk: number }[] }>("GET", `/core/users/?username=${user}`);
  const found = page.results[0];
  if (!found) throw new Error(`Authentik user ${user} does not exist`);
  return found.pk;
}

const authentikGroupIds = new Map<TestGroupName, string>();

async function authentikGroupId(group: TestGroupName): Promise<string> {
  const known = authentikGroupIds.get(group);
  if (known) return known;
  const page = await authentikApi<{ results: { pk: string; name: string }[] }>(
    "GET",
    `/core/groups/?attributes=${encodeURIComponent(JSON.stringify({ pagehall_test_group: group }))}`,
  );
  const tagged = page.results[0];
  if (tagged) {
    authentikGroupIds.set(group, tagged.pk);
    return tagged.pk;
  }
  const byName = await authentikApi<{ results: { pk: string }[] }>("GET", `/core/groups/?name=${group}`);
  const found = byName.results[0];
  if (!found) throw new Error(`Authentik group ${group} does not exist`);
  authentikGroupIds.set(group, found.pk);
  return found.pk;
}

export const authentik: IdentityProviderFixture = {
  name: "authentik",
  issuer: `${AUTHENTIK_URL}/application/o/pagehall/`,
  clientId: "pagehall",
  clientSecret: env("PAGEHALL_E2E_AUTHENTIK_CLIENT_SECRET", "pagehall-authentik-secret"),
  scopes: "openid email profile groups",
  groupId: authentikGroupId,
  async setUserEnabled(user, enabled) {
    await authentikApi("PATCH", `/core/users/${await authentikUserPk(user)}/`, { is_active: enabled });
  },
  async isUserEnabled(user) {
    return (await authentikApi<{ is_active: boolean }>("GET", `/core/users/${await authentikUserPk(user)}/`))
      .is_active;
  },
  async userGroups(user) {
    const details = await authentikApi<{ groups: string[] }>(
      "GET",
      `/core/users/${await authentikUserPk(user)}/`,
    );
    const tagged = await Promise.all(
      (["engineering", "admins"] as TestGroupName[]).map((group) => authentikGroupId(group)),
    );
    return details.groups.filter((id) => tagged.includes(id)).sort();
  },
  async addToGroup(user, group) {
    await authentikApi("POST", `/core/groups/${await authentikGroupId(group)}/add_user/`, {
      pk: await authentikUserPk(user),
    });
  },
  async removeFromGroup(user, group) {
    await authentikApi("POST", `/core/groups/${await authentikGroupId(group)}/remove_user/`, {
      pk: await authentikUserPk(user),
    });
  },
  async renameGroup(group, name) {
    await authentikApi("PATCH", `/core/groups/${await authentikGroupId(group)}/`, { name });
  },
  async setBackchannelLogoutUrl(url) {
    const page = await authentikApi<{ results: { pk: number }[] }>("GET", "/providers/oauth2/?name=Pagehall");
    const provider = page.results[0];
    if (!provider) throw new Error("Authentik provider Pagehall does not exist");
    await authentikApi("PATCH", `/providers/oauth2/${provider.pk}/`, {
      logout_uri: url,
      logout_method: "backchannel",
    });
  },
  async reset() {
    for (const group of ["engineering", "admins"] as TestGroupName[]) await this.renameGroup(group, group);
    for (const [user, details] of Object.entries(TEST_USERS) as [
      TestUserName,
      (typeof TEST_USERS)[TestUserName],
    ][]) {
      await this.setUserEnabled(user, true);
      for (const group of ["engineering", "admins"] as TestGroupName[]) {
        if (details.groups.includes(group)) await this.addToGroup(user, group);
        else await this.removeFromGroup(user, group);
      }
    }
  },
  async signIn(page, user, password = TEST_PASSWORD) {
    const identifier = page.locator('input[name="uidField"]');
    await identifier.fill(user);
    await identifier.press("Enter");
    await identifier.waitFor({ state: "detached" });
    const secret = page.locator('input[name="password"]');
    await secret.waitFor({ state: "visible" });
    await secret.fill(password);
    await secret.press("Enter");
    await secret.waitFor({ state: "detached" });
  },
};

export const identityProviders: readonly IdentityProviderFixture[] = [keycloak, authentik];
