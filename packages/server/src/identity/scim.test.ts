import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import type { JobQueue } from "../jobs/job-queue.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { type FakeOidcProvider, startFakeOidcProvider } from "../testing/fake-oidc.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import type { IdentityProviderAdapter } from "./adapter.js";
import { ScimError } from "./scim-protocol.js";
import { ProviderSyncService } from "./sync.js";

const baseUrl = testDatabaseBaseUrl();
const BASE = "https://wiki.example.org/scim/v2/provider";

describe.skipIf(!baseUrl)("SCIM provisioning", () => {
  let test: TestServices;
  let idp: FakeOidcProvider;
  let providerId: string;
  let organizationId: string;
  let ownerId: string;
  const domain = `${randomUUID().slice(0, 8)}.example`;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
    await test.settings.set(instanceUrlSetting, {}, "instance", "https://wiki.example.org");
    idp = await startFakeOidcProvider();
    providerId = (
      await test.services.identityProviders.create(SYSTEM, {
        type: "oidc",
        name: "Keycloak",
        config: {
          preset: "generic",
          issuer: idp.issuer,
          clientId: idp.clientId,
          domains: [domain],
          accountCreation: { enabled: false, requiredGroups: [] },
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
    const owner = await test.database.transaction((tx) =>
      test.services.accounts.createStandard(tx, {
        email: `owner@${randomUUID().slice(0, 6)}.example`,
        name: "Owner",
        password: "a long test passphrase",
        homeOrganizationId: null,
      }),
    );
    ownerId = owner.id;
    organizationId = (
      await test.services.organizations.createAsActor(SYSTEM, { name: "Platform", ownerAccountId: owner.id })
    ).id;
  });

  afterAll(async () => {
    await idp?.close();
    await test?.close();
  });

  function user(subject = randomUUID()) {
    const local = `u${subject.slice(0, 8)}`;
    return {
      subject,
      body: {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
        externalId: subject,
        userName: `${local}@${domain}`,
        displayName: "Grace Hopper",
        emails: [{ value: `${local}@${domain}`, type: "work", primary: true }],
        active: true,
      },
    };
  }

  it("links the identity of a provisioned account, so the first sign-in signs it in even without account creation", async () => {
    const { subject, body } = user();
    const created = await test.services.scim.createUser(providerId, BASE, body);
    const started = await test.services.providerSignIn.start({
      providerId,
      purpose: "signIn",
      baseUrl: "https://lunedo.test",
    });
    const callback = await idp.authorize(started.url, {
      sub: subject,
      email: body.userName,
      name: "Grace Hopper",
    });
    const result = await test.services.providerSignIn.callback({
      providerId,
      query: callback.searchParams,
      browserToken: started.browserToken,
      client: {},
    });
    if (result.kind !== "signedIn") throw new Error(`Signed in expected, got ${result.kind}`);
    const identity = await test.pool.query<{ account_id: string }>(
      "select account_id from identities where id = $1",
      [created.id],
    );
    expect(result.signedIn.session.accountId).toBe(identity.rows[0]?.account_id);
  });

  it("creates each user once when two nodes receive the same request at the same time", async () => {
    const { body } = user();
    const other = test.anotherNode();
    const results = await Promise.allSettled([
      test.services.scim.createUser(providerId, BASE, body),
      other.scim.createUser(providerId, BASE, body),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((result) => result.status === "rejected");
    expect((refused as PromiseRejectedResult).reason).toBeInstanceOf(ScimError);
    expect(((refused as PromiseRejectedResult).reason as ScimError).status).toBe(409);
    const accounts = await test.pool.query("select 1 from accounts where lower(email) = lower($1)", [
      body.userName,
    ]);
    expect(accounts.rowCount).toBe(1);
  });

  it("keeps one grant when a SCIM membership change and a reconciliation run for the same account at once", async () => {
    const group = await test.services.scim.createGroup(providerId, BASE, {
      externalId: `group-${randomUUID()}`,
      displayName: "Engineering",
    });
    await test.services.mappingRules.create(accountPrincipal(ownerId), providerId, {
      target: "organization",
      group: { id: group.externalId, name: "Engineering" },
      organizationId,
      role: { builtIn: "administrator" },
      synchronizedGroup: true,
      homeOrganization: false,
    });
    const created = await test.services.scim.createUser(providerId, BASE, user().body);
    const accountId = (
      await test.pool.query<{ account_id: string }>("select account_id from identities where id = $1", [
        created.id,
      ])
    ).rows[0]?.account_id as string;
    const other = test.anotherNode();
    await Promise.all([
      test.services.scim.patchGroup(providerId, BASE, group.id, {
        Operations: [{ op: "add", path: "members", value: [{ value: created.id }] }],
      }),
      other.scim.patchGroup(providerId, BASE, group.id, {
        Operations: [{ op: "add", path: "members", value: [{ value: created.id }] }],
      }),
      test.database.transaction((tx) =>
        test.services.groupMapping.reconcile(tx, accountId, { changes: [], warnings: [], mailIds: [] }),
      ),
    ]);
    const grants = await test.pool.query<{ kind: string }>(
      "select kind from provider_grants where account_id = $1 order by kind",
      [accountId],
    );
    expect(grants.rows.map((row) => row.kind).sort()).toEqual(["groupMember", "membership", "role"]);
    const roles = await test.pool.query(
      "select 1 from role_assignments where principal_id = $1 and organization_id = $2",
      [accountId, organizationId],
    );
    expect(roles.rowCount).toBe(1);
  });

  it("takes over a placeholder with the verified address of the provisioned user", async () => {
    const { body } = user();
    const placeholder = await test.services.accountLifecycle.createPlaceholder(SYSTEM, {
      name: "Imported Grace",
      email: body.userName,
    });
    const created = await test.services.scim.createUser(providerId, BASE, body);
    const identity = await test.pool.query<{ account_id: string }>(
      "select account_id from identities where id = $1",
      [created.id],
    );
    expect(identity.rows[0]?.account_id).toBe(placeholder.id);
    const state = await test.pool.query<{ state: string }>("select state from accounts where id = $1", [
      placeholder.id,
    ]);
    expect(state.rows[0]?.state).toBe("active");
  });

  it("refuses to link an existing account by its e-mail address", async () => {
    const { body } = user();
    await test.database.transaction((tx) =>
      test.services.accounts.createStandard(tx, {
        email: body.userName,
        name: "Existing",
        password: "a long test passphrase",
        homeOrganizationId: null,
      }),
    );
    await expect(test.services.scim.createUser(providerId, BASE, body)).rejects.toMatchObject({
      status: 409,
      scimType: "uniqueness",
    });
  });

  it("runs the synchronization of a provider with SCIM once a day as a reconciliation", async () => {
    const queued: { trigger: string }[] = [];
    const jobs = {
      enqueue: async (_definition: unknown, payload: { trigger: string; providerId: string }) => {
        if (payload.providerId === providerId) queued.push({ trigger: payload.trigger });
        return randomUUID();
      },
    } as unknown as JobQueue;
    const directory: IdentityProviderAdapter = {
      type: "oidc",
      authorizationUrl: async () => ({ url: new URL("https://idp.example"), requestId: null }),
      completeSignIn: async () => {
        throw new Error("not used");
      },
      hasDirectory: () => true,
      async *synchronizeAccounts() {},
    };
    const sync = new ProviderSyncService({
      database: test.database,
      providers: test.services.identityProviders,
      adapters: [directory],
      mapping: test.services.groupMapping,
      memberships: test.services.memberships,
      administration: test.services.administration,
      audit: test.services.audit,
      settings: test.settings,
      jobs,
    });
    const ranHoursAgo = async (hours: number) => {
      await test.pool.query("delete from provider_sync_runs where provider_id = $1", [providerId]);
      await test.pool.query(
        "insert into provider_sync_runs (id, provider_id, trigger, status, started_at, finished_at) values (gen_random_uuid(), $1, 'schedule', 'succeeded', now() - make_interval(hours => $2), now())",
        [providerId, hours],
      );
    };
    await ranHoursAgo(2);
    await sync.scheduleDue();
    expect(queued).toEqual([{ trigger: "schedule" }]);

    const created = await test.services.scimTokens.create(SYSTEM, providerId);
    queued.length = 0;
    await sync.scheduleDue();
    expect(queued).toEqual([]);
    await ranHoursAgo(25);
    await sync.scheduleDue();
    expect(queued).toEqual([{ trigger: "reconciliation" }]);
    await test.services.scimTokens.remove(SYSTEM, providerId, created.id);
  });
});
