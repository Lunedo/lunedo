import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import { passwordSignInSetting } from "../auth/settings.js";
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
import { withheldRoles } from "./withheld.js";

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
        type: "oidc",
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
        type: "oidc",
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
    const home = await organization();
    const homeGroup = `group-${randomUUID()}`;
    await test.services.mappingRules.create(accountPrincipal(home.owner), generic, {
      target: "organization",
      group: { id: homeGroup, name: "Staff" },
      organizationId: home.id,
      role: null,
      synchronizedGroup: false,
      homeOrganization: true,
    });
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
      groups: [group, homeGroup],
      group_names: ["Engineering", "Staff"],
    };
    const left = { ...claims, groups: [homeGroup], group_names: ["Staff"] };
    const person = await signedInAccount(await signIn(claims));
    expect(await membership(org.id, person)).toBe("member");
    expect(await roles(person)).toEqual([{ scope: "organization", role: "administrator" }]);
    expect((await test.services.accounts.get(person))?.homeOrganizationId).toBe(home.id);

    await signedInAccount(await signIn(left));
    expect(await membership(org.id, person)).toBeNull();
    expect(await membership(home.id, person)).toBe("member");
    expect(await roles(person)).toEqual([]);

    await test.database.transaction((tx) =>
      test.services.memberships.add(tx, SYSTEM, {
        organizationId: org.id,
        accountId: person,
        kind: "member",
      }),
    );
    await signedInAccount(await signIn(claims));
    await signedInAccount(await signIn(left));
    expect(await membership(org.id, person)).toBe("member");
    expect(await roles(person)).toEqual([]);
  });

  async function homeOf(accountId: string) {
    return (await test.services.accounts.get(accountId))?.homeOrganizationId ?? null;
  }

  async function withoutOrganizationNotices(accountId: string) {
    const result = await test.pool.query(
      "select 1 from notifications where type = 'account.withoutOrganization' and target_id = $1",
      [accountId],
    );
    return result.rowCount;
  }

  it("makes the first organization a rule leads into the home organization, preferring a rule that names one", async () => {
    const first = await organization();
    const second = await organization();
    const firstGroup = `group-${randomUUID()}`;
    const secondGroup = `group-${randomUUID()}`;
    await test.services.mappingRules.create(accountPrincipal(first.owner), generic, {
      target: "organization",
      group: { id: firstGroup, name: "First" },
      organizationId: first.id,
      role: null,
      synchronizedGroup: false,
      homeOrganization: false,
    });
    await test.services.mappingRules.create(accountPrincipal(second.owner), generic, {
      target: "organization",
      group: { id: secondGroup, name: "Second" },
      organizationId: second.id,
      role: null,
      synchronizedGroup: false,
      homeOrganization: false,
    });
    const claims = (groups: string[]) => {
      const subject = randomUUID();
      return { sub: subject, email: `${subject.slice(0, 8)}@generic.example`, groups };
    };

    const only = await signedInAccount(await signIn(claims([secondGroup])));
    expect(await homeOf(only)).toBe(second.id);
    expect(await withoutOrganizationNotices(only)).toBe(0);

    const rules = await test.services.mappingRules.list(generic);
    const named = rules.find((rule) => rule.group.id === secondGroup);
    if (!named) throw new Error("The rule was not found");
    await test.services.mappingRules.update(accountPrincipal(second.owner), generic, named.id, {
      target: "organization",
      group: { id: secondGroup, name: "Second" },
      organizationId: second.id,
      role: null,
      synchronizedGroup: false,
      homeOrganization: true,
    });
    const both = await signedInAccount(await signIn(claims([firstGroup, secondGroup])));
    expect(await homeOf(both)).toBe(second.id);
    expect(await membership(first.id, both)).toBe("member");
  });

  it("gives an account with a standard membership but no home organization one at its next sign-in", async () => {
    const collaborating = await organization();
    const member = await organization();
    const subject = randomUUID();
    const claims = { sub: subject, email: `${subject.slice(0, 8)}@generic.example`, groups: [] };
    const person = await signedInAccount(await signIn(claims));
    expect(await homeOf(person)).toBeNull();
    await test.pool.query(
      "insert into memberships (id, organization_id, account_id, kind, created_at) values (gen_random_uuid(), $1, $3, 'collaborator', now() - interval '2 days'), (gen_random_uuid(), $2, $3, 'member', now() - interval '1 day')",
      [collaborating.id, member.id, person],
    );
    expect(await homeOf(person)).toBeNull();

    await signedInAccount(await signIn(claims));
    expect(await homeOf(person)).toBe(member.id);
  });

  it("never sets a home organization from a collaborator membership alone", async () => {
    const collaborating = await organization();
    const subject = randomUUID();
    const claims = { sub: subject, email: `${subject.slice(0, 8)}@generic.example`, groups: [] };
    const person = await signedInAccount(await signIn(claims));
    await test.pool.query(
      "insert into memberships (id, organization_id, account_id, kind) values (gen_random_uuid(), $1, $2, 'collaborator')",
      [collaborating.id, person],
    );
    await signedInAccount(await signIn(claims));
    expect(await homeOf(person)).toBeNull();
  });

  it("applies rules when an existing account is linked with its password", async () => {
    const org = await organization();
    const group = `group-${randomUUID()}`;
    await test.services.mappingRules.create(accountPrincipal(org.owner), generic, {
      target: "organization",
      group: { id: group, name: "Linked" },
      organizationId: org.id,
      role: { builtIn: "administrator" },
      synchronizedGroup: false,
      homeOrganization: false,
    });
    const existing = await account(null, `${randomUUID().slice(0, 8)}@generic.example`);
    const result = await signIn({ sub: randomUUID(), email: existing.email, groups: [group] });
    if (result.kind !== "linkRequired") throw new Error(`Linking expected, got ${result.kind}`);
    expect(await membership(org.id, existing.id)).toBeNull();

    await test.services.signIn.confirmIdentityLink({
      pendingToken: result.pendingToken,
      password: "a long test passphrase",
      factor: null,
      client: {},
    });
    expect(await membership(org.id, existing.id)).toBe("member");
    expect(await roles(existing.id)).toEqual([{ scope: "organization", role: "administrator" }]);
  });

  it("removes what the rules granted when an identity is unlinked", async () => {
    const home = await organization();
    const other = await organization();
    const group = `group-${randomUUID()}`;
    await test.services.mappingRules.create(accountPrincipal(other.owner), generic, {
      target: "organization",
      group: { id: group, name: "Admins" },
      organizationId: other.id,
      role: { builtIn: "administrator" },
      synchronizedGroup: false,
      homeOrganization: false,
    });
    const person = await account(home.id);
    const subject = randomUUID();
    const identityId = await link(generic, person.id, subject);
    await signedInAccount(await signIn({ sub: subject, email: person.email, groups: [group] }));
    expect(await membership(other.id, person.id)).toBe("member");
    expect(await roles(person.id)).toEqual([{ scope: "organization", role: "administrator" }]);

    await test.services.administration.unlinkIdentity(accountPrincipal(home.owner), person.id, identityId);
    expect(await membership(other.id, person.id)).toBeNull();
    expect(await roles(person.id)).toEqual([]);
  });

  async function removableProvider(name: string) {
    const domain = `removed-${randomUUID().slice(0, 8)}.example`;
    const created = await test.services.identityProviders.create(SYSTEM, {
      type: "oidc",
      name,
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
    });
    return { id: created.provider.id, domain };
  }

  async function signInThrough(
    provider: { id: string; domain: string },
    subject: string,
    groups: string[],
  ): Promise<CallbackResult> {
    const started = await test.services.providerSignIn.start({
      providerId: provider.id,
      purpose: "signIn",
      baseUrl: BASE,
    });
    const callback = await idp.authorize(started.url, {
      sub: subject,
      email: `${subject.slice(0, 8)}@${provider.domain}`,
      groups,
    });
    return test.services.providerSignIn.callback({
      providerId: provider.id,
      query: callback.searchParams,
      browserToken: started.browserToken,
      client: {},
    });
  }

  it("previews a removal, withdraws roles and keeps synchronized groups as ordinary groups", async () => {
    const org = await organization();
    const removable = await removableProvider("Removable");
    const group = `group-${randomUUID()}`;
    const rule = await test.services.mappingRules.create(accountPrincipal(org.owner), removable.id, {
      target: "organization",
      group: { id: group, name: `Admins ${group.slice(6, 12)}` },
      organizationId: org.id,
      role: { builtIn: "administrator" },
      synchronizedGroup: true,
      homeOrganization: false,
    });
    const groupId = rule.synchronizedGroup?.id ?? "";
    const person = await signedInAccount(await signInThrough(removable, randomUUID(), [group]));
    expect(await roles(person)).toEqual([{ scope: "organization", role: "administrator" }]);

    expect(await test.services.identityProviders.removalPreview(removable.id)).toEqual({
      accounts: 1,
      accountsWithoutSignIn: 1,
      groups: 1,
      rules: 1,
      grants: 2,
    });

    await test.services.identityProviders.remove(SYSTEM, removable.id);
    expect(await roles(person)).toEqual([]);
    expect(await membership(org.id, person)).toBe("member");
    const details = await test.services.groups.get(groupId);
    expect(details).toMatchObject({ managedBy: null, formerlySynchronizedFrom: "Removable" });
    const members = await test.pool.query("select account_id from group_members where group_id = $1", [
      groupId,
    ]);
    expect(members.rows).toEqual([{ account_id: person }]);
    const other = await account(org.id);
    await test.services.groups.addMember(accountPrincipal(org.owner), groupId, other.id);
    const sessions = await test.pool.query("select 1 from sessions where account_id = $1", [person]);
    expect(sessions.rows).toHaveLength(0);
    const audit = await test.pool.query<{ fields: Record<string, unknown> }>(
      "select fields from audit_events where name = 'identityProvider.removed' and target_id = $1",
      [removable.id],
    );
    expect(audit.rows[0]?.fields).toMatchObject({ name: "Removable", endedSessions: 1, releasedGroups: 1 });
  });

  it("counts only other working ways to sign in for the removal preview", async () => {
    const removable = await removableProvider("Counted");
    const withPassword = await account(null);
    await link(removable.id, withPassword.id, randomUUID());
    expect(await test.services.identityProviders.removalPreview(removable.id)).toMatchObject({
      accounts: 1,
      accountsWithoutSignIn: 0,
    });
    await test.settings.set(passwordSignInSetting, {}, "instance", false);
    try {
      expect(await test.services.identityProviders.removalPreview(removable.id)).toMatchObject({
        accountsWithoutSignIn: 1,
      });
      const elsewhere = await removableProvider("Elsewhere");
      await link(elsewhere.id, withPassword.id, randomUUID());
      expect(await test.services.identityProviders.removalPreview(removable.id)).toMatchObject({
        accountsWithoutSignIn: 0,
      });
      await test.services.identityProviders.deactivate(SYSTEM, elsewhere.id);
      expect(await test.services.identityProviders.removalPreview(removable.id)).toMatchObject({
        accountsWithoutSignIn: 1,
      });
    } finally {
      await test.settings.clear(passwordSignInSetting, {}, "instance");
    }
  });

  it("keeps everything of a deactivated provider but lets nobody sign in or synchronize through it", async () => {
    const org = await organization();
    const deactivated = await removableProvider("Paused");
    const group = `group-${randomUUID()}`;
    await test.services.mappingRules.create(accountPrincipal(org.owner), deactivated.id, {
      target: "organization",
      group: { id: group, name: "Paused admins" },
      organizationId: org.id,
      role: { builtIn: "administrator" },
      synchronizedGroup: false,
      homeOrganization: false,
    });
    const subject = randomUUID();
    const person = await signedInAccount(await signInThrough(deactivated, subject, [group]));
    const pending = await test.services.providerSignIn.start({
      providerId: deactivated.id,
      purpose: "signIn",
      baseUrl: BASE,
    });
    const pendingCallback = await idp.authorize(pending.url, {
      sub: subject,
      email: `${subject.slice(0, 8)}@${deactivated.domain}`,
      groups: [group],
    });

    const summary = await test.services.identityProviders.deactivate(SYSTEM, deactivated.id);
    expect(summary.deactivatedAt).toBeInstanceOf(Date);
    const sessions = await test.pool.query("select 1 from sessions where account_id = $1", [person]);
    expect(sessions.rows).toHaveLength(0);
    expect(await roles(person)).toEqual([{ scope: "organization", role: "administrator" }]);
    expect(await test.services.identityProviders.providerForDomain(deactivated.domain)).toBeNull();
    expect(
      (await test.services.identityProviders.signInProviders()).map((provider) => provider.id),
    ).not.toContain(deactivated.id);
    await expect(
      test.services.providerSignIn.start({ providerId: deactivated.id, purpose: "signIn", baseUrl: BASE }),
    ).rejects.toMatchObject({ code: "providerDeactivated" });
    await expect(
      test.services.providerSignIn.callback({
        providerId: deactivated.id,
        query: pendingCallback.searchParams,
        browserToken: pending.browserToken,
        client: {},
      }),
    ).rejects.toMatchObject({ code: "providerDeactivated" });
    await expect(test.services.providerSync.request(SYSTEM, deactivated.id)).rejects.toMatchObject({
      code: "providerDeactivated",
    });

    await test.services.identityProviders.activate(SYSTEM, deactivated.id);
    expect(await signedInAccount(await signInThrough(deactivated, subject, [group]))).toBe(person);
    const audit = await test.pool.query<{ name: string; fields: Record<string, unknown> }>(
      "select name, fields from audit_events where target_id = $1 and name in ('identityProvider.deactivated', 'identityProvider.activated') order by occurred_at",
      [deactivated.id],
    );
    expect(audit.rows).toEqual([
      { name: "identityProvider.deactivated", fields: { name: "Paused", endedSessions: 1 } },
      { name: "identityProvider.activated", fields: { name: "Paused" } },
    ]);
  });

  it("pauses administrative roles from rules while groups cannot be read and returns them later", async () => {
    const org = await organization();
    const administrator = await account(null);
    await test.services.roles.assign(SYSTEM, {
      scope: "instance",
      organizationId: null,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: administrator.id },
    });
    const group = `group-${randomUUID()}`;
    await test.services.mappingRules.create(accountPrincipal(org.owner), generic, {
      target: "organization",
      group: { id: group, name: "Org admins" },
      organizationId: org.id,
      role: { builtIn: "administrator" },
      synchronizedGroup: false,
      homeOrganization: false,
    });
    const subject = randomUUID();
    const claims = { sub: subject, email: `${subject.slice(0, 8)}@generic.example`, groups: [group] };
    const person = await signedInAccount(await signIn(claims));
    const allowed = async () =>
      (
        await test.services.authorization.explain(accountPrincipal(person), "organization.members.manage", {
          type: "organization",
          id: org.id,
        })
      ).allowed;
    expect(await allowed()).toBe(true);
    const identity = await test.pool.query<{ id: string }>("select id from identities where subject = $1", [
      subject,
    ]);
    const identityId = identity.rows[0]?.id ?? "";

    const failRead = () =>
      test.database.transaction((tx) => test.services.groupMapping.groupReadFailed(tx, identityId, person));
    await failRead();
    expect(await withheldRoles(test.database, person)).toEqual([]);
    expect(await allowed()).toBe(true);

    await test.pool.query("update identities set groups_read_at = now() - interval '3 hours' where id = $1", [
      identityId,
    ]);
    await failRead();
    await failRead();
    expect(await withheldRoles(test.database, person)).toMatchObject([
      {
        scope: "organization",
        organizationId: org.id,
        builtInRole: "administrator",
        providerName: "Keycloak",
      },
    ]);
    expect(await allowed()).toBe(false);
    expect(await membership(org.id, person)).toBe("member");
    const notified = await test.pool.query<{ recipient_id: string }>(
      "select recipient_id from notifications where type = 'account.rolesWithheld' and target_id = $1",
      [person],
    );
    expect(notified.rows.map((row) => row.recipient_id)).toContain(administrator.id);
    expect(notified.rows.filter((row) => row.recipient_id === administrator.id)).toHaveLength(1);

    await signedInAccount(await signIn(claims));
    expect(await withheldRoles(test.database, person)).toEqual([]);
    expect(await allowed()).toBe(true);
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

  it("never reactivates an account an administrator deactivated after a manual reactivation", async () => {
    const org = await organization();
    const subject = `${GRAPH_TENANT_ID}:${GRAPH_IDS.frank}`;
    await test.pool.query("delete from identities where provider_id = $1 and subject = $2", [entra, subject]);
    const person = await account(org.id);
    await link(entra, person.id, subject);
    graph.setAccountEnabled(GRAPH_IDS.frank, false);
    await test.services.providerSync.run(entra, "manual");
    expect((await test.services.accounts.get(person.id))?.state).toBe("deactivated");

    await test.services.administration.reactivate(SYSTEM, person.id);
    graph.setAccountEnabled(GRAPH_IDS.frank, true);
    await test.services.providerSync.run(entra, "manual");
    await test.services.memberships.deactivate(SYSTEM, person.id);
    await test.services.providerSync.run(entra, "manual");
    expect((await test.services.accounts.get(person.id))?.state).toBe("deactivated");
  });

  it("writes a provider deactivation and its record together or not at all", async () => {
    const org = await organization();
    const person = await account(org.id);
    await expect(
      test.services.memberships.deactivate(SYSTEM, person.id, {
        byProvider: { providerId: randomUUID(), state: "disabled" },
      }),
    ).rejects.toThrow();
    expect((await test.services.accounts.get(person.id))?.state).toBe("active");
    await test.services.memberships.deactivate(SYSTEM, person.id, {
      byProvider: { providerId: entra, state: "disabled" },
    });
    const record = await test.pool.query(
      "select provider_id from provider_deactivations where account_id = $1",
      [person.id],
    );
    expect(record.rows).toEqual([{ provider_id: entra }]);
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

  it("renames synchronized groups with the provider and adds the provider name on a conflict", async () => {
    const org = await organization();
    const before = `Design ${randomUUID().slice(0, 6)}`;
    graph.renameGroup(GRAPH_IDS.platform, before);
    await test.services.providerSync.run(entra, "manual");
    const rule = await test.services.mappingRules.create(accountPrincipal(org.owner), entra, {
      target: "organization",
      group: { id: GRAPH_IDS.platform, name: before },
      organizationId: org.id,
      role: null,
      synchronizedGroup: true,
      homeOrganization: false,
    });
    const groupId = rule.synchronizedGroup?.id ?? "";
    expect((await test.services.groups.get(groupId))?.name).toBe(before);

    const after = `Product ${randomUUID().slice(0, 6)}`;
    await test.services.groups.create(accountPrincipal(org.owner), org.id, { name: after });
    graph.renameGroup(GRAPH_IDS.platform, after);
    const run = await test.services.providerSync.run(entra, "manual");
    expect((await test.services.groups.get(groupId))?.name).toBe(`${after} (Entra ID)`);
    const details = await test.services.providerSync.runDetails(entra, run?.id ?? "");
    expect(details?.changes).toContainEqual(
      expect.objectContaining({
        kind: "groupRenamed",
        organizationId: org.id,
        detail: `${before} → ${after} (Entra ID)`,
      }),
    );

    const subject = randomUUID();
    const renamed = `Research ${randomUUID().slice(0, 6)}`;
    const generalRule = await test.services.mappingRules.create(accountPrincipal(org.owner), generic, {
      target: "organization",
      group: { id: `group-${subject}`, name: "Research" },
      organizationId: org.id,
      role: null,
      synchronizedGroup: true,
      homeOrganization: false,
    });
    await signedInAccount(
      await signIn({
        sub: subject,
        email: `${subject.slice(0, 8)}@generic.example`,
        groups: [`group-${subject}`],
        group_names: [renamed],
      }),
    );
    expect((await test.services.groups.get(generalRule.synchronizedGroup?.id ?? ""))?.name).toBe(renamed);
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
      if (loaded?.provider.type !== "oidc") throw new Error("Provider missing");
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

  it("lets a new run start once a running one sent no heartbeat for five minutes", async () => {
    const stuck = await test.pool.query<{ id: string }>(
      "insert into provider_sync_runs (id, provider_id, trigger, status, started_at, heartbeat_at) values (gen_random_uuid(), $1, 'manual', 'running', now() - interval '3 hours', now() - interval '1 minute') returning id",
      [entra],
    );
    const stuckId = stuck.rows[0]?.id ?? "";
    expect(await test.services.providerSync.run(entra, "manual")).toBeNull();
    await test.pool.query(
      "update provider_sync_runs set heartbeat_at = now() - interval '6 minutes' where id = $1",
      [stuckId],
    );
    expect(await test.services.providerSync.run(entra, "manual")).not.toBeNull();
    const after = await test.pool.query<{ status: string }>(
      "select status from provider_sync_runs where id = $1",
      [stuckId],
    );
    expect(after.rows[0]?.status).toBe("failed");
  });

  it("cancels a running synchronization before its next account", async () => {
    const org = await organization();
    const linked = await test.pool.query<{ count: number }>(
      "select count(*)::int as count from identities where provider_id = $1",
      [entra],
    );
    expect(linked.rows[0]?.count).toBeGreaterThan(1);
    const held = graph.hold();
    const running = test.services.providerSync.run(entra, "manual");
    await held.reached;
    const current = await test.pool.query<{ id: string }>(
      "select id from provider_sync_runs where provider_id = $1 and status = 'running'",
      [entra],
    );
    const runId = current.rows[0]?.id ?? "";
    expect(await test.services.providerSync.cancel(accountPrincipal(org.owner), entra, runId)).toBe(true);
    held.release();
    const run = await running;
    expect(run?.status).toBe("cancelled");
    expect(await test.services.providerSync.cancel(accountPrincipal(org.owner), entra, runId)).toBe(false);
    const audit = await test.pool.query(
      "select 1 from audit_events where name = 'identityProvider.syncCancelled' and target_id = $1",
      [entra],
    );
    expect(audit.rows).toHaveLength(1);
  });

  async function googleProvider(directory: Record<string, unknown>, domain = "example.org") {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const provider = await test.services.identityProviders.create(SYSTEM, {
      type: "oidc",
      name: `Google ${randomUUID().slice(0, 6)}`,
      config: {
        preset: "google",
        clientId: "google-client",
        domains: [domain],
        directory: { url: google.url, tokenUrl: `${google.url}/token`, ...directory },
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
    return provider;
  }

  it("reads Google groups through an administrator role without domain-wide delegation", async () => {
    const provider = await googleProvider({ method: "adminRole" }, "role.example.org");
    const org = await organization();
    await test.services.mappingRules.create(accountPrincipal(org.owner), provider.provider.id, {
      target: "organization",
      group: { id: GOOGLE_IDS.admins, name: "Administrators" },
      organizationId: org.id,
      role: null,
      synchronizedGroup: false,
      homeOrganization: false,
    });
    const alice = await account(null);
    const sam = await account(null);
    await link(provider.provider.id, alice.id, GOOGLE_IDS.alice);
    await link(provider.provider.id, sam.id, GOOGLE_IDS.sam);
    const before = google.requests.length;
    const run = await test.services.providerSync.run(provider.provider.id, "manual");
    expect(run?.error).toBeNull();
    expect(await membership(org.id, alice.id)).toBe("member");
    expect((await test.services.accounts.get(sam.id))?.state).toBe("active");
    expect(google.requests.slice(before).some((request) => request.includes("/users"))).toBe(false);
  });

  it("deactivates accounts suspended in the Google directory", async () => {
    const provider = await googleProvider({ method: "delegation", adminEmail: "admin@example.org" });
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
