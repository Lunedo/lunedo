import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ANONYMOUS, type Principal, SYSTEM } from "../accounts/principal.js";
import {
  type BuiltInRoleKey,
  type MembershipKind,
  type PrincipalKind,
  principalKinds,
  type RoleScope,
} from "../organizations/access-schema.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import {
  type AccessLevel,
  type Area,
  type Areas,
  builtInRoles,
  grantsLevel,
  instanceAreas,
  mergeAreas,
  organizationAreas,
} from "./areas.js";
import type { RegisteredAction, Resource } from "./registry.js";

const baseUrl = testDatabaseBaseUrl();

const subjects = ["member", "serviceAccount", "collaborator", "guest", "deactivated", "nonMember"] as const;
type Subject = (typeof subjects)[number];

interface RoleCase {
  scope: RoleScope;
  name: string;
  builtIn: BuiltInRoleKey | null;
  areas: Areas;
}

function roleCases(scope: RoleScope): RoleCase[] {
  const builtIns = Object.entries(builtInRoles[scope]) as [BuiltInRoleKey, Areas][];
  const areas: readonly Area[] = scope === "instance" ? instanceAreas : organizationAreas;
  return [
    ...builtIns.map(([key, roleAreas]) => ({ scope, name: key, builtIn: key, areas: roleAreas })),
    ...areas.map((area) => ({
      scope,
      name: `custom ${area}`,
      builtIn: null,
      areas: { [area]: "manage" as AccessLevel },
    })),
  ];
}

const ROLES = [...roleCases("instance"), ...roleCases("organization")];
const ASSIGNABLE: Record<RoleScope, readonly BuiltInRoleKey[]> = {
  instance: ["administrator", "securityAuditor"],
  organization: ["owner", "administrator"],
};

interface SubjectFacts {
  type: "standard" | "service" | "guest";
  membership: MembershipKind | null;
  active: boolean;
}

const SUBJECT_FACTS: Record<Subject, SubjectFacts> = {
  member: { type: "standard", membership: "member", active: true },
  serviceAccount: { type: "service", membership: "member", active: true },
  collaborator: { type: "standard", membership: "collaborator", active: true },
  guest: { type: "guest", membership: "guest", active: true },
  deactivated: { type: "standard", membership: "member", active: true },
  nonMember: { type: "standard", membership: null, active: true },
};

function assignmentValid(subject: Subject, via: PrincipalKind, role: RoleCase): boolean {
  const facts = SUBJECT_FACTS[subject];
  if (via === "organizationMembers" || via === "instanceUsers") return false;
  if (role.scope === "instance" && role.builtIn === "owner")
    return via === "account" && facts.type === "standard";
  if (role.builtIn && !ASSIGNABLE[role.scope].includes(role.builtIn)) return false;
  if (role.builtIn === "owner" && facts.type !== "standard") return false;
  if (role.builtIn === "owner" && via !== "account") return false;
  if (role.scope === "instance" && via === "group") return false;
  if (via !== "account") return true;
  if (role.scope === "instance") return facts.type === "standard";
  return facts.membership === "member";
}

interface Held {
  subject: Subject;
  via: PrincipalKind | null;
  role: RoleCase | null;
  breakGlass: boolean;
}

function roleApplies(held: Held, scope: RoleScope): boolean {
  if (!held.role || !held.via || held.role.scope !== scope) return false;
  if (!assignmentValid(held.subject, held.via, held.role)) return false;
  const facts = SUBJECT_FACTS[held.subject];
  if (held.via === "instanceUsers" && facts.type !== "standard") return false;
  if (scope === "organization") return facts.membership === "member";
  return true;
}

function instanceAreasOf(held: Held): Areas {
  return held.role && roleApplies(held, "instance") ? held.role.areas : {};
}

function breakGlassActive(held: Held): boolean {
  return held.breakGlass && grantsLevel(instanceAreasOf(held).organizations, "manage");
}

function organizationAreasOf(held: Held): Areas {
  const sets: Areas[] = [];
  if (SUBJECT_FACTS[held.subject].membership === "member") sets.push(builtInRoles.organization.member ?? {});
  if (held.role && roleApplies(held, "organization")) sets.push(held.role.areas);
  if (breakGlassActive(held)) sets.push(builtInRoles.organization.administrator ?? {});
  return mergeAreas(...sets);
}

type Rule =
  | "selfService"
  | "membersCreateGroups"
  | "membersCreateSpaces"
  | "personalSpace"
  | "activeAccount"
  | "homeOrganizationAdministrator"
  | "manager"
  | "memberOrManager"
  | "self";

interface Expectation {
  scope: RoleScope | "space";
  area?: Area;
  level?: AccessLevel;
  ownerOnly?: true;
  membership?: MembershipKind[];
  breakGlass?: true;
  rule?: Rule;
}

const ALL_MEMBERSHIPS: MembershipKind[] = ["member", "collaborator", "guest"];
const instance = (area: Area, level: AccessLevel, rule?: Rule): Expectation => ({
  scope: "instance",
  area,
  level,
  ...(rule ? { rule } : {}),
});
const organization = (area: Area, level: AccessLevel, rule?: Rule): Expectation => ({
  scope: "organization",
  area,
  level,
  ...(rule ? { rule } : {}),
});

const EXPECTED: Record<string, Expectation> = {
  "instance.organizations.view": instance("organizations", "view"),
  "instance.organizations.manage": instance("organizations", "manage"),
  "instance.organizations.create": instance("organizations", "manage", "selfService"),
  "instance.accounts.view": instance("accounts", "view"),
  "instance.accounts.manage": instance("accounts", "manage"),
  "instance.roles.view": instance("accounts", "view"),
  "instance.roles.manage": instance("accounts", "manage"),
  "instance.ownership.transfer": { scope: "instance", ownerOnly: true },
  "instance.emergencyRecipients.manage": { scope: "instance", ownerOnly: true },
  "instance.signIn.view": instance("signInAndSecurity", "view"),
  "instance.signIn.manage": instance("signInAndSecurity", "manage"),
  "instance.settings.view": instance("settings", "view"),
  "instance.settings.manage": instance("settings", "manage"),
  "instance.operations.view": instance("operations", "view"),
  "instance.operations.manage": instance("operations", "manage"),
  "instance.audit.view": instance("auditLog", "view"),
  "instance.audit.manage": instance("auditLog", "manage"),
  "instance.breakGlass.request": instance("organizations", "manage"),
  "instance.personalSpaces.view": instance("accounts", "view"),
  "instance.personalSpaces.manage": instance("accounts", "manage"),
  "instance.personalSpace.use": { scope: "instance", rule: "personalSpace" },
  "instance.templates.manage": instance("settings", "manage"),
  "instance.content.view": { scope: "instance", rule: "activeAccount" },
  "organization.view": { scope: "organization", membership: ALL_MEMBERSHIPS, breakGlass: true },
  "organization.leave": { scope: "organization", membership: ALL_MEMBERSHIPS },
  "organization.update": organization("settings", "manage"),
  "organization.settings.view": organization("settings", "view"),
  "organization.settings.manage": organization("settings", "manage"),
  "organization.members.view": organization("membersAndGroups", "view"),
  "organization.members.manage": organization("membersAndGroups", "manage"),
  "organization.roles.view": organization("membersAndGroups", "view"),
  "organization.roles.manage": organization("membersAndGroups", "manage"),
  "organization.groups.view": organization("membersAndGroups", "view"),
  "organization.groups.create": organization("membersAndGroups", "manage", "membersCreateGroups"),
  "organization.spaces.view": organization("spaces", "view"),
  "organization.spaces.manage": organization("spaces", "manage"),
  "organization.spaces.create": organization("spaces", "manage", "membersCreateSpaces"),
  "organization.trash.manage": organization("spaces", "manage"),
  "organization.templates.manage": organization("settings", "manage"),
  "organization.blog.pin": organization("spaces", "manage"),
  "organization.signIn.view": organization("signInAndSecurity", "view"),
  "organization.signIn.manage": organization("signInAndSecurity", "manage"),
  "organization.integrations.view": organization("integrationsAndApi", "view"),
  "organization.integrations.manage": organization("integrationsAndApi", "manage"),
  "organization.audit.view": organization("auditLog", "view"),
  "group.view": organization("membersAndGroups", "view", "memberOrManager"),
  "group.manage": organization("membersAndGroups", "manage", "manager"),
  "group.delete": organization("membersAndGroups", "manage", "manager"),
  "account.deactivate": instance("accounts", "manage", "homeOrganizationAdministrator"),
  "account.activity.view": { scope: "instance", rule: "self" },
  "account.reactivate": instance("accounts", "manage", "homeOrganizationAdministrator"),
  "account.sessions.end": instance("accounts", "manage", "homeOrganizationAdministrator"),
  "account.secondFactor.reset": instance("accounts", "manage", "homeOrganizationAdministrator"),
  "account.identities.view": instance("accounts", "view", "homeOrganizationAdministrator"),
  "account.identities.manage": instance("accounts", "manage", "homeOrganizationAdministrator"),
  "account.homeOrganization.change": instance("accounts", "manage", "homeOrganizationAdministrator"),
  "serviceAccount.view": organization("integrationsAndApi", "view"),
  "serviceAccount.manage": organization("integrationsAndApi", "manage"),
  "space.view": { scope: "space" },
  "space.edit": { scope: "space" },
  "space.manage": { scope: "space" },
  "space.trash": { scope: "space" },
  "space.delete": { scope: "space" },
  "item.view": { scope: "space" },
  "item.edit": { scope: "space" },
  "item.delete": { scope: "space" },
  "item.archive": { scope: "space" },
  "item.comment": { scope: "space" },
  "item.react": { scope: "space" },
  "item.pin": { scope: "space" },
  "comment.view": { scope: "space" },
  "comment.reply": { scope: "space" },
  "comment.resolve": { scope: "space" },
  "comment.react": { scope: "space" },
  "comment.update": { scope: "space" },
  "comment.delete": { scope: "space" },
  "comment.restore": { scope: "space" },
  "task.view": { scope: "space" },
  "task.update": { scope: "space" },
};

function expectedAllowed(held: Held, actionName: string): boolean {
  const expectation = EXPECTED[actionName];
  if (!expectation) throw new Error(`The matrix has no expectation for ${actionName}`);
  if (held.subject === "deactivated") return false;
  const facts = SUBJECT_FACTS[held.subject];
  const instanceOwner =
    held.role?.scope === "instance" && held.role.builtIn === "owner" && roleApplies(held, "instance");
  const organizationAreas = organizationAreasOf(held);
  const rules: Record<Rule, () => boolean> = {
    selfService: () => false,
    membersCreateGroups: () => false,
    membersCreateSpaces: () => facts.membership === "member",
    personalSpace: () => facts.type === "standard",
    activeAccount: () => true,
    homeOrganizationAdministrator: () => grantsLevel(organizationAreas.membersAndGroups, "manage"),
    self: () => false,
    manager: () => false,
    memberOrManager: () => facts.membership !== null && held.via === "group",
  };
  if (expectation.rule && rules[expectation.rule]()) return true;
  if (expectation.scope === "space") return false;
  if (expectation.ownerOnly) return expectation.scope === "instance" && instanceOwner;
  const areas = expectation.scope === "instance" ? instanceAreasOf(held) : organizationAreas;
  if (expectation.scope === "organization") {
    if (facts.membership && expectation.membership?.includes(facts.membership)) return true;
    if (expectation.breakGlass && breakGlassActive(held)) return true;
  }
  return (
    expectation.area !== undefined &&
    expectation.level !== undefined &&
    grantsLevel(areas[expectation.area], expectation.level)
  );
}

interface Fixture {
  organizationId: string;
  groupId: string;
  targetId: string;
  spaceId: string;
  itemId: string;
  commentId: string;
  taskId: string;
}

describe.skipIf(!baseUrl)("permission matrix", () => {
  let test: TestServices;
  let actions: RegisteredAction[];
  let evaluated = 0;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id) values (1)");
    actions = test.services.authorization.registry.actions();
  });

  afterAll(async () => {
    await test?.close();
  });

  async function account(type: "standard" | "guest", home: string | null): Promise<string> {
    const result = await test.pool.query<{ id: string }>(
      "insert into accounts (id, type, state, email, name, home_organization_id) values ($1, $2, 'active', $3, 'Test', $4) returning id",
      [randomUUID(), type, `${randomUUID()}@example.org`, home],
    );
    return result.rows[0]?.id ?? "";
  }

  async function membership(organizationId: string, accountId: string, kind: MembershipKind) {
    await test.pool.query(
      "insert into memberships (id, organization_id, account_id, kind) values ($1, $2, $3, $4)",
      [randomUUID(), organizationId, accountId, kind],
    );
  }

  async function fixture(): Promise<Fixture> {
    const owner = await account("standard", null);
    const created = await test.services.organizations.createAsActor(SYSTEM, {
      name: `Organization ${randomUUID().slice(0, 8)}`,
      ownerAccountId: owner,
    });
    const group = await test.pool.query<{ id: string }>(
      "insert into groups (id, organization_id, name) values ($1, $2, 'Group') returning id",
      [randomUUID(), created.id],
    );
    const targetId = await account("standard", created.id);
    await membership(created.id, targetId, "member");
    const space = await test.services.spaces.create(
      { type: "account", id: owner },
      created.id,
      {
        name: "Matrix space",
        key: `M${randomUUID().slice(0, 8).replace(/-/g, "").toUpperCase()}`,
        visibility: "private",
        grants: [],
      },
      test.services.spacePermissions.holders,
    );
    const itemId = space.overviewItemId ?? "";
    const comment = await test.pool.query<{ id: string }>(
      "insert into comments (id, item_id, author_id, body) values ($1, $2, $3, $4) returning id",
      [randomUUID(), itemId, owner, { type: "doc", content: [{ type: "paragraph" }] }],
    );
    const task = await test.pool.query<{ id: string }>(
      "insert into tasks (id, item_id, published, assignee_id) values ($1, $2, true, $3) returning id",
      [randomUUID(), itemId, owner],
    );
    return {
      organizationId: created.id,
      groupId: group.rows[0]?.id ?? "",
      targetId,
      spaceId: space.id,
      itemId,
      commentId: comment.rows[0]?.id ?? "",
      taskId: task.rows[0]?.id ?? "",
    };
  }

  async function subjectAccount(subject: Subject, target: Fixture): Promise<string> {
    switch (subject) {
      case "member":
      case "deactivated": {
        const id = await account("standard", target.organizationId);
        await membership(target.organizationId, id, "member");
        return id;
      }
      case "serviceAccount":
        return (await test.services.serviceAccounts.create(SYSTEM, target.organizationId, { name: "Bot" }))
          .id;
      case "collaborator": {
        const id = await account("standard", null);
        await membership(target.organizationId, id, "collaborator");
        return id;
      }
      case "guest": {
        const id = await account("guest", null);
        await membership(target.organizationId, id, "guest");
        return id;
      }
      case "nonMember":
        return account("standard", null);
    }
  }

  function resourceFor(action: RegisteredAction, target: Fixture & { serviceAccountId: string }): Resource {
    switch (action.resourceType.type) {
      case "instance":
        return { type: "instance" };
      case "organization":
        return { type: "organization", id: target.organizationId };
      case "group":
        return { type: "group", id: target.groupId };
      case "account":
        return { type: "account", id: target.targetId };
      case "serviceAccount":
        return { type: "serviceAccount", id: target.serviceAccountId };
      case "space":
        return { type: "space", id: target.spaceId };
      case "item":
        return { type: "item", id: target.itemId };
      case "comment":
        return { type: "comment", id: target.commentId };
      case "task":
        return { type: "task", id: target.taskId };
      default:
        throw new Error(`The matrix has no resource for ${action.resourceType.type}`);
    }
  }

  async function check(
    principal: Principal,
    target: Fixture & { serviceAccountId: string },
    held: Held | "system" | "anonymous",
  ) {
    const mismatches: string[] = [];
    for (const action of actions) {
      const decision = await test.services.authorization.explain(
        principal,
        action.name,
        resourceFor(action, target),
      );
      const expected =
        held === "system" ? true : held === "anonymous" ? false : expectedAllowed(held, action.name);
      evaluated += 1;
      if (decision.allowed !== expected) mismatches.push(`${action.name}: expected ${expected}`);
    }
    expect(mismatches).toEqual([]);
  }

  async function withServiceAccount(target: Fixture) {
    const service = await test.services.serviceAccounts.create(SYSTEM, target.organizationId, {
      name: "Target",
    });
    return { ...target, serviceAccountId: service.id };
  }

  async function assign(
    held: Held & { role: RoleCase; via: PrincipalKind },
    target: Fixture,
    accountId: string,
  ) {
    const { role, via } = held;
    if (via === "group") {
      await test.pool.query("insert into group_members (group_id, account_id) values ($1, $2)", [
        target.groupId,
        accountId,
      ]);
    }
    if (role.scope === "instance" && role.builtIn === "owner") {
      if (assignmentValid(held.subject, via, role)) {
        await test.pool.query("update instance set owner_account_id = $1", [accountId]);
        return;
      }
      await expect(
        test.services.roles.assign(SYSTEM, {
          scope: "instance",
          organizationId: null,
          role: { builtIn: "owner" },
          principal: { kind: via, id: via === "account" ? accountId : null },
        }),
      ).rejects.toThrow();
      return;
    }
    const organizationId = role.scope === "organization" ? target.organizationId : null;
    const reference = role.builtIn
      ? { builtIn: role.builtIn }
      : {
          customRoleId: (
            await test.services.roles.createCustom(SYSTEM, role.scope, organizationId, {
              name: `${role.name} ${randomUUID().slice(0, 6)}`,
              areas: role.areas,
            })
          ).id,
        };
    const principalId = via === "account" ? accountId : via === "group" ? target.groupId : null;
    const assignment = test.services.roles.assign(SYSTEM, {
      scope: role.scope,
      organizationId,
      role: reference,
      principal: { kind: via, id: principalId },
    });
    if (assignmentValid(held.subject, via, role)) await expect(assignment).resolves.toBeTruthy();
    else await expect(assignment).rejects.toMatchObject({ name: "OrganizationError" });
  }

  for (const subject of subjects) {
    for (const via of principalKinds) {
      for (const role of ROLES) {
        it(`${subject} holding ${role.scope} ${role.name} through ${via}`, async () => {
          const target = await withServiceAccount(await fixture());
          const accountId = await subjectAccount(subject, target);
          const held = { subject, via, role, breakGlass: false };
          try {
            await assign(held, target, accountId);
            if (subject === "deactivated") {
              await test.pool.query("update accounts set state = 'deactivated' where id = $1", [accountId]);
            }
            await check({ type: "account", id: accountId }, target, held);
          } finally {
            await test.pool.query("delete from role_assignments where scope = 'instance'");
            await test.pool.query("update instance set owner_account_id = null");
          }
        });
      }
    }
  }

  for (const keepsInstanceRole of [true, false]) {
    it(`break-glass access ${keepsInstanceRole ? "while" : "after"} the requester holds the instance role`, async () => {
      const target = await withServiceAccount(await fixture());
      const accountId = await account("standard", null);
      const role = ROLES.find(
        (candidate) => candidate.scope === "instance" && candidate.name === "custom organizations",
      );
      if (!role) throw new Error("The matrix has no instance role for organizations");
      const held: Held = { subject: "nonMember", via: "account", role, breakGlass: true };
      await assign({ ...held, role, via: "account" }, target, accountId);
      await test.pool.query(
        "insert into break_glass_accesses (id, organization_id, account_id, reason, expires_at) values ($1, $2, $3, 'Matrix test reason', now() + interval '1 hour')",
        [randomUUID(), target.organizationId, accountId],
      );
      try {
        if (keepsInstanceRole) {
          await check({ type: "account", id: accountId }, target, held);
        } else {
          await test.pool.query("delete from role_assignments where scope = 'instance'");
          await check({ type: "account", id: accountId }, target, { ...held, via: null, role: null });
        }
      } finally {
        await test.pool.query("delete from role_assignments where scope = 'instance'");
      }
    });
  }

  it("has an expectation for every registered action and none for unknown actions", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(actions.map((action) => action.name).sort());
  });

  it("anonymous", async () => {
    await check(ANONYMOUS, await withServiceAccount(await fixture()), "anonymous");
  });

  it("system", async () => {
    await check(SYSTEM, await withServiceAccount(await fixture()), "system");
  });

  it("evaluates the full cross product", () => {
    const cases = subjects.length * principalKinds.length * ROLES.length + 4;
    expect(evaluated).toBe(cases * actions.length);
  });
});
