import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import { ForbiddenError } from "../authorization/service.js";
import { OrganizationError } from "../organizations/organizations.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { type FakeOidcProvider, startFakeOidcProvider } from "../testing/fake-oidc.js";
import {
  defaultGraphData,
  type FakeGoogleDirectory,
  type FakeGraph,
  GOOGLE_IDS,
  GOOGLE_SERVICE_ACCOUNT,
  GRAPH_CLIENT_ID,
  GRAPH_CLIENT_SECRET,
  GRAPH_IDS,
  GRAPH_OVERAGE_GROUP_COUNT,
  GRAPH_TENANT_ID,
  startFakeGoogleDirectory,
  startFakeGraph,
} from "../testing/fakes/index.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { OidcAdapter } from "./oidc.js";
import { identities } from "./schema.js";
import type { CallbackResult } from "./sign-in.js";

const baseUrl = testDatabaseBaseUrl();
const BASE = "https://pagehall.test";

describe.skipIf(!baseUrl)("group synchronization and mapping rules", () => {
  let test: TestServices;
  let idp: FakeOidcProvider;
  let graph: FakeGraph;
  let google: FakeGoogleDirectory;
  let generic: string;
  let entra: string;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
    await test.settings.set(instanceUrlSetting, {}, "instance", "https://wiki.example.org");
    idp = await startFakeOidcProvider();
    graph = await startFakeGraph();
    google = await startFakeGoogleDirectory();
    generic = (
      await test.services.identityProviders.create(SYSTEM, {
        name: "Keycloak",
        config: {
          preset: "generic",
          issuer: idp.issuer,
          clientId: idp.clientId,
          domains: ["generic.example"],
          accountCreation: { enabled: true, requiredGroups: [] },
          claims: {
            email: "email",
            signInName: "preferred_username",
            displayName: "name",
            groups: "groups",
            groupNames: "group_names",
          },
        },
        credential: { kind: "clientSecret", secret: idp.clientSecret, expiresAt: null },
      })
    ).provider.id;
    entra = (
      await test.services.identityProviders.create(SYSTEM, {
        name: "Entra ID",
        config: {
          preset: "entraId",
          clientId: GRAPH_CLIENT_ID,
          tenantId: GRAPH_TENANT_ID,
          authority: graph.url,
          graphUrl: graph.url,
          domains: ["entra.example"],
        },
        credential: { kind: "clientSecret", secret: GRAPH_CLIENT_SECRET, expiresAt: null },
      })
    ).provider.id;
  });

  afterAll(async () => {
    await idp?.close();
    await graph?.close();
    await google?.close();
    await test?.close();
  });

  async function account(home: string | null, email = `${randomUUID()}@example.org`) {
    return test.database.transaction((tx) =>
      test.services.accounts.createStandard(tx, {
        email,
        name: `Person ${email.slice(0, 6)}`,
        password: "a long test passphrase",
        homeOrganizationId: home,
      }),
    );
  }

  async function organization() {
    const owner = await account(null);
    const created = await test.services.organizations.createAsActor(SYSTEM, {
      name: `Organization ${randomUUID().slice(0, 8)}`,
      ownerAccountId: owner.id,
    });
    return { id: created.id, owner: owner.id };
  }

  async function signIn(claims: Record<string, unknown>): Promise<CallbackResult> {
    const started = await test.services.providerSignIn.start({
      providerId: generic,
      purpose: "signIn",
      baseUrl: BASE,
    });
    const callback = await idp.authorize(started.url, claims);
    return test.services.providerSignIn.callback({
      providerId: generic,
      query: callback.searchParams,
      browserToken: started.browserToken,
      client: {},
    });
  }

  async function signedInAccount(result: CallbackResult): Promise<string> {
    if (result.kind !== "signedIn") throw new Error(`Signed in expected, got ${result.kind}`);
    return result.signedIn.session.accountId;
  }

  async function membership(organizationId: string, accountId: string) {
    const result = await test.pool.query<{ kind: string }>(
      "select kind from memberships where organization_id = $1 and account_id = $2",
      [organizationId, accountId],
    );
    return result.rows[0]?.kind ?? null;
  }

  async function roles(accountId: string) {
    const result = await test.pool.query<{ scope: string; role: string }>(
      "select scope, built_in_role as role from role_assignments where principal_kind = 'account' and principal_id = $1 order by scope, built_in_role",
      [accountId],
    );
    return result.rows;
  }

  async function link(providerId: string, accountId: string, subject: string) {
    const [created] = await test.database
      .insert(identities)
      .values({
        accountId,
        providerId,
        subject,
        email: null,
        emailVerified: false,
        signInName: null,
        displayName: null,
      })
      .returning({ id: identities.id });
    return created?.id ?? "";
  }

  it("grants access through a rule at sign-in and removes only that access when the person leaves the group", async () => {
    const org = await organization();
    const group = `group-${randomUUID()}`;
    await test.services.mappingRules.create(accountPrincipal(org.owner), generic, {
      target: "organization",
      group: { id: group, name: "Engineering" },
      organizationId: org.id,
      role: { builtIn: "administrator" },
      synchronizedGroup: false,
      homeOrganization: false,
    });
    const subject = randomUUID();
    const claims = {
      sub: subject,
      email: `${subject.slice(0, 8)}@generic.example`,
      name: "Grace",
      groups: [group],
      group_names: ["Engineering"],
    };
    const person = await signedInAccount(await signIn(claims));
    expect(await membership(org.id, person)).toBe("member");
    expect(await roles(person)).toEqual([{ scope: "organization", role: "administrator" }]);

    await signedInAccount(await signIn({ ...claims, groups: [], group_names: [] }));
    expect(await membership(org.id, person)).toBeNull();
    expect(await roles(person)).toEqual([]);

    await test.database.transaction((tx) =>
      test.services.memberships.add(tx, SYSTEM, {
        organizationId: org.id,
        accountId: person,
        kind: "member",
      }),
    );
    await signedInAccount(await signIn(claims));
    await signedInAccount(await signIn({ ...claims, groups: [], group_names: [] }));
    expect(await membership(org.id, person)).toBe("member");
    expect(await roles(person)).toEqual([]);
  });

  it("refuses a rule that would grant more than its creator may grant", async () => {
    const org = await organization();
    const administrator = await account(org.id);
    await test.services.roles.assign(SYSTEM, {
      scope: "organization",
      organizationId: org.id,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: administrator.id },
    });
    const rule = (role: "owner" | "administrator") => ({
      target: "organization" as const,
      group: { id: `group-${randomUUID()}`, name: null },
      organizationId: org.id,
      role: { builtIn: role },
      synchronizedGroup: false,
      homeOrganization: false,
    });
    await expect(
      test.services.mappingRules.create(accountPrincipal(administrator.id), generic, rule("owner")),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      test.services.mappingRules.create(accountPrincipal(administrator.id), generic, {
        target: "instance",
        group: { id: `group-${randomUUID()}`, name: null },
        role: { builtIn: "administrator" },
      }),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      test.services.mappingRules.create(accountPrincipal(administrator.id), generic, rule("administrator")),
    ).resolves.toMatchObject({ role: { builtIn: "administrator" } });
  });

  it("keeps mapping a group by its ID when the provider renames it", async () => {
    const org = await organization();
    const group = `group-${randomUUID()}`;
    await test.services.mappingRules.create(accountPrincipal(org.owner), generic, {
      target: "organization",
      group: { id: group, name: "Old name" },
      organizationId: org.id,
      role: null,
      synchronizedGroup: false,
      homeOrganization: false,
    });
    const subject = randomUUID();
    const person = await signedInAccount(
      await signIn({
        sub: subject,
        email: `${subject.slice(0, 8)}@generic.example`,
        groups: [group],
        group_names: ["New name"],
      }),
    );
    expect(await membership(org.id, person)).toBe("member");
    const renamed = (await test.services.mappingRules.list(generic)).find(
      (entry) => entry.group.id === group,
    );
    expect(renamed?.group).toEqual({ id: group, name: "New name", missing: false });
  });

  it("grants instance roles through rules and never through organization groups", async () => {
    const owner = await account(null);
    await test.pool.query("update instance set owner_account_id = $1", [owner.id]);
    const group = `group-${randomUUID()}`;
    await test.services.mappingRules.create(accountPrincipal(owner.id), generic, {
      target: "instance",
      group: { id: group, name: "Auditors" },
      role: { builtIn: "securityAuditor" },
    });
    const subject = randomUUID();
    const claims = { sub: subject, email: `${subject.slice(0, 8)}@generic.example`, groups: [group] };
    const person = await signedInAccount(await signIn(claims));
    expect(await roles(person)).toEqual([{ scope: "instance", role: "securityAuditor" }]);
    await signedInAccount(await signIn({ ...claims, groups: [] }));
    expect(await roles(person)).toEqual([]);
    await test.pool.query("update instance set owner_account_id = null");
  });

  it("makes synchronized groups read-only and names the provider", async () => {
    const org = await organization();
    const group = `group-${randomUUID()}`;
    const rule = await test.services.mappingRules.create(accountPrincipal(org.owner), generic, {
      target: "organization",
      group: { id: group, name: `Synced ${group.slice(6, 12)}` },
      organizationId: org.id,
      role: null,
      synchronizedGroup: true,
      homeOrganization: false,
    });
    const groupId = rule.synchronizedGroup?.id ?? "";
    const subject = randomUUID();
    const person = await signedInAccount(
      await signIn({ sub: subject, email: `${subject.slice(0, 8)}@generic.example`, groups: [group] }),
    );
    const details = await test.services.groups.get(groupId);
    expect(details?.managedBy).toEqual({ providerId: generic, providerName: "Keycloak" });
    const members = await test.pool.query("select account_id from group_members where group_id = $1", [
      groupId,
    ]);
    expect(members.rows).toEqual([{ account_id: person }]);
    const other = await account(org.id);
    await expect(
      test.services.groups.addMember(accountPrincipal(org.owner), groupId, other.id),
    ).rejects.toMatchObject({ code: "groupManagedByProvider" });
    await expect(
      test.services.groups.update(accountPrincipal(org.owner), groupId, { name: "Renamed" }),
    ).rejects.toThrow(OrganizationError);
  });

  it("deactivates accounts disabled or deleted in the provider and reactivates only its own", async () => {
    const org = await organization();
    const frank = await account(org.id);
    const alice = await account(org.id);
    const bob = await account(org.id);
    await link(entra, frank.id, `${GRAPH_TENANT_ID}:${GRAPH_IDS.frank}`);
    await link(entra, alice.id, `${GRAPH_TENANT_ID}:${GRAPH_IDS.alice}`);
    await link(entra, bob.id, `${GRAPH_TENANT_ID}:${GRAPH_IDS.bob}`);
    await test.database.transaction((tx) =>
      test.services.sessions.create(tx, {
        accountId: frank.id,
        kind: "full",
        methods: ["password"],
        client: {},
      }),
    );

    const first = await test.services.providerSync.run(entra, "manual");
    expect(first?.status).toBe("succeeded");
    expect((await test.services.accounts.get(frank.id))?.state).toBe("deactivated");
    expect((await test.services.accounts.get(alice.id))?.state).toBe("active");
    const sessions = await test.pool.query("select 1 from sessions where account_id = $1", [frank.id]);
    expect(sessions.rows).toHaveLength(0);

    graph.setAccountEnabled(GRAPH_IDS.frank, true);
    await test.services.memberships.deactivate(SYSTEM, bob.id);
    await test.services.providerSync.run(entra, "manual");
    expect((await test.services.accounts.get(frank.id))?.state).toBe("active");
    expect((await test.services.accounts.get(bob.id))?.state).toBe("deactivated");

    graph.deleteUser(GRAPH_IDS.alice);
    const third = await test.services.providerSync.run(entra, "manual");
    expect((await test.services.accounts.get(alice.id))?.state).toBe("deactivated");
    const details = await test.services.providerSync.runDetails(entra, third?.id ?? "");
    expect(details?.changes).toContainEqual(
      expect.objectContaining({ kind: "accountDeactivated", accountId: alice.id, detail: "deleted" }),
    );
  });

  it("marks a rule whose group no longer exists and grants nothing through it", async () => {
    const org = await organization();
    const dave = await account(null);
    await link(entra, dave.id, `${GRAPH_TENANT_ID}:${GRAPH_IDS.dave}`);
    const missing = randomUUID();
    const rule = await test.services.mappingRules.create(accountPrincipal(org.owner), entra, {
      target: "organization",
      group: { id: missing, name: "Gone" },
      organizationId: org.id,
      role: null,
      synchronizedGroup: false,
      homeOrganization: false,
    });
    await test.services.mappingRules.create(accountPrincipal(org.owner), entra, {
      target: "organization",
      group: { id: GRAPH_IDS.engineering, name: "Engineering" },
      organizationId: org.id,
      role: null,
      synchronizedGroup: false,
      homeOrganization: false,
    });
    const run = await test.services.providerSync.run(entra, "manual");
    expect(run?.status).toBe("warnings");
    const details = await test.services.providerSync.runDetails(entra, run?.id ?? "");
    expect(details?.warnings).toContainEqual(
      expect.objectContaining({ kind: "missingGroup", ruleId: rule.id }),
    );
    const rules = await test.services.mappingRules.list(entra);
    expect(rules.find((entry) => entry.id === rule.id)?.group.missing).toBe(true);
    expect(await membership(org.id, dave.id)).toBe("member");
  });

  it("follows a renamed group in the directory during synchronization", async () => {
    graph.renameGroup(GRAPH_IDS.platform, "Platform Team");
    const org = await organization();
    await test.services.mappingRules.create(accountPrincipal(org.owner), entra, {
      target: "organization",
      group: { id: GRAPH_IDS.platform, name: "Platform" },
      organizationId: org.id,
      role: null,
      synchronizedGroup: false,
      homeOrganization: false,
    });
    const run = await test.services.providerSync.run(entra, "manual");
    const details = await test.services.providerSync.runDetails(entra, run?.id ?? "");
    expect(details?.changes).toContainEqual(
      expect.objectContaining({ kind: "groupRenamed", detail: "Platform → Platform Team" }),
    );
    const rule = (await test.services.mappingRules.list(entra)).find(
      (entry) => entry.group.id === GRAPH_IDS.platform,
    );
    expect(rule?.group.name).toBe("Platform Team");
  });

  it("reads every group of a person with a group overage through Microsoft Graph, page by page", async () => {
    const data = defaultGraphData();
    const extra = Array.from({ length: 1000 }, (_, index) => ({
      id: `bb000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      displayName: `Extra ${index}`,
      securityEnabled: true,
    }));
    data.groups.push(...extra);
    for (const group of extra) data.members[group.id] = [GRAPH_IDS.olga];
    const large = await startFakeGraph({ data });
    try {
      const loaded = await test.services.identityProviders.definition(entra);
      if (!loaded) throw new Error("Provider missing");
      const provider = {
        ...loaded.provider,
        config: { ...loaded.provider.config, graphUrl: large.url, authority: large.url },
      };
      const adapter = new OidcAdapter({ allowInsecure: true });
      const groups = await adapter.readGroups(
        provider,
        loaded.credentials,
        `${GRAPH_TENANT_ID}:${GRAPH_IDS.olga}`,
      );
      expect(groups).toHaveLength(GRAPH_OVERAGE_GROUP_COUNT + extra.length);
      expect(large.requests.filter((request) => request.includes("transitiveMemberOf"))).toHaveLength(2);
    } finally {
      await large.close();
    }
  });

  it("runs only one synchronization of a provider at a time", async () => {
    const runs = await Promise.all([
      test.services.providerSync.run(entra, "manual"),
      test.services.providerSync.run(entra, "manual"),
    ]);
    expect(runs.filter((run) => run !== null)).toHaveLength(1);
  });

  it("deactivates accounts suspended in the Google directory", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const provider = await test.services.identityProviders.create(SYSTEM, {
      name: "Google",
      config: {
        preset: "google",
        clientId: "google-client",
        domains: ["example.org"],
        directory: { adminEmail: "admin@example.org", url: google.url, tokenUrl: `${google.url}/token` },
      },
      credential: { kind: "clientSecret", secret: "google-secret", expiresAt: null },
    });
    await test.services.identityProviders.setDirectoryKey(
      SYSTEM,
      provider.provider.id,
      JSON.stringify({
        type: "service_account",
        client_email: GOOGLE_SERVICE_ACCOUNT,
        private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      }),
    );
    const sam = await account(null);
    const bob = await account(null);
    await link(provider.provider.id, sam.id, GOOGLE_IDS.sam);
    await link(provider.provider.id, bob.id, GOOGLE_IDS.bob);
    const run = await test.services.providerSync.run(provider.provider.id, "manual");
    expect(run?.error).toBeNull();
    expect((await test.services.accounts.get(sam.id))?.state).toBe("deactivated");
    expect((await test.services.accounts.get(bob.id))?.state).toBe("active");
  });

  it("removes old runs from the sync log", async () => {
    await test.pool.query(
      "insert into provider_sync_runs (id, provider_id, trigger, status, started_at, finished_at) values (gen_random_uuid(), $1, 'schedule', 'succeeded', now() - interval '200 days', now() - interval '200 days')",
      [entra],
    );
    expect(await test.services.providerSync.applyRetention()).toBeGreaterThanOrEqual(1);
  });
});
