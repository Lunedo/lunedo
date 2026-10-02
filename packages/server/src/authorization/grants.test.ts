import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, type Principal, SYSTEM } from "../accounts/principal.js";
import { hashToken } from "../auth/tokens.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { generateApiToken } from "../tokens/format.js";
import { tokenMaxLifetimeSetting } from "../tokens/settings.js";
import type { Areas } from "./areas.js";
import { ForbiddenError } from "./service.js";

const baseUrl = testDatabaseBaseUrl();
const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(!baseUrl)("granting access", () => {
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

  async function grantRole(
    organizationId: string,
    accountId: string,
    areas: Areas,
    expiresAt: Date | null = null,
  ): Promise<string> {
    const role = await test.services.roles.createCustom(SYSTEM, "organization", organizationId, {
      name: `Role ${randomUUID().slice(0, 8)}`,
      areas,
    });
    await test.services.roles.assign(SYSTEM, {
      scope: "organization",
      organizationId,
      role: { customRoleId: role.id },
      principal: { kind: "account", id: accountId },
      expiresAt,
    });
    return role.id;
  }

  async function administrator(organizationId: string, accountId: string, expiresAt: Date | null = null) {
    return test.services.roles.assign(SYSTEM, {
      scope: "organization",
      organizationId,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id: accountId },
      expiresAt,
    });
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

  describe("tokens for service accounts", () => {
    it("never give the creator more than their own permanent permissions", async () => {
      const org = await organization();
      const bob = await standard(org.id);
      await grantRole(org.id, bob, { integrationsAndApi: "manage" });
      const bot = await test.services.serviceAccounts.create(SYSTEM, org.id, { name: "Bot" });
      await administrator(org.id, bot.id);
      const everything = {
        organization: {
          membersAndGroups: "manage",
          spaces: "manage",
          settings: "manage",
          signInAndSecurity: "manage",
          integrationsAndApi: "manage",
          auditLog: "manage",
        },
      } as const;
      expect(
        await denial(
          test.services.apiTokens.create(accountPrincipal(bob), {
            accountId: bot.id,
            name: "Escalation",
            scopes: everything,
          }),
        ),
      ).toBe("roleExceedsOwnPermissions");
      const narrow = await test.services.apiTokens.create(accountPrincipal(bob), {
        accountId: bot.id,
        name: "Integrations only",
        scopes: { organization: { integrationsAndApi: "manage", membersAndGroups: "view" } },
      });
      expect(narrow.apiToken.name).toBe("Integrations only");
      const owner = await test.services.apiTokens.create(accountPrincipal(org.owner), {
        accountId: bot.id,
        name: "Full",
        scopes: everything,
      });
      expect(owner.apiToken.name).toBe("Full");
    });

    it("count only permanent permissions of the creator", async () => {
      const org = await organization();
      const carol = await standard(org.id);
      await grantRole(org.id, carol, { integrationsAndApi: "manage" });
      await administrator(org.id, carol, new Date(Date.now() + DAY_MS));
      const bot = await test.services.serviceAccounts.create(SYSTEM, org.id, { name: "Bot" });
      await administrator(org.id, bot.id);
      expect(
        await denial(
          test.services.apiTokens.create(accountPrincipal(carol), {
            accountId: bot.id,
            name: "Through the bot",
            scopes: { organization: { membersAndGroups: "manage" } },
          }),
        ),
      ).toBe("selfExtension");
    });

    it("refuse personal tokens created for someone else", async () => {
      const org = await organization();
      const other = await standard(org.id);
      await expect(
        test.services.apiTokens.create(accountPrincipal(org.owner), {
          accountId: other,
          name: "Theirs",
          scopes: { organization: { membersAndGroups: "view" } },
        }),
      ).rejects.toMatchObject({ code: "invalidOwner" });
    });
  });

  describe("custom roles", () => {
    it("cannot be widened to keep temporary rights", async () => {
      const org = await organization();
      const carol = await standard(org.id);
      const auditors = await grantRole(org.id, carol, { auditLog: "view" });
      await administrator(org.id, carol, new Date(Date.now() + DAY_MS));
      const widen = (areas: Areas) =>
        test.services.roles.updateCustom(accountPrincipal(carol), "organization", org.id, auditors, {
          areas,
        });
      expect(await denial(widen({ auditLog: "view", membersAndGroups: "manage", settings: "manage" }))).toBe(
        "selfExtension",
      );
      const someoneElses = await grantRole(org.id, await standard(org.id), { auditLog: "view" });
      expect(
        await denial(
          test.services.roles.updateCustom(accountPrincipal(carol), "organization", org.id, someoneElses, {
            areas: { auditLog: "view", settings: "manage" },
          }),
        ),
      ).toBe("roleExceedsOwnPermissions");
      const narrowed = await widen({});
      expect(narrowed.areas).toEqual({});
    });

    it("can be widened by permanent holders of the areas", async () => {
      const org = await organization();
      const dave = await standard(org.id);
      const role = await grantRole(org.id, await standard(org.id), { auditLog: "view" });
      await administrator(org.id, dave);
      const updated = await test.services.roles.updateCustom(
        accountPrincipal(dave),
        "organization",
        org.id,
        role,
        {
          areas: { auditLog: "view", settings: "manage" },
        },
      );
      expect(updated.areas).toEqual({ auditLog: "view", settings: "manage" });
    });
  });

  describe("groups with roles", () => {
    it("take new members only from permanent holders of the group's areas", async () => {
      const org = await organization();
      const erin = await standard(org.id);
      await administrator(org.id, erin, new Date(Date.now() + DAY_MS));
      const group = await test.services.groups.create(SYSTEM, org.id, { name: "Admins" });
      await test.services.roles.assign(SYSTEM, {
        scope: "organization",
        organizationId: org.id,
        role: { builtIn: "administrator" },
        principal: { kind: "group", id: group.id },
      });
      await test.services.groups.addManager(SYSTEM, group.id, erin);
      expect(await denial(test.services.groups.addMember(accountPrincipal(erin), group.id, erin))).toBe(
        "selfExtension",
      );
      const frank = await standard(org.id);
      expect(await denial(test.services.groups.addMember(accountPrincipal(erin), group.id, frank))).toBe(
        "roleExceedsOwnPermissions",
      );
      await test.services.groups.addMember(accountPrincipal(org.owner), group.id, frank);
    });

    it("are deleted only by actors who outrank the group's roles", async () => {
      const org = await organization();
      const gina = await standard(org.id);
      await grantRole(org.id, gina, { membersAndGroups: "manage" });
      const group = await test.services.groups.create(SYSTEM, org.id, { name: "Admins" });
      await test.services.roles.assign(SYSTEM, {
        scope: "organization",
        organizationId: org.id,
        role: { builtIn: "administrator" },
        principal: { kind: "group", id: group.id },
      });
      expect(await denial(test.services.groups.delete(accountPrincipal(gina), group.id))).toBe(
        "roleExceedsOwnPermissions",
      );
    });
  });

  describe("owners", () => {
    it("are standard accounts only", async () => {
      const org = await organization();
      const bot = await test.services.serviceAccounts.create(SYSTEM, org.id, { name: "Bot" });
      await expect(
        test.services.roles.assign(SYSTEM, {
          scope: "organization",
          organizationId: org.id,
          role: { builtIn: "owner" },
          principal: { kind: "account", id: bot.id },
        }),
      ).rejects.toMatchObject({ code: "invalidPrincipal" });
    });

    it("are counted among standard accounts only", async () => {
      const org = await organization();
      const bot = await test.services.serviceAccounts.create(SYSTEM, org.id, { name: "Bot" });
      await test.pool.query(
        `insert into role_assignments (id, scope, organization_id, principal_kind, principal_id, built_in_role)
         values ($1, 'organization', $2, 'account', $3, 'owner')`,
        [randomUUID(), org.id, bot.id],
      );
      const assignments = (await test.services.roles.listAssignments("organization", org.id)).items;
      const ownerAssignment = assignments.find((assignment) => assignment.principalId === org.owner);
      if (!ownerAssignment) throw new Error("The owner has no assignment");
      await expect(
        test.services.roles.unassign(accountPrincipal(org.owner), "organization", org.id, ownerAssignment.id),
      ).rejects.toMatchObject({ code: "lastOwner" });
    });
  });

  describe("service account deactivation", () => {
    it("needs a rank above the service account's roles", async () => {
      const org = await organization();
      const henry = await standard(org.id);
      await grantRole(org.id, henry, { integrationsAndApi: "manage" });
      const bot = await test.services.serviceAccounts.create(SYSTEM, org.id, { name: "Bot" });
      await administrator(org.id, bot.id);
      expect(await denial(test.services.serviceAccounts.deactivate(accountPrincipal(henry), bot.id))).toBe(
        "roleExceedsOwnPermissions",
      );
      expect(await test.services.serviceAccounts.deactivate(accountPrincipal(org.owner), bot.id)).toBe(0);
    });
  });

  describe("token lifetimes", () => {
    it("follow the strictest organization the token reaches", async () => {
      const home = await organization();
      const strict = await organization();
      const person = await standard(home.id);
      await test.database.transaction((tx) =>
        test.services.memberships.add(tx, SYSTEM, {
          organizationId: strict.id,
          accountId: person,
          kind: "collaborator",
        }),
      );
      await test.settings.set(tokenMaxLifetimeSetting, { organization: strict.id }, "organization", 30);
      const actor = accountPrincipal(person);
      const scopes = { organization: { membersAndGroups: "view" as const } };
      const late = new Date(Date.now() + 200 * DAY_MS);
      await expect(
        test.services.apiTokens.create(actor, {
          accountId: person,
          name: "X",
          scopes,
          organizationId: strict.id,
          expiresAt: late,
        }),
      ).rejects.toMatchObject({ code: "expiryTooLate" });
      await expect(
        test.services.apiTokens.create(actor, { accountId: person, name: "Any", scopes, expiresAt: late }),
      ).rejects.toMatchObject({ code: "expiryTooLate" });
      const limitedToHome = await test.services.apiTokens.create(actor, {
        accountId: person,
        name: "Home",
        scopes,
        organizationId: home.id,
        expiresAt: late,
      });
      expect(limitedToHome.apiToken.organizationId).toBe(home.id);
      const defaulted = await test.services.apiTokens.create(actor, {
        accountId: person,
        name: "Default",
        scopes,
        organizationId: strict.id,
      });
      expect(Math.round(((defaulted.apiToken.expiresAt?.getTime() ?? 0) - Date.now()) / DAY_MS)).toBe(30);
    });

    it("allow no expiry only where no reached organization sets a maximum", async () => {
      const home = await organization();
      const strict = await organization();
      const person = await standard(home.id);
      await test.database.transaction((tx) =>
        test.services.memberships.add(tx, SYSTEM, {
          organizationId: strict.id,
          accountId: person,
          kind: "collaborator",
        }),
      );
      await test.settings.set(tokenMaxLifetimeSetting, { organization: strict.id }, "organization", 30);
      try {
        const actor = accountPrincipal(person);
        const scopes = { organization: { membersAndGroups: "view" as const } };
        await expect(
          test.services.apiTokens.create(actor, {
            accountId: person,
            name: "Forever",
            scopes,
            expiresAt: null,
          }),
        ).rejects.toMatchObject({ code: "expiryRequired" });
        const atHome = await test.services.apiTokens.create(actor, {
          accountId: person,
          name: "Forever at home",
          scopes,
          organizationId: home.id,
          expiresAt: null,
        });
        expect(atHome.apiToken.expiresAt).toBeNull();
      } finally {
        await test.settings.clear(tokenMaxLifetimeSetting, { organization: strict.id }, "organization");
      }
    });
  });

  describe("tokens limited to one organization", () => {
    it("cannot carry instance scopes", async () => {
      const org = await organization();
      await expect(
        test.services.apiTokens.create(accountPrincipal(org.owner), {
          accountId: org.owner,
          name: "Mixed",
          organizationId: org.id,
          scopes: { instance: { accounts: "manage" }, organization: { membersAndGroups: "view" } },
        }),
      ).rejects.toMatchObject({ code: "invalidScopes" });
    });

    it("grant nothing at the instance level, including rule grants", async () => {
      const home = await organization();
      const other = await organization();
      const admin = await standard(home.id);
      await test.services.roles.assign(SYSTEM, {
        scope: "instance",
        organizationId: null,
        role: { builtIn: "administrator" },
        principal: { kind: "account", id: admin },
      });
      await administrator(other.id, admin).catch(() => undefined);
      const target = await standard(other.id);
      const token = generateApiToken();
      const inserted = await test.pool.query<{ id: string }>(
        `insert into api_tokens (id, account_id, organization_id, name, token_hash, token_prefix, scopes, expires_at)
         values ($1, $2, $3, 'Old', $4, 'ph_xxxxxx', $5, now() + interval '1 day') returning id`,
        [
          randomUUID(),
          admin,
          home.id,
          hashToken(token),
          JSON.stringify({ instance: { accounts: "manage" }, organization: { membersAndGroups: "manage" } }),
        ],
      );
      const authenticated = await test.services.apiTokens.authenticate(token, undefined);
      expect(authenticated.grant.id).toBe(inserted.rows[0]?.id);
      const principal: Principal = { type: "account", id: admin, token: authenticated.grant };
      const auth = test.services.authorization;
      expect(await auth.authorize(principal, "instance.accounts.view", { type: "instance" })).toBe(false);
      expect(await auth.authorize(principal, "account.deactivate", { type: "account", id: target })).toBe(
        false,
      );
      expect(
        await auth.authorize(accountPrincipal(admin), "account.deactivate", { type: "account", id: target }),
      ).toBe(true);
      expect(
        await auth.authorize(principal, "organization.members.manage", { type: "organization", id: home.id }),
      ).toBe(false);
      await test.pool.query("delete from role_assignments where scope = 'instance' and principal_id = $1", [
        admin,
      ]);
    });
  });

  describe("break-glass access", () => {
    it("ends at once when the requester loses the instance role", async () => {
      const org = await organization();
      const operator = await standard(null);
      const assignment = await test.services.roles.assign(SYSTEM, {
        scope: "instance",
        organizationId: null,
        role: { builtIn: "administrator" },
        principal: { kind: "account", id: operator },
      });
      await test.pool.query(
        "insert into break_glass_accesses (id, organization_id, account_id, reason, expires_at) values ($1, $2, $3, 'Matrix test reason', now() + interval '1 hour')",
        [randomUUID(), org.id, operator],
      );
      const resource = { type: "organization", id: org.id };
      const auth = test.services.authorization;
      expect(await auth.authorize(accountPrincipal(operator), "organization.members.manage", resource)).toBe(
        true,
      );
      await test.services.roles.unassign(SYSTEM, "instance", null, assignment.id);
      expect(await auth.authorize(accountPrincipal(operator), "organization.members.manage", resource)).toBe(
        false,
      );
      expect(await auth.authorize(accountPrincipal(operator), "organization.view", resource)).toBe(false);
    });
  });
});
