import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import { runWithRequestContext } from "../observability/request-context.js";
import { LastOwnerError } from "../organizations/memberships.js";
import { OrganizationError } from "../organizations/organizations.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { ForbiddenError } from "./service.js";

const baseUrl = testDatabaseBaseUrl();

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe.skipIf(!baseUrl)("authorization rules", () => {
  let test: TestServices;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id) values (1)");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function standard(home: string | null): Promise<string> {
    const account = await test.database.transaction((tx) =>
      test.services.accounts.createStandard(tx, {
        email: `${randomUUID()}@example.org`,
        name: "Person",
        password: "a long test passphrase",
        homeOrganizationId: home,
      }),
    );
    return account.id;
  }

  async function organization(): Promise<{ id: string; owner: string }> {
    const owner = await standard(null);
    const created = await test.services.organizations.createAsActor(SYSTEM, {
      name: `Organization ${randomUUID().slice(0, 8)}`,
      ownerAccountId: owner,
    });
    return { id: created.id, owner };
  }

  async function member(organizationId: string): Promise<string> {
    return standard(organizationId);
  }

  async function denial(promise: Promise<unknown>): Promise<string | undefined> {
    try {
      await promise;
    } catch (error) {
      if (error instanceof ForbiddenError) return error.decision.denials[0];
      throw error;
    }
    return undefined;
  }

  const allowed = (accountId: string, action: string, id: string) =>
    test.services.authorization.authorize(accountPrincipal(accountId), action, { type: "organization", id });

  describe("nobody can extend their own permissions", () => {
    it("lets only owners appoint owners", async () => {
      const org = await organization();
      const admin = await member(org.id);
      const other = await member(org.id);
      await test.services.roles.assign(SYSTEM, {
        scope: "organization",
        organizationId: org.id,
        role: { builtIn: "administrator" },
        principal: { kind: "account", id: admin },
      });
      const appoint = (actor: string, target: string) =>
        test.services.roles.assign(accountPrincipal(actor), {
          scope: "organization",
          organizationId: org.id,
          role: { builtIn: "owner" },
          principal: { kind: "account", id: target },
        });
      expect(await denial(appoint(admin, other))).toBe("ownerOnly");
      expect(await denial(appoint(admin, admin))).toBe("ownerOnly");
      expect(await denial(appoint(org.owner, other))).toBeUndefined();
    });

    it("limits administrators and custom roles to roles up to their own level", async () => {
      const org = await organization();
      const manager = await member(org.id);
      const other = await member(org.id);
      const role = await test.services.roles.createCustom(SYSTEM, "organization", org.id, {
        name: "Member management",
        areas: { membersAndGroups: "manage" },
      });
      await test.services.roles.assign(SYSTEM, {
        scope: "organization",
        organizationId: org.id,
        role: { customRoleId: role.id },
        principal: { kind: "account", id: manager },
      });
      const assign = (target: string, builtIn: "administrator") =>
        test.services.roles.assign(accountPrincipal(manager), {
          scope: "organization",
          organizationId: org.id,
          role: { builtIn },
          principal: { kind: "account", id: target },
        });
      expect(await denial(assign(other, "administrator"))).toBe("roleExceedsOwnPermissions");
      expect(
        await denial(
          test.services.roles.createCustom(accountPrincipal(manager), "organization", org.id, {
            name: "Stronger",
            areas: { membersAndGroups: "manage", settings: "manage" },
          }),
        ),
      ).toBe("roleExceedsOwnPermissions");
      expect(
        await denial(
          test.services.roles.updateCustom(accountPrincipal(manager), "organization", org.id, role.id, {
            areas: { membersAndGroups: "manage", auditLog: "view" },
          }),
        ),
      ).toBe("roleExceedsOwnPermissions");
    });

    it("blocks adding oneself or others to a group with a stronger role", async () => {
      const org = await organization();
      const manager = await member(org.id);
      const friend = await member(org.id);
      const group = await test.services.groups.create(accountPrincipal(manager), org.id, { name: "Admins" });
      await test.services.roles.assign(SYSTEM, {
        scope: "organization",
        organizationId: org.id,
        role: { builtIn: "administrator" },
        principal: { kind: "group", id: group.id },
      });
      expect(await denial(test.services.groups.addMember(accountPrincipal(manager), group.id, manager))).toBe(
        "roleExceedsOwnPermissions",
      );
      expect(await denial(test.services.groups.addMember(accountPrincipal(manager), group.id, friend))).toBe(
        "roleExceedsOwnPermissions",
      );
      expect(await allowed(manager, "organization.members.manage", org.id)).toBe(false);
      await test.services.groups.addMember(accountPrincipal(org.owner), group.id, friend);
      expect(await allowed(friend, "organization.members.manage", org.id)).toBe(true);
    });

    it("does not let temporary or break-glass rights become permanent", async () => {
      const org = await organization();
      const temporary = await member(org.id);
      await test.services.roles.assign(SYSTEM, {
        scope: "organization",
        organizationId: org.id,
        role: { builtIn: "administrator" },
        principal: { kind: "account", id: temporary },
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
      const selfAssign = (accountId: string) =>
        test.services.roles.assign(accountPrincipal(accountId), {
          scope: "organization",
          organizationId: org.id,
          role: { builtIn: "administrator" },
          principal: { kind: "organizationMembers", id: null },
        });
      expect(await denial(selfAssign(temporary))).toBe("selfExtension");

      const instanceAdministrator = await standard(null);
      await test.services.roles.assign(SYSTEM, {
        scope: "instance",
        organizationId: null,
        role: { builtIn: "administrator" },
        principal: { kind: "account", id: instanceAdministrator },
      });
      await test.services.breakGlass.request(
        accountPrincipal(instanceAdministrator),
        org.id,
        "Owners are unreachable during an outage",
      );
      expect(await allowed(instanceAdministrator, "organization.members.manage", org.id)).toBe(true);
      await expect(
        test.services.roles.assign(accountPrincipal(instanceAdministrator), {
          scope: "organization",
          organizationId: org.id,
          role: { builtIn: "administrator" },
          principal: { kind: "account", id: instanceAdministrator },
        }),
      ).rejects.toMatchObject({ code: "invalidPrincipal" });
      expect(
        await denial(
          test.services.roles.assign(accountPrincipal(instanceAdministrator), {
            scope: "organization",
            organizationId: org.id,
            role: { builtIn: "owner" },
            principal: { kind: "account", id: org.owner },
          }),
        ),
      ).toBe("ownerOnly");
    });
  });

  describe("the last owner", () => {
    it("cannot be removed, leave or lose the owner role", async () => {
      const org = await organization();
      const assignments = await test.services.roles.listAssignments("organization", org.id);
      const ownerAssignment = assignments.find((assignment) => assignment.role === "owner");
      await expect(
        test.services.roles.unassign(SYSTEM, "organization", org.id, ownerAssignment?.id ?? ""),
      ).rejects.toMatchObject({ code: "lastOwner" });

      const second = await organization();
      const visitor = await standard(second.id);
      await test.database.transaction((tx) =>
        test.services.memberships.add(tx, SYSTEM, {
          organizationId: org.id,
          accountId: visitor,
          kind: "member",
        }),
      );
      await test.services.roles.assign(SYSTEM, {
        scope: "organization",
        organizationId: org.id,
        role: { builtIn: "owner" },
        principal: { kind: "account", id: visitor },
      });
      await test.services.roles.unassign(SYSTEM, "organization", org.id, ownerAssignment?.id ?? "");
      await expect(
        test.services.memberships.remove(accountPrincipal(visitor), org.id, visitor, "left"),
      ).rejects.toThrow(LastOwnerError);
    });

    it("stays when two owners remove each other at the same moment", async () => {
      const org = await organization();
      const second = await member(org.id);
      await test.services.roles.assign(SYSTEM, {
        scope: "organization",
        organizationId: org.id,
        role: { builtIn: "owner" },
        principal: { kind: "account", id: second },
      });
      const assignments = await test.services.roles.listAssignments("organization", org.id);
      const ofAccount = (id: string) =>
        assignments.find((assignment) => assignment.principalId === id)?.id ?? "";
      const results = await Promise.allSettled([
        test.services.roles.unassign(accountPrincipal(org.owner), "organization", org.id, ofAccount(second)),
        test.services.roles.unassign(accountPrincipal(second), "organization", org.id, ofAccount(org.owner)),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((result) => result.status === "rejected");
      const reason = rejected?.status === "rejected" ? rejected.reason : null;
      expect(reason instanceof OrganizationError || reason instanceof ForbiddenError).toBe(true);
      const owners = await test.pool.query(
        "select count(*)::int as count from role_assignments where organization_id = $1 and built_in_role = 'owner'",
        [org.id],
      );
      expect(owners.rows[0]?.count).toBe(1);
    });

    it("stays when two owners are deactivated at the same moment", async () => {
      const org = await organization();
      const second = await member(org.id);
      await test.services.roles.assign(SYSTEM, {
        scope: "organization",
        organizationId: org.id,
        role: { builtIn: "owner" },
        principal: { kind: "account", id: second },
      });
      const results = await Promise.allSettled([
        test.services.memberships.deactivate(SYSTEM, org.owner),
        test.services.memberships.deactivate(SYSTEM, second),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      const active = await test.pool.query(
        "select count(*)::int as count from accounts where id = any($1) and state = 'active'",
        [[org.owner, second]],
      );
      expect(active.rows[0]?.count).toBe(1);
    });
  });

  it("keeps organizations invisible to each other", async () => {
    const first = await organization();
    const second = await organization();
    expect(await allowed(first.owner, "organization.view", first.id)).toBe(true);
    expect(await allowed(first.owner, "organization.view", second.id)).toBe(false);
    expect(await allowed(first.owner, "organization.members.view", second.id)).toBe(false);
    const visible = await test.services.organizations.listForAccount(first.owner);
    expect(visible.map((entry) => entry.id)).toEqual([first.id]);
  });

  it("does not let instance roles access organization content", async () => {
    const org = await organization();
    const administrator = await standard(null);
    await test.services.roles.assign(SYSTEM, {
      scope: "instance",
      organizationId: null,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: administrator },
    });
    const decision = await test.services.authorization.explain(
      accountPrincipal(administrator),
      "organization.members.view",
      { type: "organization", id: org.id },
    );
    expect(decision.allowed).toBe(false);
    expect(decision.denials).toEqual(["notMember", "instanceRolesDoNotGrantOrganizationAccess"]);
    expect(
      await test.services.authorization.authorize(
        accountPrincipal(administrator),
        "instance.organizations.manage",
        {
          type: "instance",
        },
      ),
    ).toBe(true);
  });

  it("stops expired assignments, memberships and group memberships at the moment of expiry", async () => {
    const org = await organization();
    const viaRole = await member(org.id);
    await test.services.roles.assign(SYSTEM, {
      scope: "organization",
      organizationId: org.id,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: viaRole },
    });
    const viaGroup = await member(org.id);
    const group = await test.services.groups.create(SYSTEM, org.id, { name: "Settings" });
    const role = await test.services.roles.createCustom(SYSTEM, "organization", org.id, {
      name: "Settings",
      areas: { settings: "manage" },
    });
    await test.services.roles.assign(SYSTEM, {
      scope: "organization",
      organizationId: org.id,
      role: { customRoleId: role.id },
      principal: { kind: "group", id: group.id },
    });
    await test.services.groups.addMember(SYSTEM, group.id, viaGroup);
    const visitor = await standard((await organization()).id);
    await test.database.transaction((tx) =>
      test.services.memberships.add(tx, SYSTEM, {
        organizationId: org.id,
        accountId: visitor,
        kind: "collaborator",
      }),
    );

    await test.pool.query(
      "update role_assignments set expires_at = now() + interval '1 second' where principal_id = $1",
      [viaRole],
    );
    await test.pool.query(
      "update group_members set expires_at = now() + interval '1 second' where account_id = $1",
      [viaGroup],
    );
    await test.pool.query(
      "update memberships set expires_at = now() + interval '1 second' where account_id = $1",
      [visitor],
    );
    expect(await allowed(viaRole, "organization.members.manage", org.id)).toBe(true);
    expect(await allowed(viaGroup, "organization.settings.manage", org.id)).toBe(true);
    expect(await allowed(visitor, "organization.view", org.id)).toBe(true);
    await sleep(1200);
    expect(await allowed(viaRole, "organization.members.manage", org.id)).toBe(false);
    expect(await allowed(viaGroup, "organization.settings.manage", org.id)).toBe(false);
    expect(await allowed(visitor, "organization.view", org.id)).toBe(false);

    await test.services.lifecycle.processExpiry();
    const events = await test.pool.query<{ name: string; fields: { reason?: string } }>(
      "select name, fields from audit_events where scope_id = $1 and actor_type = 'system' and name in ('role.unassigned', 'group.memberRemoved', 'membership.removed') order by sequence",
      [org.id],
    );
    expect(events.rows.map((row) => [row.name, row.fields.reason])).toEqual(
      expect.arrayContaining([
        ["role.unassigned", "expired"],
        ["group.memberRemoved", "expired"],
        ["membership.removed", "expired"],
      ]),
    );
  });

  it("ends break-glass access on time and records its use and end", async () => {
    const org = await organization();
    const administrator = await standard(null);
    await test.services.roles.assign(SYSTEM, {
      scope: "instance",
      organizationId: null,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: administrator },
    });
    const access = await test.services.breakGlass.request(
      accountPrincipal(administrator),
      org.id,
      "Owners left the company yesterday",
    );
    const ownerMail = await test.pool.query(
      "select template from mail_outbox where template = 'breakGlassStarted'",
    );
    expect(ownerMail.rows.length).toBeGreaterThan(0);

    expect(await allowed(administrator, "organization.members.view", org.id)).toBe(true);
    await test.pool.query(
      "update break_glass_accesses set expires_at = now() + interval '1 second' where id = $1",
      [access.id],
    );
    await sleep(1200);
    expect(await allowed(administrator, "organization.members.view", org.id)).toBe(false);
    expect(await test.services.breakGlass.recordExpired()).toBe(1);
    expect(await test.services.breakGlass.recordExpired()).toBe(0);
    const events = await test.pool.query<{ name: string; fields: Record<string, unknown> }>(
      "select name, fields from audit_events where scope_id = $1 and name like 'breakGlass.%' order by sequence",
      [org.id],
    );
    expect(events.rows.map((row) => row.name)).toEqual([
      "breakGlass.started",
      "breakGlass.actionAuthorized",
      "breakGlass.ended",
    ]);
    expect(events.rows[1]?.fields).toEqual({
      action: "organization.members.view",
      resourceType: "organization",
      resourceId: org.id,
    });
    expect(events.rows[2]?.fields).toEqual({ reason: "expired" });
  });

  it("applies changes on the next request, not within a cached request", async () => {
    const org = await organization();
    const person = await member(org.id);
    const cache = new Map<string, unknown>();
    await runWithRequestContext({ requestId: "first", cache }, async () => {
      expect(await allowed(person, "organization.settings.manage", org.id)).toBe(false);
      await test.services.roles.assign(SYSTEM, {
        scope: "organization",
        organizationId: org.id,
        role: { builtIn: "administrator" },
        principal: { kind: "account", id: person },
      });
      expect(await allowed(person, "organization.settings.manage", org.id)).toBe(false);
    });
    await runWithRequestContext({ requestId: "second", cache: new Map() }, async () => {
      expect(await allowed(person, "organization.settings.manage", org.id)).toBe(true);
    });
  });

  it("explains which role and assignment grant a permission", async () => {
    const org = await organization();
    const person = await member(org.id);
    const group = await test.services.groups.create(SYSTEM, org.id, { name: "Auditors" });
    const role = await test.services.roles.createCustom(SYSTEM, "organization", org.id, {
      name: "Audit readers",
      areas: { auditLog: "view" },
    });
    await test.services.roles.assign(SYSTEM, {
      scope: "organization",
      organizationId: org.id,
      role: { customRoleId: role.id },
      principal: { kind: "group", id: group.id },
    });
    await test.services.groups.addMember(SYSTEM, group.id, person);
    const decision = await test.services.authorization.explain(
      accountPrincipal(person),
      "organization.audit.view",
      {
        type: "organization",
        id: org.id,
      },
    );
    expect(decision).toMatchObject({
      allowed: true,
      grants: [
        {
          kind: "role",
          role: { customRoleId: role.id, name: "Audit readers" },
          via: { type: "group", groupId: group.id, name: "Auditors" },
        },
      ],
    });
    const denied = await test.services.authorization.explain(
      accountPrincipal(person),
      "organization.update",
      {
        type: "organization",
        id: org.id,
      },
    );
    expect(denied).toMatchObject({ allowed: false, denials: ["noRoleGrantsArea"] });
  });
});
