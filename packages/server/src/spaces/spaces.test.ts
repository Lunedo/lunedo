import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import { ForbiddenError } from "../authorization/service.js";
import { spaceRoleCondition } from "../authorization/space-access.js";
import { languageSetting } from "../settings/builtin.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import { SpaceError } from "./common.js";
import { spaceRoles } from "./schema.js";
import {
  defaultSpacePermissionsSetting,
  membersCreateSpacesSetting,
  personalSpacesSetting,
} from "./settings.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("spaces", () => {
  let test: TestServices;
  const fixtures = spaceFixtures(() => test);
  const { account, organization, member, group, space, deactivate, role } = fixtures;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function grant(spaceId: string, accountId: string, spaceRole: string) {
    await test.database.execute(sql`
      insert into space_permissions (id, space_id, principal_kind, principal_id, role)
      values (gen_random_uuid(), ${spaceId}, 'account', ${accountId}, ${spaceRole}::space_role)`);
  }

  async function auditNames(targetId: string): Promise<string[]> {
    const result = await test.database.execute<{ name: string }>(
      sql`select name from audit_events where target_id = ${targetId} order by sequence`,
    );
    return result.rows.map((row) => row.name);
  }

  describe("creation", () => {
    it("creates a space with the creator as space admin, the given holders and an overview page", async () => {
      const org = await organization();
      const creator = await member(org.id);
      const reader = await member(org.id);
      const created = await space(org.id, creator, {
        name: "IT Operations",
        key: " itops ",
        grants: [{ principalKind: "account", principalId: reader, role: "reader" }],
      });
      expect(created).toMatchObject({
        key: "ITOPS",
        name: "IT Operations",
        visibility: "private",
        personal: false,
      });
      expect(await role(creator, created.id)).toBe("admin");
      expect(await role(reader, created.id)).toBe("reader");
      expect(await role(await member(org.id), created.id)).toBeNull();
      const overview = await test.database.execute<{
        kind: string;
        title: string;
        parent_id: string | null;
        number: string;
      }>(sql`select kind, title, parent_id, number from tree_items where id = ${created.overviewItemId}`);
      expect(overview.rows[0]).toMatchObject({ kind: "page", title: "IT Operations", parent_id: null });
      expect(created.overviewItemNumber).toBe(Number(overview.rows[0]?.number));
      expect(await auditNames(created.id)).toEqual([
        "space.created",
        "space.permissionGranted",
        "space.permissionGranted",
      ]);
    });

    it("refuses a taken key, invalid keys and invalid names", async () => {
      const org = await organization();
      const creator = await member(org.id);
      await space(org.id, creator, { key: "TAKEN1" });
      await expect(space(org.id, creator, { key: "taken1" })).rejects.toMatchObject({ code: "keyTaken" });
      await expect(space(org.id, creator, { key: "A" })).rejects.toMatchObject({ code: "invalidSpaceKey" });
      await expect(space(org.id, creator, { key: "WITH-DASH" })).rejects.toMatchObject({
        code: "invalidSpaceKey",
      });
      await expect(space(org.id, creator, { key: "ELEVENCHARS" })).rejects.toMatchObject({
        code: "invalidSpaceKey",
      });
      await expect(space(org.id, creator, { name: "  ", key: "EMPTY" })).rejects.toMatchObject({
        code: "invalidSpaceName",
      });
    });

    it("suggests free keys derived from the name", async () => {
      const org = await organization();
      const creator = await member(org.id);
      const first = await test.services.spaces.suggestKey("Quality Assurance Team");
      expect(first).toBe("QAT");
      await space(org.id, creator, { key: first });
      expect(await test.services.spaces.suggestKey("Quality Assurance Team")).toBe("QAT2");
    });

    it("lets administrators always and members by setting create spaces, never guests or collaborators", async () => {
      const org = await organization();
      const resource = { type: "organization", id: org.id };
      const regular = await member(org.id);
      const guest = await member(org.id, "guest");
      const collaborator = await member(org.id, "collaborator");
      const allowed = (id: string) =>
        test.services.authorization.authorize(accountPrincipal(id), "organization.spaces.create", resource);
      expect(await allowed(org.owner)).toBe(true);
      expect(await allowed(regular)).toBe(true);
      expect(await allowed(guest)).toBe(false);
      expect(await allowed(collaborator)).toBe(false);
      await test.settings.set(membersCreateSpacesSetting, { organization: org.id }, "organization", false);
      expect(await allowed(regular)).toBe(false);
      expect(await allowed(org.owner)).toBe(true);
    });

    it("refuses holders from outside the organization", async () => {
      const org = await organization();
      const other = await organization();
      const creator = await member(org.id);
      const outsider = await member(other.id);
      const foreignGroup = await group(other.id, [outsider]);
      await expect(
        space(org.id, creator, {
          grants: [{ principalKind: "account", principalId: outsider, role: "reader" }],
        }),
      ).rejects.toMatchObject({ code: "invalidHolder" });
      await expect(
        space(org.id, creator, {
          grants: [{ principalKind: "group", principalId: foreignGroup, role: "reader" }],
        }),
      ).rejects.toMatchObject({ code: "invalidHolder" });
    });

    it("reads the default permissions of the organization", async () => {
      const org = await organization();
      expect(await test.services.spaces.defaultPermissions(org.id)).toEqual({
        visibility: "organization",
        grants: [{ principalKind: "organizationMembers", principalId: null, role: "editor" }],
      });
      await test.settings.set(defaultSpacePermissionsSetting, { organization: org.id }, "organization", {
        visibility: "private",
        grants: [],
      });
      expect(await test.services.spaces.defaultPermissions(org.id)).toEqual({
        visibility: "private",
        grants: [],
      });
    });
  });

  describe("access", () => {
    it("grants roles through accounts, groups, all members, all internal users and visibility", async () => {
      const org = await organization();
      const creator = await member(org.id);
      const inGroup = await member(org.id);
      const team = await group(org.id, [inGroup]);
      const regular = await member(org.id);
      const guest = await member(org.id, "guest");
      const collaborator = await member(org.id, "collaborator");
      const elsewhere = await account();

      const byGroup = await space(org.id, creator, {
        grants: [{ principalKind: "group", principalId: team, role: "editor" }],
      });
      expect(await role(inGroup, byGroup.id)).toBe("editor");
      expect(await role(regular, byGroup.id)).toBeNull();

      const byMembers = await space(org.id, creator, {
        visibility: "organization",
        grants: [{ principalKind: "organizationMembers", principalId: null, role: "commenter" }],
      });
      expect(await role(regular, byMembers.id)).toBe("commenter");
      expect(await role(guest, byMembers.id)).toBeNull();
      expect(await role(collaborator, byMembers.id)).toBeNull();

      const byInstance = await space(org.id, creator, {
        visibility: "organization",
        grants: [{ principalKind: "instanceUsers", principalId: null, role: "reader" }],
      });
      expect(await role(elsewhere, byInstance.id)).toBe("reader");
      expect(await role(guest, byInstance.id)).toBeNull();

      const organizationVisible = await space(org.id, creator, { visibility: "organization" });
      expect(await role(regular, organizationVisible.id)).toBe("reader");
      expect(await role(guest, organizationVisible.id)).toBeNull();
      expect(await role(elsewhere, organizationVisible.id)).toBeNull();

      const instanceVisible = await space(org.id, creator, { visibility: "instance" });
      expect(await role(elsewhere, instanceVisible.id)).toBe("reader");
      expect(await role(guest, instanceVisible.id)).toBeNull();
    });

    it("never lets instance roles or break-glass access read a space", async () => {
      const org = await organization();
      const creator = await member(org.id);
      const created = await space(org.id, creator);
      const administrator = await account();
      await test.database.execute(sql`
        insert into role_assignments (id, scope, principal_kind, principal_id, built_in_role)
        values (gen_random_uuid(), 'instance', 'account', ${administrator}, 'administrator')`);
      await test.database.execute(sql`
        insert into break_glass_accesses (id, organization_id, account_id, reason, expires_at)
        values (gen_random_uuid(), ${org.id}, ${administrator}, 'test', now() + interval '1 hour')`);
      const decision = await test.services.authorization.explain(
        accountPrincipal(administrator),
        "space.view",
        {
          type: "space",
          id: created.id,
        },
      );
      expect(decision.allowed).toBe(false);
      expect(decision.denials).toEqual(["noSpaceRole"]);
    });

    it("denies deactivated accounts and narrows API tokens to their scopes", async () => {
      const org = await organization();
      const creator = await member(org.id);
      const editor = await member(org.id);
      const created = await space(org.id, creator, {
        grants: [{ principalKind: "account", principalId: editor, role: "editor" }],
      });
      const resource = { type: "space", id: created.id };
      const token = (scopes: Record<string, "view" | "manage">, organizationId: string | null = null) => ({
        type: "account" as const,
        id: editor,
        token: { id: "token", organizationId, scopes: { organization: scopes } },
      });
      const authorization = test.services.authorization;
      expect(await authorization.authorize(token({ spaces: "view" }), "space.view", resource)).toBe(true);
      expect(await authorization.authorize(token({ spaces: "view" }), "space.edit", resource)).toBe(false);
      expect(await authorization.authorize(token({ spaces: "manage" }), "space.edit", resource)).toBe(true);
      expect(await authorization.authorize(token({ settings: "manage" }), "space.view", resource)).toBe(
        false,
      );
      const other = await organization();
      expect(
        await authorization.authorize(token({ spaces: "manage" }, other.id), "space.view", resource),
      ).toBe(false);
      await deactivate(editor);
      expect(await authorization.authorize(accountPrincipal(editor), "space.view", resource)).toBe(false);
    });

    it("keeps the space filter in agreement with the single decision", async () => {
      const org = await organization();
      const creator = await member(org.id);
      const people = [
        await member(org.id),
        await member(org.id),
        await member(org.id, "guest"),
        await member(org.id, "collaborator"),
        await account(),
      ];
      const team = await group(org.id, [people[1] as string, people[2] as string]);
      const spaces = [
        await space(org.id, creator),
        await space(org.id, creator, { visibility: "organization" }),
        await space(org.id, creator, { visibility: "instance" }),
        await space(org.id, creator, {
          grants: [{ principalKind: "group", principalId: team, role: "editor" }],
        }),
        await space(org.id, creator, {
          visibility: "organization",
          grants: [{ principalKind: "organizationMembers", principalId: null, role: "commenter" }],
        }),
        await space(org.id, creator, {
          grants: [{ principalKind: "account", principalId: people[0] as string, role: "admin" }],
        }),
      ];
      for (const person of [creator, ...people]) {
        for (const candidate of spaces) {
          const held = await role(person, candidate.id);
          for (const minimum of spaceRoles) {
            const result = await test.database.execute<{ allowed: boolean }>(sql`
              select ${spaceRoleCondition(person, sql`s`, minimum)} as allowed from spaces s where s.id = ${candidate.id}`);
            const expected = held !== null && spaceRoles.indexOf(held) >= spaceRoles.indexOf(minimum);
            expect(result.rows[0]?.allowed, `${person} ${candidate.key} ${minimum}`).toBe(expected);
          }
        }
      }
    });

    it("lists only the spaces a person can read", async () => {
      const org = await organization();
      const creator = await member(org.id);
      const reader = await member(org.id);
      const visible = await space(org.id, creator, {
        name: "Visible handbook",
        grants: [{ principalKind: "account", principalId: reader, role: "reader" }],
      });
      await space(org.id, creator, { name: "Hidden handbook" });
      const page = await test.services.spaces.list(accountPrincipal(reader), {
        organizationId: org.id,
        page: { limit: 50, search: "handbook" },
      });
      expect(page.items.map((item) => item.id)).toEqual([visible.id]);
    });
  });

  describe("settings", () => {
    it("changes the key and redirects the old key until another space takes it", async () => {
      const org = await organization();
      const creator = await member(org.id);
      const created = await space(org.id, creator, { key: "OLDKEY" });
      const actor = accountPrincipal(creator);
      await test.services.spaces.changeKey(actor, created.id, "newkey");
      expect(await test.services.spaces.resolveKey("NEWKEY")).toMatchObject({
        redirected: false,
        space: { id: created.id },
      });
      expect(await test.services.spaces.resolveKey("oldkey")).toMatchObject({
        redirected: true,
        space: { id: created.id, key: "NEWKEY" },
      });
      const other = await space(org.id, creator, { key: "OLDKEY" });
      expect(await test.services.spaces.resolveKey("OLDKEY")).toMatchObject({
        redirected: false,
        space: { id: other.id },
      });
      await expect(test.services.spaces.changeKey(actor, created.id, other.key)).rejects.toMatchObject({
        code: "keyTaken",
      });
      expect(await auditNames(created.id)).toContain("space.updated");
    });

    it("counts but does not name people the caller may not see", async () => {
      const org = await organization();
      const creator = await member(org.id);
      await account({ name: "Somebody elsewhere" });
      const created = await space(org.id, creator);
      const impact = await test.services.spaces.visibilityImpact(
        accountPrincipal(creator),
        created.id,
        "instance",
      );
      expect(impact.changes.map((change) => change.name)).not.toContain("Somebody elsewhere");
      expect(impact.unlisted).toBeGreaterThan(0);
      expect(impact.gaining).toBe(impact.changes.length + impact.unlisted);
    });

    it("shows who gains and loses read access when the visibility changes", async () => {
      const org = await organization();
      const creator = await member(org.id, "member", "Creator");
      const regular = await member(org.id, "member", "Regular member");
      await member(org.id, "guest");
      const created = await space(org.id, creator);
      const impact = await test.services.spaces.visibilityImpact(
        accountPrincipal(creator),
        created.id,
        "organization",
      );
      const names = impact.changes.map((change) => change.name);
      expect(names).toContain("Regular member");
      expect(names).not.toContain("Creator");
      expect(names).not.toContain("Guest");
      expect(impact.gaining).toBe(impact.changes.length);
      expect(impact.losing).toBe(0);
      await test.services.spaces.changeVisibility(accountPrincipal(creator), created.id, "organization");
      expect(await role(regular, created.id)).toBe("reader");
      const back = await test.services.spaces.visibilityImpact(
        accountPrincipal(creator),
        created.id,
        "private",
      );
      expect(back.losing).toBe(impact.gaining);
    });
  });

  describe("private spaces", () => {
    const everyone = [
      { principalKind: "organizationMembers", principalId: null, role: "editor" },
      { principalKind: "instanceUsers", principalId: null, role: "reader" },
    ] as const;

    it("refuses roles for everyone when a private space is created", async () => {
      const org = await organization();
      const creator = await member(org.id);
      for (const grant of everyone) {
        await expect(
          space(org.id, creator, { visibility: "private", grants: [grant] }),
        ).rejects.toMatchObject({
          code: "privateSpaceBroadGrant",
        });
      }
      const open = await space(org.id, creator, { visibility: "organization", grants: [everyone[0]] });
      expect(await role(await member(org.id), open.id)).toBe("editor");
      await expect(
        test.services.spaces.setDefaultPermissions(
          accountPrincipal(creator),
          org.id,
          { visibility: "private", grants: [everyone[0]] },
          test.services.spacePermissions.holders,
        ),
      ).rejects.toMatchObject({ code: "privateSpaceBroadGrant" });
    });

    it("refuses roles for everyone in a private space later, and making a space with them private", async () => {
      const org = await organization();
      const creator = await member(org.id);
      const actor = accountPrincipal(creator);
      const closed = await space(org.id, creator);
      for (const grant of everyone) {
        const change = { action: "grant" as const, ...grant };
        await expect(test.services.spacePermissions.preview(actor, closed.id, change)).rejects.toMatchObject({
          code: "privateSpaceBroadGrant",
        });
        await expect(test.services.spacePermissions.apply(actor, closed.id, change)).rejects.toMatchObject({
          code: "privateSpaceBroadGrant",
        });
        await expect(
          test.services.spacePermissions.grant(
            actor,
            closed.id,
            [{ principalKind: grant.principalKind, principalId: null }],
            grant.role,
          ),
        ).rejects.toMatchObject({ code: "privateSpaceBroadGrant" });
      }
      const open = await space(org.id, creator, { visibility: "organization", grants: [everyone[0]] });
      await expect(test.services.spaces.visibilityImpact(actor, open.id, "private")).rejects.toMatchObject({
        code: "privateSpaceBroadGrant",
      });
      await expect(test.services.spaces.changeVisibility(actor, open.id, "private")).rejects.toMatchObject({
        code: "privateSpaceBroadGrant",
      });
      expect((await test.services.spaces.require(open.id)).visibility).toBe("organization");
      const [broad] = (await test.services.spacePermissions.list(open.id)).filter(
        (entry) => entry.principalKind === "organizationMembers",
      );
      await test.services.spacePermissions.apply(actor, open.id, {
        action: "remove",
        permissionId: broad?.id ?? "",
      });
      await test.services.spaces.changeVisibility(actor, open.id, "private");
      expect((await test.services.spaces.require(open.id)).visibility).toBe("private");
    });

    it("refuses a knowledge base audience that makes it private while everyone has a role", async () => {
      const org = await organization();
      const creator = await member(org.id);
      const readers = await group(org.id, []);
      const knowledgeBase = await test.services.spaces.create(
        accountPrincipal(creator),
        org.id,
        {
          name: "Help",
          key: await test.services.spaces.suggestKey("Help"),
          type: "knowledgeBase",
          audience: "signedIn",
          grants: [everyone[0]],
        },
        test.services.spacePermissions.holders,
      );
      await expect(
        test.services.knowledgeBases.changeAudience(accountPrincipal(creator), knowledgeBase.id, {
          audience: "groups",
          groupIds: [readers],
          confirmWidening: true,
        }),
      ).rejects.toMatchObject({ code: "privateSpaceBroadGrant" });
      expect((await test.services.spaces.require(knowledgeBase.id)).visibility).toBe("instance");
    });

    it("records one audit event per space for roles for everyone removed by the update", async () => {
      const org = await organization();
      const creator = await member(org.id);
      const closed = await space(org.id, creator, { name: "Cleaned" });
      await test.database.execute(sql`
        insert into private_space_grant_removals (space_id, organization_id, name, grants)
        values (${closed.id}, ${org.id}, 'Cleaned', ${JSON.stringify([
          { principalKind: "instanceUsers", role: "reader" },
          { principalKind: "organizationMembers", role: "editor" },
        ])}::jsonb)`);
      expect(await test.services.spacePermissions.recordPrivateGrantRemovals()).toBeGreaterThanOrEqual(1);
      const events = await test.database.execute<{
        actor_type: string;
        fields: unknown;
        scope_id: string;
      }>(sql`
        select actor_type, fields, scope_id from audit_events
        where target_id = ${closed.id} and name = 'space.privateGrantsRemoved'`);
      expect(events.rows).toEqual([
        {
          actor_type: "system",
          scope_id: org.id,
          fields: {
            name: "Cleaned",
            grants: [
              { principalKind: "instanceUsers", role: "reader" },
              { principalKind: "organizationMembers", role: "editor" },
            ],
          },
        },
      ]);
      const left = await test.database.execute(
        sql`select 1 from private_space_grant_removals where space_id = ${closed.id}`,
      );
      expect(left.rows).toHaveLength(0);
      expect(await test.services.spacePermissions.recordPrivateGrantRemovals()).toBe(0);
    });
  });

  describe("permissions", () => {
    it("previews and applies role changes with audit events", async () => {
      const org = await organization();
      const creator = await member(org.id);
      const reader = await member(org.id, "member", "Reader person");
      const created = await space(org.id, creator);
      const actor = accountPrincipal(creator);
      const change = {
        action: "grant" as const,
        principalKind: "account" as const,
        principalId: reader,
        role: "reader" as const,
      };
      const preview = await test.services.spacePermissions.preview(actor, created.id, change);
      expect(preview).toMatchObject({
        gaining: 1,
        losing: 0,
        changes: [{ accountId: reader, before: null, after: "reader" }],
      });
      const entries = await test.services.spacePermissions.apply(actor, created.id, change);
      const entry = entries.find((candidate) => candidate.principalId === reader);
      expect(entry).toMatchObject({ role: "reader", name: "Reader person" });
      await test.services.spacePermissions.apply(actor, created.id, {
        action: "change",
        permissionId: entry?.id ?? "",
        role: "editor",
      });
      expect(await role(reader, created.id)).toBe("editor");
      await test.services.spacePermissions.apply(actor, created.id, {
        action: "remove",
        permissionId: entry?.id ?? "",
      });
      expect(await role(reader, created.id)).toBeNull();
      expect(await auditNames(created.id)).toEqual(
        expect.arrayContaining([
          "space.permissionGranted",
          "space.permissionChanged",
          "space.permissionRemoved",
        ]),
      );
    });

    it("previews only holders that may receive a role, so no names leak from other organizations", async () => {
      const org = await organization();
      const other = await organization();
      const creator = await member(org.id);
      const outsider = await member(other.id, "member", "Outside person");
      const foreignGroup = await group(other.id, [outsider]);
      const created = await space(org.id, creator);
      const actor = accountPrincipal(creator);
      await expect(
        test.services.spacePermissions.preview(actor, created.id, {
          action: "grant",
          principalKind: "group",
          principalId: foreignGroup,
          role: "reader",
        }),
      ).rejects.toMatchObject({ code: "invalidHolder" });
      await expect(
        test.services.spacePermissions.preview(actor, created.id, {
          action: "grant",
          principalKind: "account",
          principalId: outsider,
          role: "reader",
        }),
      ).rejects.toMatchObject({ code: "invalidHolder" });
    });

    it("keeps at least one space admin", async () => {
      const org = await organization();
      const creator = await member(org.id);
      const created = await space(org.id, creator);
      const [own] = await test.services.spacePermissions.list(created.id);
      const actor = accountPrincipal(creator);
      await expect(
        test.services.spacePermissions.apply(actor, created.id, {
          action: "remove",
          permissionId: own?.id ?? "",
        }),
      ).rejects.toMatchObject({ code: "lastSpaceAdmin" });
      await expect(
        test.services.spacePermissions.apply(actor, created.id, {
          action: "change",
          permissionId: own?.id ?? "",
          role: "editor",
        }),
      ).rejects.toMatchObject({ code: "lastSpaceAdmin" });
      const successor = await member(org.id);
      await test.services.spacePermissions.apply(actor, created.id, {
        action: "grant",
        principalKind: "account",
        principalId: successor,
        role: "admin",
      });
      await test.services.spacePermissions.apply(actor, created.id, {
        action: "remove",
        permissionId: own?.id ?? "",
      });
      expect(await role(creator, created.id)).toBeNull();
      expect(await role(successor, created.id)).toBe("admin");
    });

    it("does not count a deactivated or empty holder as the remaining space admin", async () => {
      const org = await organization();
      const creator = await member(org.id);
      const leaving = await member(org.id);
      const emptyGroup = await group(org.id, []);
      const created = await space(org.id, creator, {
        grants: [
          { principalKind: "account", principalId: leaving, role: "admin" },
          { principalKind: "group", principalId: emptyGroup, role: "admin" },
        ],
      });
      await deactivate(leaving);
      const own = (await test.services.spacePermissions.list(created.id)).find(
        (entry) => entry.principalId === creator,
      );
      await expect(
        test.services.spacePermissions.apply(accountPrincipal(creator), created.id, {
          action: "remove",
          permissionId: own?.id ?? "",
        }),
      ).rejects.toMatchObject({ code: "lastSpaceAdmin" });
    });

    it("never lets anyone extend their own permissions", async () => {
      const org = await organization();
      const creator = await member(org.id);
      const editor = await member(org.id);
      const team = await group(org.id, [editor]);
      const created = await space(org.id, creator, {
        grants: [{ principalKind: "account", principalId: editor, role: "editor" }],
      });
      const actor = accountPrincipal(editor);
      await expect(
        test.services.spacePermissions.apply(actor, created.id, {
          action: "grant",
          principalKind: "group",
          principalId: team,
          role: "admin",
        }),
      ).rejects.toMatchObject({ code: "selfExtension" });
      const own = (await test.services.spacePermissions.list(created.id)).find(
        (entry) => entry.principalId === editor,
      );
      await expect(
        test.services.spacePermissions.apply(actor, created.id, {
          action: "change",
          permissionId: own?.id ?? "",
          role: "admin",
        }),
      ).rejects.toMatchObject({ code: "selfExtension" });
      expect(await role(editor, created.id)).toBe("editor");
    });

    it("shows spaces without an active space admin to the organization and lets an administrator appoint one", async () => {
      const org = await organization();
      const creator = await member(org.id);
      const created = await space(org.id, creator);
      const before = await test.services.spaces.withoutAdministrator(org.id);
      expect(before.items.map((item) => item.id)).not.toContain(created.id);
      await deactivate(creator);
      const after = await test.services.spaces.withoutAdministrator(org.id);
      expect(after.items.map((item) => item.id)).toContain(created.id);
      const administrator = accountPrincipal(org.owner);
      await expect(
        test.services.spaces.appointAdministrator(administrator, created.id, org.owner),
      ).rejects.toMatchObject({ code: "selfAppointment" });
      const successor = await member(org.id);
      await test.services.spaces.appointAdministrator(administrator, created.id, successor);
      expect(await role(successor, created.id)).toBe("admin");
      expect(await auditNames(created.id)).toContain("space.administratorAppointed");
      await expect(
        test.services.spaces.appointAdministrator(administrator, created.id, await member(org.id)),
      ).rejects.toMatchObject({ code: "spaceHasAdministrator" });
    });
  });

  describe("personal spaces", () => {
    it("creates the personal space once, on first use", async () => {
      const owner = await account();
      expect(await test.services.personalSpaces.find(owner)).toBeNull();
      const [first, second] = await Promise.all([
        test.services.personalSpaces.ensure(accountPrincipal(owner), "Personal space"),
        test.services.personalSpaces.ensure(accountPrincipal(owner), "Personal space"),
      ]);
      expect(first?.id).toBe(second?.id);
      expect(first).toMatchObject({
        personal: true,
        organizationId: null,
        visibility: "private",
        ownerId: owner,
      });
      expect(await role(owner, first?.id ?? "")).toBe("admin");
      const count = await test.database.execute<{ count: string }>(
        sql`select count(*) as count from spaces where personal_of = ${owner}`,
      );
      expect(Number(count.rows[0]?.count)).toBe(1);
    });

    it("names a personal space without a name of its own after its owner, in the owner's language", async () => {
      const owner = await account();
      const personal = await test.services.personalSpaces.ensure(accountPrincipal(owner), "Personal space");
      if (!personal) throw new Error("no personal space");
      const ownerName = (
        await test.database.execute<{ name: string }>(sql`select name from accounts where id = ${owner}`)
      ).rows[0]?.name;
      const shown = async () => (await test.services.spaces.get(personal.id))?.displayName;
      expect(await shown()).toBe(`Personal space of ${ownerName}`);
      await test.settings.set(languageSetting, { user: owner }, "user", "de");
      expect(await shown()).toBe(`Persönlicher Space von ${ownerName}`);
      await test.services.spaces.update(accountPrincipal(owner), personal.id, { name: "Notizen" });
      expect(await shown()).toBe("Notizen");
      const org = await organization();
      const other = await space(org.id, org.owner);
      expect(other.displayName).toBe(other.name);
    });

    it("follows the instance setting and is only for standard accounts", async () => {
      const guest = await account({ type: "guest" });
      await expect(
        test.services.personalSpaces.ensure(accountPrincipal(guest), "Personal space"),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await test.settings.set(personalSpacesSetting, {}, "instance", false);
      try {
        const owner = await account();
        await expect(
          test.services.personalSpaces.ensure(accountPrincipal(owner), "Personal space"),
        ).rejects.toBeInstanceOf(ForbiddenError);
      } finally {
        await test.settings.set(personalSpacesSetting, {}, "instance", true);
      }
    });

    it("refuses other visibilities and holders the owner cannot see", async () => {
      const owner = await account();
      const personal = await test.services.personalSpaces.ensure(accountPrincipal(owner), "Personal space");
      await expect(
        test.services.spaces.changeVisibility(accountPrincipal(owner), personal.id, "instance"),
      ).rejects.toMatchObject({ code: "personalSpaceVisibility" });
      const stranger = await account();
      await expect(
        test.services.spacePermissions.apply(accountPrincipal(owner), personal.id, {
          action: "grant",
          principalKind: "account",
          principalId: stranger,
          role: "reader",
        }),
      ).rejects.toMatchObject({ code: "invalidHolder" });
      await expect(
        test.services.spacePermissions.apply(accountPrincipal(owner), personal.id, {
          action: "grant",
          principalKind: "instanceUsers",
          principalId: null,
          role: "reader",
        }),
      ).rejects.toMatchObject({ code: "invalidHolder" });
      const org = await organization();
      await fixtures.join(org.id, owner);
      const colleague = await member(org.id);
      await test.services.spacePermissions.apply(accountPrincipal(owner), personal.id, {
        action: "grant",
        principalKind: "account",
        principalId: colleague,
        role: "reader",
      });
      expect(await role(colleague, personal.id)).toBe("reader");
    });

    it("lists personal spaces of deactivated owners for review without content and transfers them", async () => {
      const owner = await account({ name: "Leaving person" });
      const personal = await test.services.personalSpaces.ensure(accountPrincipal(owner), "Secret plans");
      const administrator = await account();
      await test.database.execute(sql`
        insert into role_assignments (id, scope, principal_kind, principal_id, built_in_role)
        values (gen_random_uuid(), 'instance', 'account', ${administrator}, 'administrator')`);
      await expect(
        test.services.personalSpaces.transfer(accountPrincipal(administrator), personal.id, await account()),
      ).rejects.toMatchObject({ code: "notUnderReview" });
      await deactivate(owner);
      const review = await test.services.personalSpaces.forReview();
      const entry = review.items.find((item) => item.spaceId === personal.id);
      expect(entry).toMatchObject({ ownerId: owner, ownerName: "Leaving person", pages: 1 });
      expect(JSON.stringify(entry)).not.toContain("Secret plans");
      expect(await role(administrator, personal.id)).toBeNull();
      await expect(
        test.services.personalSpaces.transfer(accountPrincipal(administrator), personal.id, administrator),
      ).rejects.toMatchObject({ code: "selfAppointment" });
      const successor = await account();
      await expect(
        test.services.personalSpaces.transfer(accountPrincipal(administrator), personal.id, successor),
      ).rejects.toMatchObject({ code: "invalidHolder" });
      expect(entry?.remainingMembers).toBe(0);
      await grant(personal.id, successor, "reader");
      expect(
        await test.services.personalSpaces.remainingMembers(accountPrincipal(administrator), personal.id),
      ).toEqual([{ id: successor, name: expect.any(String) }]);
      await test.services.personalSpaces.transfer(accountPrincipal(administrator), personal.id, successor);
      expect(await role(successor, personal.id)).toBe("admin");
      expect(
        (await test.services.personalSpaces.forReview()).items.map((item) => item.spaceId),
      ).not.toContain(personal.id);
      expect(await auditNames(personal.id)).toContain("space.personalTransferred");
      expect(await test.services.personalSpaces.find(successor)).toBeNull();
    });
  });

  describe("personal spaces of deactivated owners", () => {
    async function leftBehind() {
      const org = await organization();
      const owner = await member(org.id);
      await test.database.execute(
        sql`update accounts set home_organization_id = ${org.id} where id = ${owner}`,
      );
      const personal = await test.services.personalSpaces.ensure(accountPrincipal(owner), "Plans");
      const colleague = await member(org.id);
      const other = await member(org.id);
      await grant(personal.id, colleague, "editor");
      await grant(personal.id, other, "reader");
      await deactivate(owner);
      return { org, owner, personal, colleague, other };
    }

    const ids = (members: { id: string }[]) => members.map((entry) => entry.id).sort();

    it("lets administrators of the owner's home organization appoint a remaining member", async () => {
      const { org, personal, colleague, other } = await leftBehind();
      const admin = accountPrincipal(org.owner);
      const listed = await test.services.personalSpaces.forOrganization(org.id);
      expect(listed.items).toEqual([
        expect.objectContaining({ id: personal.id, activeMembers: 2, needsAdministrator: true }),
      ]);
      expect(JSON.stringify(listed.items)).not.toContain("Plans");
      expect(ids(await test.services.personalSpaces.remainingMembers(admin, personal.id, org.id))).toEqual(
        [colleague, other].sort(),
      );
      await test.services.personalSpaces.appointAdministrator(admin, org.id, personal.id, colleague);
      expect(await role(colleague, personal.id)).toBe("admin");
      expect(await role(org.owner, personal.id)).toBeNull();
      expect(await auditNames(personal.id)).toEqual(
        expect.arrayContaining(["space.personalAdministratorAppointed", "space.permissionChanged"]),
      );
      const notified = await test.database.execute<{ recipient_id: string }>(sql`
        select recipient_id from notifications
        where type = 'space.administratorAppointed' and target_id = ${personal.id}`);
      expect(notified.rows.map((row) => row.recipient_id)).toEqual([colleague]);
      await expect(
        test.services.personalSpaces.appointAdministrator(admin, org.id, personal.id, other),
      ).rejects.toMatchObject({ code: "spaceHasAdministrator" });
      expect(await test.services.personalSpaces.remainingMembers(admin, personal.id, org.id)).toEqual([]);
    });

    it("refuses appointing oneself, people outside the space and spaces of another home organization", async () => {
      const { org, personal, other } = await leftBehind();
      const stranger = await member(org.id);
      await grant(personal.id, org.owner, "reader");
      const admin = accountPrincipal(org.owner);
      await expect(
        test.services.personalSpaces.appointAdministrator(admin, org.id, personal.id, org.owner),
      ).rejects.toMatchObject({ code: "selfAppointment" });
      expect(
        ids(await test.services.personalSpaces.remainingMembers(admin, personal.id, org.id)),
      ).not.toContain(org.owner);
      await expect(
        test.services.personalSpaces.appointAdministrator(admin, org.id, personal.id, stranger),
      ).rejects.toMatchObject({ code: "invalidHolder" });
      const elsewhere = await organization();
      await expect(
        test.services.personalSpaces.appointAdministrator(
          accountPrincipal(elsewhere.owner),
          elsewhere.id,
          personal.id,
          other,
        ),
      ).rejects.toMatchObject({ code: "spaceNotFound" });
      expect((await test.services.personalSpaces.forOrganization(elsewhere.id)).items).toEqual([]);
      expect(await role(stranger, personal.id)).toBeNull();
      expect(await role(other, personal.id)).toBe("reader");
    });

    it("transfers only to remaining members and never to the caller", async () => {
      const { personal, colleague } = await leftBehind();
      const administrator = await account();
      await test.database.execute(sql`
        insert into role_assignments (id, scope, principal_kind, principal_id, built_in_role)
        values (gen_random_uuid(), 'instance', 'account', ${administrator}, 'administrator')`);
      await grant(personal.id, administrator, "reader");
      const as = accountPrincipal(administrator);
      await expect(
        test.services.personalSpaces.transfer(as, personal.id, administrator),
      ).rejects.toMatchObject({
        code: "selfAppointment",
      });
      expect(ids(await test.services.personalSpaces.remainingMembers(as, personal.id))).not.toContain(
        administrator,
      );
      await expect(
        test.services.personalSpaces.transfer(as, personal.id, await account()),
      ).rejects.toMatchObject({
        code: "invalidHolder",
      });
      await test.services.personalSpaces.transfer(as, personal.id, colleague);
      expect(await role(colleague, personal.id)).toBe("admin");
    });

    it("notifies the administrators of the home organization only while members remain", async () => {
      const org = await organization();
      const elsewhere = await organization();
      const owner = await member(org.id);
      const lonely = await member(org.id);
      await test.database.execute(
        sql`update accounts set home_organization_id = ${org.id} where id in (${owner}, ${lonely})`,
      );
      const personal = await test.services.personalSpaces.ensure(accountPrincipal(owner), "Plans");
      const empty = await test.services.personalSpaces.ensure(accountPrincipal(lonely), "Alone");
      await grant(personal.id, await member(org.id), "editor");
      await test.services.memberships.deactivate(accountPrincipal(org.owner), owner);
      await test.services.memberships.deactivate(accountPrincipal(org.owner), lonely);
      const notified = await test.database.execute<{
        recipient_id: string;
        target_id: string;
        params: unknown;
      }>(sql`
        select recipient_id, target_id, params from notifications
        where type = 'space.personalWithoutAdministrator'
          and target_id in (${personal.id}, ${empty.id})`);
      expect(notified.rows).toEqual([
        { recipient_id: org.owner, target_id: personal.id, params: { spaceKey: personal.key } },
      ]);
      expect(notified.rows.map((row) => row.recipient_id)).not.toContain(elsewhere.owner);
      expect(JSON.stringify(notified.rows)).not.toContain("Plans");
    });

    it("leaves only the clean-up when nobody remains", async () => {
      const org = await organization();
      const owner = await member(org.id);
      await test.database.execute(
        sql`update accounts set home_organization_id = ${org.id} where id = ${owner}`,
      );
      const personal = await test.services.personalSpaces.ensure(accountPrincipal(owner), "Plans");
      await deactivate(owner);
      expect((await test.services.personalSpaces.forOrganization(org.id)).items).toEqual([]);
      const review = await test.services.personalSpaces.forReview();
      expect(review.items.find((item) => item.spaceId === personal.id)?.remainingMembers).toBe(0);
      await expect(
        test.services.personalSpaces.transfer(accountPrincipal(org.owner), personal.id, await account()),
      ).rejects.toMatchObject({ code: "invalidHolder" });
    });
  });

  it("reports space errors with codes", () => {
    expect(new SpaceError("keyTaken", "taken").code).toBe("keyTaken");
    expect(SYSTEM.type).toBe("system");
  });
});
