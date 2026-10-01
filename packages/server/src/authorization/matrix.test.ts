import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ANONYMOUS, type Principal, SYSTEM } from "../accounts/principal.js";
import type { RoleScope } from "../organizations/access-schema.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { type Area, instanceAreas, organizationAreas } from "./areas.js";
import type { Resource } from "./registry.js";

const baseUrl = testDatabaseBaseUrl();

const INSTANCE_ACTIONS = [
  "instance.organizations.view",
  "instance.organizations.manage",
  "instance.organizations.create",
  "instance.accounts.view",
  "instance.accounts.manage",
  "instance.roles.view",
  "instance.roles.manage",
  "instance.ownership.transfer",
  "instance.signIn.view",
  "instance.signIn.manage",
  "instance.settings.view",
  "instance.settings.manage",
  "instance.operations.view",
  "instance.operations.manage",
  "instance.audit.view",
  "instance.audit.manage",
  "instance.breakGlass.request",
];
const ORGANIZATION_ACTIONS = [
  "organization.view",
  "organization.leave",
  "organization.update",
  "organization.settings.view",
  "organization.settings.manage",
  "organization.members.view",
  "organization.members.manage",
  "organization.roles.view",
  "organization.roles.manage",
  "organization.groups.view",
  "organization.groups.create",
  "organization.spaces.view",
  "organization.spaces.manage",
  "organization.signIn.view",
  "organization.signIn.manage",
  "organization.integrations.view",
  "organization.integrations.manage",
  "organization.audit.view",
];
const GROUP_ACTIONS = ["group.view", "group.manage", "group.delete"];
const ACCOUNT_ACTIONS = ["account.deactivate"];
const ALL_ACTIONS = [...INSTANCE_ACTIONS, ...ORGANIZATION_ACTIONS, ...GROUP_ACTIONS, ...ACCOUNT_ACTIONS];

const MEMBER = [
  "organization.view",
  "organization.leave",
  "organization.members.view",
  "organization.roles.view",
  "organization.groups.view",
  "group.view",
];
const ORGANIZATION_ADMINISTRATOR = [...ORGANIZATION_ACTIONS, ...GROUP_ACTIONS, "account.deactivate"];

const EXPECTED: Record<string, string[]> = {
  "instance.owner": [...INSTANCE_ACTIONS, "account.deactivate"],
  "instance.administrator": [
    ...INSTANCE_ACTIONS.filter((action) => action !== "instance.ownership.transfer"),
    "account.deactivate",
  ],
  "instance.securityAuditor": [
    "instance.organizations.view",
    "instance.accounts.view",
    "instance.roles.view",
    "instance.signIn.view",
    "instance.settings.view",
    "instance.operations.view",
    "instance.audit.view",
  ],
  "instance.custom.organizations": [
    "instance.organizations.view",
    "instance.organizations.manage",
    "instance.organizations.create",
    "instance.breakGlass.request",
  ],
  "instance.custom.accounts": [
    "instance.accounts.view",
    "instance.accounts.manage",
    "instance.roles.view",
    "instance.roles.manage",
    "account.deactivate",
  ],
  "instance.custom.signInAndSecurity": ["instance.signIn.view", "instance.signIn.manage"],
  "instance.custom.settings": ["instance.settings.view", "instance.settings.manage"],
  "instance.custom.operations": ["instance.operations.view", "instance.operations.manage"],
  "instance.custom.auditLog": ["instance.audit.view", "instance.audit.manage"],
  "organization.owner": ORGANIZATION_ADMINISTRATOR,
  "organization.administrator": ORGANIZATION_ADMINISTRATOR,
  "organization.member": MEMBER,
  "organization.custom.membersAndGroups": [
    ...MEMBER,
    "organization.members.manage",
    "organization.roles.manage",
    "organization.groups.create",
    "group.manage",
    "group.delete",
    "account.deactivate",
  ],
  "organization.custom.spaces": [...MEMBER, "organization.spaces.view", "organization.spaces.manage"],
  "organization.custom.settings": [
    ...MEMBER,
    "organization.update",
    "organization.settings.view",
    "organization.settings.manage",
  ],
  "organization.custom.signInAndSecurity": [
    ...MEMBER,
    "organization.signIn.view",
    "organization.signIn.manage",
  ],
  "organization.custom.integrationsAndApi": [
    ...MEMBER,
    "organization.integrations.view",
    "organization.integrations.manage",
  ],
  "organization.custom.auditLog": [...MEMBER, "organization.audit.view"],
  collaborator: ["organization.view", "organization.leave"],
  guest: ["organization.view", "organization.leave"],
  breakGlass: [...ORGANIZATION_ADMINISTRATOR.filter((action) => action !== "organization.leave")],
  nonMember: [],
  deactivated: [],
  anonymous: [],
  system: ALL_ACTIONS,
};

interface Fixture {
  organizationId: string;
  groupId: string;
  targetId: string;
}

describe.skipIf(!baseUrl)("permission matrix", () => {
  let test: TestServices;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id) values (1)");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function account(
    options: { type?: "standard" | "guest"; home?: string | null } = {},
  ): Promise<string> {
    const result = await test.pool.query<{ id: string }>(
      "insert into accounts (id, type, state, email, name, home_organization_id) values ($1, $2, 'active', $3, 'Test', $4) returning id",
      [randomUUID(), options.type ?? "standard", `${randomUUID()}@example.org`, options.home ?? null],
    );
    return result.rows[0]?.id ?? "";
  }

  async function membership(organizationId: string, accountId: string, kind: string) {
    await test.pool.query(
      "insert into memberships (id, organization_id, account_id, kind) values ($1, $2, $3, $4)",
      [randomUUID(), organizationId, accountId, kind],
    );
  }

  async function fixture(): Promise<Fixture> {
    const owner = await account();
    const created = await test.services.organizations.createAsActor(SYSTEM, {
      name: `Organization ${randomUUID().slice(0, 8)}`,
      ownerAccountId: owner,
    });
    const group = await test.pool.query<{ id: string }>(
      "insert into groups (id, organization_id, name) values ($1, $2, 'Group') returning id",
      [randomUUID(), created.id],
    );
    const targetId = await account({ home: created.id });
    await membership(created.id, targetId, "member");
    return { organizationId: created.id, groupId: group.rows[0]?.id ?? "", targetId };
  }

  async function customRole(scope: RoleScope, organizationId: string | null, area: Area): Promise<string> {
    const result = await test.pool.query<{ id: string }>(
      "insert into custom_roles (id, scope, organization_id, name, areas) values ($1, $2, $3, $4, $5) returning id",
      [
        randomUUID(),
        scope,
        organizationId,
        `${area} ${randomUUID().slice(0, 6)}`,
        JSON.stringify({ [area]: "manage" }),
      ],
    );
    return result.rows[0]?.id ?? "";
  }

  async function assign(
    scope: RoleScope,
    organizationId: string | null,
    principal: { kind: string; id: string | null },
    role: { builtIn: string } | { customRoleId: string },
  ): Promise<string> {
    const result = await test.pool.query<{ id: string }>(
      `insert into role_assignments (id, scope, organization_id, principal_kind, principal_id, built_in_role, custom_role_id)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [
        randomUUID(),
        scope,
        organizationId,
        principal.kind,
        principal.id,
        "builtIn" in role ? role.builtIn : null,
        "customRoleId" in role ? role.customRoleId : null,
      ],
    );
    return result.rows[0]?.id ?? "";
  }

  async function allowedActions(principal: Principal, target: Fixture): Promise<string[]> {
    const allowed: string[] = [];
    for (const action of test.services.authorization.registry.actions()) {
      const resource: Resource =
        action.resourceType.type === "instance"
          ? { type: "instance" }
          : action.resourceType.type === "organization"
            ? { type: "organization", id: target.organizationId }
            : action.resourceType.type === "group"
              ? { type: "group", id: target.groupId }
              : { type: "account", id: target.targetId };
      const decision = await test.services.authorization.explain(principal, action.name, resource);
      if (decision.allowed) allowed.push(action.name);
    }
    return allowed.sort();
  }

  it("covers every registered action in the expected table", () => {
    const registered = test.services.authorization.registry.actions().map((action) => action.name);
    expect([...registered].sort()).toEqual([...ALL_ACTIONS].sort());
    for (const [role, actions] of Object.entries(EXPECTED)) {
      for (const action of actions) expect(ALL_ACTIONS, role).toContain(action);
    }
  });

  const instanceRoles: {
    key: string;
    role: (fixture: Fixture) => Promise<{ builtIn: string } | { customRoleId: string }>;
  }[] = [
    { key: "instance.administrator", role: async () => ({ builtIn: "administrator" }) },
    { key: "instance.securityAuditor", role: async () => ({ builtIn: "securityAuditor" }) },
    ...instanceAreas.map((area) => ({
      key: `instance.custom.${area}`,
      role: async () => ({ customRoleId: await customRole("instance", null, area) }),
    })),
  ];

  for (const { key, role } of instanceRoles) {
    for (const variant of ["account", "instanceUsers"] as const) {
      it(`${key} through ${variant}`, async () => {
        const target = await fixture();
        const accountId = await account();
        const assignment = await assign(
          "instance",
          null,
          variant === "account" ? { kind: "account", id: accountId } : { kind: "instanceUsers", id: null },
          await role(target),
        );
        try {
          expect(await allowedActions({ type: "account", id: accountId }, target)).toEqual(
            [...(EXPECTED[key] ?? [])].sort(),
          );
        } finally {
          await test.pool.query("delete from role_assignments where id = $1", [assignment]);
        }
      });
    }
  }

  it("instance.owner", async () => {
    const target = await fixture();
    const accountId = await account();
    await test.pool.query("update instance set owner_account_id = $1", [accountId]);
    try {
      expect(await allowedActions({ type: "account", id: accountId }, target)).toEqual(
        [...(EXPECTED["instance.owner"] ?? [])].sort(),
      );
    } finally {
      await test.pool.query("update instance set owner_account_id = null");
    }
  });

  const organizationRoles: {
    key: string;
    role: (fixture: Fixture) => Promise<{ builtIn: string } | { customRoleId: string } | null>;
  }[] = [
    { key: "organization.owner", role: async () => ({ builtIn: "owner" }) },
    { key: "organization.administrator", role: async () => ({ builtIn: "administrator" }) },
    { key: "organization.member", role: async () => null },
    ...organizationAreas.map((area) => ({
      key: `organization.custom.${area}`,
      role: async (target: Fixture) => ({
        customRoleId: await customRole("organization", target.organizationId, area),
      }),
    })),
  ];

  for (const { key, role } of organizationRoles) {
    for (const variant of ["account", "group", "organizationMembers", "instanceUsers"] as const) {
      it(`${key} through ${variant}`, async () => {
        const target = await fixture();
        const accountId = await account({ home: target.organizationId });
        await membership(target.organizationId, accountId, "member");
        const granted = await role(target);
        let instanceAssignment: string | null = null;
        if (granted) {
          if (variant === "group") {
            await test.pool.query("insert into group_members (group_id, account_id) values ($1, $2)", [
              target.groupId,
              accountId,
            ]);
          }
          const principal =
            variant === "account"
              ? { kind: "account", id: accountId }
              : variant === "group"
                ? { kind: "group", id: target.groupId }
                : { kind: variant, id: null };
          const assignment = await assign("organization", target.organizationId, principal, granted);
          if (variant === "instanceUsers") instanceAssignment = assignment;
        }
        try {
          expect(await allowedActions({ type: "account", id: accountId }, target)).toEqual(
            [...(EXPECTED[key] ?? [])].sort(),
          );
        } finally {
          if (instanceAssignment)
            await test.pool.query("delete from role_assignments where id = $1", [instanceAssignment]);
        }
      });
    }
  }

  for (const kind of ["collaborator", "guest"] as const) {
    it(`${kind} with roles that its fixed limits ignore`, async () => {
      const target = await fixture();
      const accountId = await account({ type: kind === "guest" ? "guest" : "standard" });
      await membership(target.organizationId, accountId, kind);
      await assign(
        "organization",
        target.organizationId,
        { kind: "account", id: accountId },
        { builtIn: "administrator" },
      );
      await assign(
        "organization",
        target.organizationId,
        { kind: "organizationMembers", id: null },
        { builtIn: "administrator" },
      );
      expect(await allowedActions({ type: "account", id: accountId }, target)).toEqual(
        [...(EXPECTED[kind] ?? [])].sort(),
      );
    });
  }

  it("breakGlass", async () => {
    const target = await fixture();
    const accountId = await account();
    await test.pool.query(
      "insert into break_glass_accesses (id, organization_id, account_id, reason, expires_at) values ($1, $2, $3, 'Matrix test reason', now() + interval '1 hour')",
      [randomUUID(), target.organizationId, accountId],
    );
    expect(await allowedActions({ type: "account", id: accountId }, target)).toEqual(
      [...(EXPECTED.breakGlass ?? [])].sort(),
    );
  });

  it("nonMember", async () => {
    const target = await fixture();
    const other = await fixture();
    const accountId = await account({ home: other.organizationId });
    await membership(other.organizationId, accountId, "member");
    await assign(
      "organization",
      other.organizationId,
      { kind: "account", id: accountId },
      { builtIn: "owner" },
    );
    expect(await allowedActions({ type: "account", id: accountId }, target)).toEqual(EXPECTED.nonMember);
  });

  it("deactivated", async () => {
    const target = await fixture();
    const accountId = await account({ home: target.organizationId });
    await membership(target.organizationId, accountId, "member");
    await assign(
      "organization",
      target.organizationId,
      { kind: "account", id: accountId },
      { builtIn: "owner" },
    );
    await assign("instance", null, { kind: "account", id: accountId }, { builtIn: "administrator" });
    await test.pool.query("update accounts set state = 'deactivated' where id = $1", [accountId]);
    expect(await allowedActions({ type: "account", id: accountId }, target)).toEqual(EXPECTED.deactivated);
  });

  it("anonymous", async () => {
    expect(await allowedActions(ANONYMOUS, await fixture())).toEqual(EXPECTED.anonymous);
  });

  it("system", async () => {
    expect(await allowedActions(SYSTEM, await fixture())).toEqual([...(EXPECTED.system ?? [])].sort());
  });
});
