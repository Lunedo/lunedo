import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError } from "../authorization/service.js";
import { runWithRequestContext } from "../observability/request-context.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { type FakeOidcProvider, startFakeOidcProvider } from "../testing/fake-oidc.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { instanceUrlSetting } from "./instance-settings.js";
import { accountPrincipal, SYSTEM } from "./principal.js";

const baseUrl = testDatabaseBaseUrl();
const BASE = "https://pagehall.test";
const PASSWORD = "a long test passphrase";

describe.skipIf(!baseUrl)("placeholders and anonymization", () => {
  let test: TestServices;
  let idp: FakeOidcProvider;
  let providerId: string;
  let administrator: string;
  let ownerId: string;
  const domain = `${randomUUID().slice(0, 8)}.example`;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.settings.set(instanceUrlSetting, {}, "instance", "https://wiki.example.org");
    idp = await startFakeOidcProvider();
    const owner = await account(null);
    ownerId = owner.id;
    await test.pool.query(
      "insert into instance (id, owner_account_id, setup_completed_at) values (1, $1, now())",
      [owner.id],
    );
    administrator = (await account(null)).id;
    await test.services.roles.assign(SYSTEM, {
      scope: "instance",
      organizationId: null,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: administrator },
    });
    providerId = (
      await test.services.identityProviders.create(SYSTEM, {
        type: "oidc",
        name: "Test provider",
        config: {
          preset: "generic",
          issuer: idp.issuer,
          clientId: idp.clientId,
          domains: [domain],
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
  });

  afterAll(async () => {
    await idp?.close();
    await test?.close();
  });

  async function account(home: string | null, email = `${randomUUID()}@other.example`, name = "Person") {
    return test.database.transaction((tx) =>
      test.services.accounts.createStandard(tx, {
        email,
        name,
        password: PASSWORD,
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

  async function signIn(claims: Record<string, unknown>, ip = "192.0.2.10") {
    const started = await test.services.providerSignIn.start({
      providerId,
      purpose: "signIn",
      baseUrl: BASE,
    });
    const callback = await idp.authorize(started.url, claims);
    return runWithRequestContext({ requestId: randomUUID(), clientIp: ip, userAgent: "Test agent" }, () =>
      test.services.providerSignIn.callback({
        providerId,
        query: callback.searchParams,
        browserToken: started.browserToken,
        client: { ip, userAgent: "Test agent" },
      }),
    );
  }

  async function state(accountId: string) {
    const result = await test.pool.query<{
      state: string;
      email: string | null;
      merged_into_id: string | null;
    }>("select state, email, merged_into_id from accounts where id = $1", [accountId]);
    return result.rows[0];
  }

  it("creates placeholders only for administrators of accounts", async () => {
    const person = await account(null);
    await expect(
      test.services.accountLifecycle.createPlaceholder(accountPrincipal(person.id), {
        name: "Imported Author",
        email: `imported.${randomUUID().slice(0, 6)}@${domain}`,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const placeholder = await test.services.accountLifecycle.createPlaceholder(
      accountPrincipal(administrator),
      {
        name: "Imported Author",
        email: `imported.${randomUUID().slice(0, 6)}@${domain}`,
      },
    );
    expect(await state(placeholder.id)).toMatchObject({ state: "placeholder" });
    const events = await test.pool.query(
      "select 1 from audit_events where name = 'account.placeholderCreated' and target_id = $1",
      [placeholder.id],
    );
    expect(events.rowCount).toBe(1);
  });

  it("turns a placeholder into the account at the first sign-in with a verified matching address", async () => {
    const org = await organization();
    const email = `author.${randomUUID().slice(0, 6)}@${domain}`;
    const placeholder = await test.services.accountLifecycle.createPlaceholder(
      accountPrincipal(administrator),
      {
        name: "Imported Author",
        email,
      },
    );
    await test.database.transaction((tx) =>
      test.services.memberships.add(tx, SYSTEM, {
        organizationId: org.id,
        accountId: placeholder.id,
        kind: "member",
      }),
    );
    const result = await signIn({ sub: randomUUID(), email, name: "Real Author" });
    if (result.kind !== "signedIn") throw new Error(`Signed in expected, got ${result.kind}`);
    expect(result.signedIn.session.accountId).toBe(placeholder.id);
    expect(await state(placeholder.id)).toMatchObject({ state: "active", email });
    const membership = await test.pool.query(
      "select kind from memberships where account_id = $1 and organization_id = $2",
      [placeholder.id, org.id],
    );
    expect(membership.rows).toEqual([{ kind: "member" }]);
    const events = await test.pool.query<{ fields: { via: string; memberships: number } }>(
      "select fields from audit_events where name = 'account.placeholderMerged' and target_id = $1",
      [placeholder.id],
    );
    expect(events.rows[0]?.fields).toMatchObject({ via: "signIn", memberships: 1 });
  });

  it("refuses to merge a placeholder at sign-in when the address is not verified by the provider", async () => {
    const email = `unverified.${randomUUID().slice(0, 6)}@unlisted.example`;
    const placeholder = await test.services.accountLifecycle.createPlaceholder(
      accountPrincipal(administrator),
      {
        name: "Unverified Author",
        email,
      },
    );
    const result = await signIn({ sub: randomUUID(), email, name: "Someone" });
    expect(result.kind).toBe("refused");
    expect(await state(placeholder.id)).toMatchObject({ state: "placeholder", email });
    const linked = await test.pool.query("select 1 from identities where account_id = $1", [placeholder.id]);
    expect(linked.rowCount).toBe(0);
  });

  it("lets administrators merge a placeholder into another account, never into their own", async () => {
    const org = await organization();
    const placeholder = await test.services.accountLifecycle.createPlaceholder(
      accountPrincipal(administrator),
      {
        name: "Old Name",
        email: `old.${randomUUID().slice(0, 6)}@other.example`,
      },
    );
    await test.database.transaction((tx) =>
      test.services.memberships.add(tx, SYSTEM, {
        organizationId: org.id,
        accountId: placeholder.id,
        kind: "member",
      }),
    );
    const group = await test.services.groups.create(accountPrincipal(org.owner), org.id, {
      name: `G ${randomUUID().slice(0, 6)}`,
    });
    await test.pool.query("insert into group_members (group_id, account_id) values ($1, $2)", [
      group.id,
      placeholder.id,
    ]);
    await test.pool.query(
      "insert into role_assignments (id, scope, organization_id, principal_kind, principal_id, built_in_role) values (gen_random_uuid(), 'organization', $1, 'account', $2, 'administrator')",
      [org.id, placeholder.id],
    );
    await expect(
      test.services.accountLifecycle.mergePlaceholder(
        accountPrincipal(administrator),
        placeholder.id,
        administrator,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const target = await account(null);
    const plain = await account(null);
    await expect(
      test.services.accountLifecycle.mergePlaceholder(accountPrincipal(plain.id), placeholder.id, target.id),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const counts = await test.services.accountLifecycle.mergePlaceholder(
      accountPrincipal(administrator),
      placeholder.id,
      target.id,
    );
    expect(counts).toEqual({ memberships: 1, groups: 1, roles: 1 });
    expect(await state(placeholder.id)).toMatchObject({
      state: "placeholder",
      email: null,
      merged_into_id: target.id,
    });
    const moved = await test.pool.query(
      `select (select count(*)::int from memberships where account_id = $1) as memberships,
        (select count(*)::int from group_members where account_id = $1) as groups,
        (select count(*)::int from role_assignments where principal_id = $1) as roles`,
      [target.id],
    );
    expect(moved.rows[0]).toEqual({ memberships: 1, groups: 1, roles: 1 });
    expect((await test.services.accounts.get(target.id))?.homeOrganizationId).toBe(org.id);
    await expect(
      test.services.accountLifecycle.mergePlaceholder(
        accountPrincipal(administrator),
        placeholder.id,
        target.id,
      ),
    ).rejects.toMatchObject({ code: "notPlaceholder" });
  });

  it("leaves no personal data of an anonymized account readable in the database, while the audit chain verifies", async () => {
    const org = await organization();
    const marker = randomUUID().slice(0, 8);
    const name = `Anna Erasure ${marker}`;
    const email = `anna.${marker}@${domain}`;
    const signInName = `anna-${marker}`;
    const ip = `198.51.100.${Math.floor(Math.random() * 200) + 20}`;
    const result = await signIn({ sub: randomUUID(), email, name, preferred_username: signInName }, ip);
    if (result.kind !== "signedIn") throw new Error(`Signed in expected, got ${result.kind}`);
    const accountId = result.signedIn.session.accountId;
    await test.database.transaction((tx) =>
      test.services.memberships.add(tx, SYSTEM, { organizationId: org.id, accountId, kind: "member" }),
    );
    await test.services.roles.assign(accountPrincipal(org.owner), {
      scope: "organization",
      organizationId: org.id,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: accountId },
    });
    await test.services.apiTokens.create(accountPrincipal(accountId), {
      accountId,
      name: "Personal token",
      organizationId: org.id,
      scopes: { organization: { membersAndGroups: "view" } },
      expiresAt: null,
    });
    await test.database.transaction(async (tx) => {
      await test.services.mail.queue(tx, { to: email, template: "smtpTest", language: "en", params: {} });
      await test.services.notifications.notify(tx, {
        type: "account.withoutOrganization",
        recipients: [administrator],
        organizationId: null,
        targetId: accountId,
        params: { accountName: name, email, providerName: "Test provider" },
      });
    });
    await test.pool.query(
      "insert into setting_values (id, level, scope_id, key, value) values (gen_random_uuid(), 'user', $1, 'appearance.colorMode', '\"dark\"')",
      [accountId],
    );

    await expect(
      test.services.accountLifecycle.anonymize(accountPrincipal(administrator), accountId, {
        reason: "Erasure request",
        confirmation: "Someone else",
      }),
    ).rejects.toMatchObject({ code: "confirmationMismatch" });
    for (const reason of [" ", "x".repeat(501)]) {
      await expect(
        test.services.accountLifecycle.anonymize(accountPrincipal(administrator), accountId, {
          reason,
          confirmation: name,
        }),
      ).rejects.toMatchObject({ code: "invalidInput" });
    }
    await expect(
      test.services.accountLifecycle.anonymize(accountPrincipal(org.owner), accountId, {
        reason: "Erasure request",
        confirmation: name,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const done = await test.services.accountLifecycle.anonymize(accountPrincipal(administrator), accountId, {
      reason: "Erasure request",
      confirmation: name,
    });
    expect(done).toMatchObject({ endedSessions: 1, removedIdentities: 1, endedMemberships: 1 });
    expect(await state(accountId)).toMatchObject({ state: "anonymized", email: null });

    const tables = await test.pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'",
    );
    const found: string[] = [];
    for (const { table_name: table } of tables.rows) {
      const rows = await test.pool.query<{ row: string }>(`select t::text as row from "${table}" t`);
      for (const { row } of rows.rows) {
        const text = row.toLowerCase();
        for (const value of [name, email, signInName, ip]) {
          if (text.includes(value.toLowerCase())) found.push(`${table}: ${value}: ${row.slice(0, 400)}`);
        }
      }
    }
    expect(found).toEqual([]);
    expect((await test.services.audit.verify()).every((chain) => chain.broken === null)).toBe(true);

    const events = await test.services.auditReader.list(accountPrincipal(administrator), {
      targetId: accountId,
    });
    expect(events.items.length).toBeGreaterThan(0);
    expect(events.items.every((item) => item.formerSubjects.includes(accountId))).toBe(true);
  });

  it("refuses to anonymize the instance owner or the own account", async () => {
    await expect(
      test.services.accountLifecycle.anonymize(accountPrincipal(administrator), ownerId, {
        reason: "Test",
        confirmation: "Person",
      }),
    ).rejects.toMatchObject({ code: "instanceOwner" });
    await expect(
      test.services.accountLifecycle.anonymize(accountPrincipal(administrator), administrator, {
        reason: "Test",
        confirmation: "Person",
      }),
    ).rejects.toMatchObject({ code: "anonymizeSelf" });
  });
});
