import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import type { SyntheticExport } from "./testing/confluence-export.js";
import { ALICE, BOB, CAROL, PEOPLE_PAGE, peopleExport } from "./testing/fixture.js";
import { importHarness } from "./testing/harness.js";

const baseUrl = testDatabaseBaseUrl();

const ADMIN_PERMISSIONS = [
  "VIEWSPACE",
  "EDITSPACE",
  "COMMENT",
  "SETSPACEPERMISSIONS",
  "REMOVEPAGE",
  "SETPAGEPERMISSIONS",
];
const EDITOR_PERMISSIONS = ["VIEWSPACE", "EDITSPACE", "REMOVEPAGE", "SETPAGEPERMISSIONS", "COMMENT"];

function restrictedExport(): SyntheticExport {
  return {
    ...peopleExport(),
    spacePermissions: [
      ...ADMIN_PERMISSIONS.map((type, index) => ({ id: `91${index}`, type, userKey: ALICE.key })),
      { id: "920", type: "VIEWSPACE", userKey: BOB.key },
      ...EDITOR_PERMISSIONS.map((type, index) => ({ id: `93${index}`, type, group: "Editors" })),
    ],
    restrictions: [
      { id: "9501", contentId: PEOPLE_PAGE.secret, kind: "View", userKey: CAROL.key },
      { id: "9502", contentId: PEOPLE_PAGE.secret, kind: "View", userKey: BOB.key },
      { id: "9503", contentId: PEOPLE_PAGE.secret, kind: "View", group: "hr-team" },
      { id: "9504", contentId: PEOPLE_PAGE.editors, kind: "Edit", userKey: BOB.key },
      { id: "9505", contentId: PEOPLE_PAGE.editors, kind: "Edit", group: "Editors" },
    ],
  };
}

type Role = "admin" | "editor" | "reader" | null;

interface Confluence {
  readonly role: Role;
  readonly names: readonly string[];
}

const RESTRICTIONS = restrictedExport().restrictions ?? [];

function confluenceAllows(person: Confluence, pageSourceId: string, action: "view" | "edit"): boolean {
  if (person.role === null) return false;
  const listed = (kind: "View" | "Edit") => {
    const entries = RESTRICTIONS.filter((entry) => entry.contentId === pageSourceId && entry.kind === kind);
    return (
      entries.length === 0 ||
      entries.some((entry) => person.names.includes(entry.userKey ?? `group:${entry.group ?? ""}`))
    );
  };
  if (!listed("View")) return false;
  if (action === "view") return true;
  return person.role !== "reader" && listed("Edit");
}

describe.skipIf(!baseUrl)("Confluence imports: resolving people, groups and permissions", () => {
  let test: TestServices;
  const fixtures = spaceFixtures(() => test);
  const harness = importHarness(() => test);
  const as = (id: string) => accountPrincipal(id);

  beforeAll(async () => {
    test = await createTestServices(baseUrl as string);
  });

  afterAll(async () => {
    await test?.close();
  });

  async function administrator(organizationId: string, name: string): Promise<string> {
    const id = await fixtures.member(organizationId, "member", name);
    await test.database.execute(sql`
      insert into role_assignments (id, scope, organization_id, principal_kind, principal_id, built_in_role)
      values (gen_random_uuid(), 'organization', ${organizationId}, 'account', ${id}, 'administrator')`);
    return id;
  }

  async function world() {
    const organization = await fixtures.organization();
    const other = await fixtures.organization();
    const alice = await fixtures.member(organization.id, "member", "Alice Archer");
    const bob = await fixtures.member(organization.id, "member", "Bob Brown");
    const carol = await fixtures.member(organization.id, "member", "Carol Clark");
    const editor = await fixtures.member(organization.id, "member", "Ed Editor");
    const hrMember = await fixtures.member(organization.id, "member", "Hana Human");
    const member = await fixtures.member(organization.id, "member", "Max Member");
    const reviewer = await fixtures.member(organization.id, "member", "Rita Reviewer");
    const secondAdmin = await administrator(organization.id, "Sam Second");
    const editors = await test.services.groups.create(SYSTEM, organization.id, { name: "Editors" });
    await test.services.groups.addMember(SYSTEM, editors.id, editor);
    const hr = await test.services.groups.create(SYSTEM, organization.id, { name: "People team" });
    await test.services.groups.addMember(SYSTEM, hr.id, hrMember);
    const foreigner = await fixtures.member(other.id, "member", "Fiona Foreign");
    const foreignGroup = await test.services.groups.create(SYSTEM, other.id, { name: "hr-team" });
    await test.services.groups.addMember(SYSTEM, foreignGroup.id, foreigner);
    return {
      organizationId: organization.id,
      importer: organization.owner,
      secondAdmin,
      alice,
      bob,
      carol,
      editor,
      hrMember,
      member,
      reviewer,
      editors: editors.id,
      hr: hr.id,
      otherOrganizationId: other.id,
      otherAdmin: other.owner,
      foreigner,
      foreignGroup: foreignGroup.id,
    };
  }

  type World = Awaited<ReturnType<typeof world>>;

  async function imported(w: World, model: SyntheticExport = restrictedExport()) {
    const result = await harness.imported(model, {
      organizationId: w.organizationId,
      admin: w.importer,
      key: `Q${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      reviewers: [w.reviewer],
    });
    expect(result.state).toBe("review");
    return result;
  }

  async function placeholder(importId: string, accountId: string): Promise<string> {
    return harness.target(importId, "person", accountId);
  }

  async function accept(w: World, importId: string) {
    const proposal = await test.services.imports.resolution.proposal(as(w.importer), importId);
    await test.services.imports.accept(as(w.importer), importId, {
      visibility: proposal.visibility,
      grants: proposal.grants.map(({ name: _name, ...grant }) => grant),
    });
  }

  async function sharesIn(spaceId: string): Promise<number> {
    const result = await test.database.execute<{ count: number }>(sql`
      select count(*)::int as count from page_shares ps join tree_items t on t.id = ps.item_id
      where t.space_id = ${spaceId}`);
    return result.rows[0]?.count ?? 0;
  }

  async function allowed(accountId: string, action: "item.view" | "item.edit", itemId: string) {
    return (await test.services.authorization.explain(as(accountId), action, { type: "item", id: itemId }))
      .allowed;
  }

  describe("restrictions never become shares", () => {
    async function neverMoreThanConfluence(w: World, importId: string, spaceId: string) {
      const people: Record<string, Confluence> = {
        [w.alice]: { role: "admin", names: [ALICE.key] },
        [w.bob]: { role: "reader", names: [BOB.key] },
        [w.carol]: { role: null, names: [CAROL.key] },
        [w.editor]: { role: "editor", names: ["group:Editors"] },
        [w.hrMember]: { role: null, names: ["group:hr-team"] },
        [w.member]: { role: null, names: [] },
        [w.foreigner]: { role: null, names: [] },
      };
      const pages = await test.database.execute<{ source_id: string; target_id: string }>(sql`
        select source_id, target_id from import_items where import_id = ${importId} and kind = 'page'`);
      expect(pages.rows.length).toBeGreaterThan(3);
      for (const [accountId, person] of Object.entries(people)) {
        for (const page of pages.rows) {
          for (const action of ["view", "edit"] as const) {
            if (await allowed(accountId, `item.${action}`, page.target_id)) {
              expect(
                confluenceAllows(person, page.source_id, action),
                `${action} ${page.source_id} by ${person.names.join(",") || accountId}`,
              ).toBe(true);
            }
          }
        }
      }
      const secret = pages.rows.find((page) => page.source_id === PEOPLE_PAGE.secret)?.target_id ?? "";
      const editorsPage = pages.rows.find((page) => page.source_id === PEOPLE_PAGE.editors)?.target_id ?? "";
      for (const outsider of [w.importer, w.secondAdmin, w.reviewer]) {
        expect(await allowed(outsider, "item.view", secret)).toBe(false);
        expect(await allowed(outsider, "item.edit", editorsPage)).toBe(false);
      }
      expect(await sharesIn(spaceId)).toBe(0);
      return { secret, editorsPage };
    }

    it("lists named people and groups on the restriction only and never opens more than Confluence did", async () => {
      const w = await world();
      const result = await imported(w);
      const spaceId = result.quarantineSpace?.id ?? "";
      expect(await sharesIn(spaceId)).toBe(0);
      await test.services.imports.resolution.mapPeople(as(w.importer), result.id, [
        { placeholderId: await placeholder(result.id, ALICE.accountId), accountId: w.alice },
        { placeholderId: await placeholder(result.id, BOB.accountId), accountId: w.bob },
        { placeholderId: await placeholder(result.id, CAROL.accountId), accountId: w.carol },
      ]);
      await neverMoreThanConfluence(w, result.id, spaceId);
      await accept(w, result.id);
      const { secret, editorsPage } = await neverMoreThanConfluence(w, result.id, spaceId);
      expect(await allowed(w.bob, "item.view", secret)).toBe(true);
      expect(await allowed(w.bob, "item.edit", editorsPage)).toBe(false);
      expect(await allowed(w.carol, "item.view", secret)).toBe(false);
      expect(await allowed(w.editor, "item.edit", editorsPage)).toBe(true);
      await test.services.imports.resolution.mapGroup(as(w.secondAdmin), result.id, "hr-team", {
        groupId: w.hr,
      });
      await neverMoreThanConfluence(w, result.id, spaceId);
      expect(await allowed(w.hrMember, "item.view", secret)).toBe(false);
      const holders = await test.database.execute<{
        kind: string;
        principal_kind: string;
        principal_id: string;
      }>(
        sql`select kind::text as kind, principal_kind::text as principal_kind, principal_id
          from page_restriction_holders where item_id = ${secret} order by principal_id`,
      );
      expect(holders.rows).toEqual(
        expect.arrayContaining([
          { kind: "view", principal_kind: "account", principal_id: w.bob },
          { kind: "view", principal_kind: "account", principal_id: w.carol },
          { kind: "view", principal_kind: "group", principal_id: w.hr },
        ]),
      );
    });

    it("lets a named person in once they get a role in the space, and keeps everyone else out", async () => {
      const w = await world();
      const result = await imported(w);
      const spaceId = result.quarantineSpace?.id ?? "";
      await test.services.imports.resolution.mapPeople(as(w.importer), result.id, [
        { placeholderId: await placeholder(result.id, CAROL.accountId), accountId: w.carol },
      ]);
      await accept(w, result.id);
      const secret = await harness.target(result.id, "page", PEOPLE_PAGE.secret);
      expect(await allowed(w.carol, "item.view", secret)).toBe(false);
      await test.database.execute(sql`
        insert into space_permissions (id, space_id, principal_kind, principal_id, role)
        values (gen_random_uuid(), ${spaceId}, 'account', ${w.carol}, 'reader')`);
      expect(await allowed(w.carol, "item.view", secret)).toBe(true);
      expect(await allowed(w.alice, "item.view", secret)).toBe(false);
      const access = await test.services.pageAccess.get(as(w.carol), secret);
      expect(access.shares).toEqual([]);
      expect(access.restrictions.holders).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "view", holder: expect.objectContaining({ id: w.carol }) }),
        ]),
      );
    });

    it("marks everyone named in a restriction without a role in the space in the report", async () => {
      const w = await world();
      const result = await imported(w);
      await test.services.imports.resolution.mapPeople(as(w.importer), result.id, [
        { placeholderId: await placeholder(result.id, BOB.accountId), accountId: w.bob },
        { placeholderId: await placeholder(result.id, CAROL.accountId), accountId: w.carol },
      ]);
      await test.services.imports.resolution.mapGroup(as(w.importer), result.id, "hr-team", {
        groupId: w.hr,
      });
      const { entries } = await test.services.imports.resolution.permissions(as(w.importer), result.id, {
        limit: 100,
      });
      const pageEntries = entries.filter((entry) => entry.scope === "page");
      const code = (predicate: (entry: (typeof pageEntries)[number]) => boolean) =>
        pageEntries.filter(predicate).map((entry) => entry.code);
      expect(code((entry) => entry.holder.id === w.carol)).toEqual(["withoutSpaceRole"]);
      expect(code((entry) => entry.holder.sourceName === "hr-team")).toEqual(["withoutSpaceRole"]);
      expect(code((entry) => entry.holder.id === w.bob)).not.toContain("withoutSpaceRole");
      expect(code((entry) => entry.holder.sourceName === "Editors")).not.toContain("withoutSpaceRole");
    });
  });

  describe("who may resolve", () => {
    it("lets a second organization administrator map people and groups after accepting", async () => {
      const w = await world();
      const result = await imported(w);
      const bob = await placeholder(result.id, BOB.accountId);
      await expect(
        test.services.imports.resolution.mapPeople(as(w.secondAdmin), result.id, [
          { placeholderId: bob, accountId: w.bob },
        ]),
      ).rejects.toMatchObject({ name: "ForbiddenError" });
      await accept(w, result.id);
      const view = await test.services.imports.get(as(w.secondAdmin), result.id);
      expect(view).toMatchObject({ canResolve: true, canManage: false });
      const people = await test.services.imports.resolution.people(as(w.secondAdmin), result.id, {
        offset: 0,
        limit: 50,
      });
      expect(people.people.map((entry) => entry.id)).toContain(bob);
      await test.services.imports.resolution.mapPeople(as(w.secondAdmin), result.id, [
        { placeholderId: bob, accountId: w.bob },
      ]);
      const merged = await test.database.execute<{ merged_into_id: string | null }>(
        sql`select merged_into_id from accounts where id = ${bob}`,
      );
      expect(merged.rows[0]?.merged_into_id).toBe(w.bob);
      const mapped = await test.services.imports.resolution.mapGroup(
        as(w.secondAdmin),
        result.id,
        "hr-team",
        {
          groupId: w.hr,
        },
      );
      expect(mapped.group?.id).toBe(w.hr);
      const list = ["User id,User name,email", `${CAROL.accountId},Carol,nobody@elsewhere.example`].join(
        "\n",
      );
      expect(
        await test.services.imports.resolution.uploadUserList(as(w.secondAdmin), result.id, list),
      ).toMatchObject({ matched: 0, named: 1 });
      const event = await test.database.execute<{ actor_id: string }>(sql`
        select actor_id from audit_events where name = 'import.placeholderMapped' and target_id = ${w.bob}`);
      expect(event.rows[0]?.actor_id).toBe(w.secondAdmin);
    });

    it("maps only to accounts that are still active members of the organization", async () => {
      const w = await world();
      const result = await imported(w);
      await accept(w, result.id);
      const bob = await placeholder(result.id, BOB.accountId);
      await test.database.execute(
        sql`update memberships set expires_at = now() - interval '1 minute' where account_id = ${w.bob}`,
      );
      await expect(
        test.services.imports.resolution.mapPeople(as(w.secondAdmin), result.id, [
          { placeholderId: bob, accountId: w.bob },
        ]),
      ).rejects.toMatchObject({ code: "invalidMappingTarget" });
      await test.database.execute(sql`update accounts set state = 'deactivated' where id = ${w.carol}`);
      await expect(
        test.services.imports.resolution.mapPeople(as(w.secondAdmin), result.id, [
          { placeholderId: bob, accountId: w.carol },
        ]),
      ).rejects.toMatchObject({ code: "invalidMappingTarget" });
    });
  });

  describe("every resolving path refuses callers and targets outside the organization", () => {
    async function unchanged(organizationId: string, importId: string, spaceId: string) {
      const result = await test.database.execute<Record<string, number>>(sql`
        select
          (select count(*) from import_items i join accounts a on a.id = i.target_id
            where i.import_id = ${importId} and i.kind = 'person' and a.merged_into_id is not null)::int as merged,
          (select count(*) from import_groups where import_id = ${importId} and group_id is not null)::int as groups,
          (select count(*) from page_restriction_holders h join tree_items t on t.id = h.item_id
            where t.space_id = ${spaceId})::int as holders,
          (select count(*) from space_permissions where space_id = ${spaceId})::int as roles,
          (select count(*) from groups where organization_id = ${organizationId} and name = 'hr-team')::int as created`);
      return result.rows[0];
    }

    it.each(["review", "accepted"] as const)(
      "refuses callers without the permission and of another organization while %s",
      async (state) => {
        const w = await world();
        const result = await imported(w);
        if (state === "accepted") await accept(w, result.id);
        const spaceId = result.quarantineSpace?.id ?? "";
        const before = await unchanged(w.organizationId, result.id, spaceId);
        const bob = await placeholder(result.id, BOB.accountId);
        const list = ["User id,User name,email", `${BOB.accountId},Bob,${"x"}@example.org`].join("\n");
        const resolution = test.services.imports.resolution;
        for (const caller of [w.member, w.reviewer, w.otherAdmin, w.foreigner]) {
          const actor = as(caller);
          await expect(
            resolution.mapPeople(actor, result.id, [{ placeholderId: bob, accountId: w.bob }]),
          ).rejects.toMatchObject({ name: "ForbiddenError" });
          await expect(resolution.uploadUserList(actor, result.id, list)).rejects.toMatchObject({
            name: "ForbiddenError",
          });
          await expect(
            resolution.mapGroup(actor, result.id, "hr-team", { groupId: w.hr }),
          ).rejects.toMatchObject({ name: "ForbiddenError" });
          await expect(
            resolution.mapGroup(actor, result.id, "hr-team", { create: true }),
          ).rejects.toMatchObject({ name: "ForbiddenError" });
          await expect(
            test.services.imports.accept(actor, result.id, { visibility: "private", grants: [] }),
          ).rejects.toThrow();
        }
        for (const caller of [w.member, w.otherAdmin, w.foreigner]) {
          const actor = as(caller);
          await expect(resolution.people(actor, result.id, { offset: 0, limit: 10 })).rejects.toThrow();
          await expect(resolution.groups(actor, result.id)).rejects.toThrow();
          await expect(resolution.permissions(actor, result.id, { limit: 10 })).rejects.toThrow();
          await expect(resolution.proposal(actor, result.id)).rejects.toThrow();
        }
        expect(await unchanged(w.organizationId, result.id, spaceId)).toEqual(before);
      },
    );

    it.each(["review", "accepted"] as const)(
      "refuses accounts, groups and placeholders of another organization while %s",
      async (state) => {
        const w = await world();
        const result = await imported(w);
        if (state === "accepted") await accept(w, result.id);
        const spaceId = result.quarantineSpace?.id ?? "";
        const before = await unchanged(w.organizationId, result.id, spaceId);
        const resolution = test.services.imports.resolution;
        const actor = as(state === "review" ? w.importer : w.secondAdmin);
        const bob = await placeholder(result.id, BOB.accountId);
        await expect(
          resolution.mapPeople(actor, result.id, [{ placeholderId: bob, accountId: w.foreigner }]),
        ).rejects.toMatchObject({ code: "invalidMappingTarget" });
        const foreignImport = await harness.imported(peopleExport(), {
          organizationId: w.otherOrganizationId,
          admin: w.otherAdmin,
          key: `F${randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()}`,
        });
        const foreignPlaceholder = await placeholder(foreignImport.id, BOB.accountId);
        await expect(
          resolution.mapPeople(actor, result.id, [{ placeholderId: foreignPlaceholder, accountId: w.bob }]),
        ).rejects.toMatchObject({ code: "notPlaceholder" });
        await expect(
          resolution.mapGroup(actor, result.id, "hr-team", { groupId: w.foreignGroup }),
        ).rejects.toMatchObject({ code: "groupNotFound" });
        const foreignEmail = await test.database.execute<{ email: string }>(
          sql`select email from accounts where id = ${w.foreigner}`,
        );
        const list = ["User id,User name,email", `${BOB.accountId},Bob,${foreignEmail.rows[0]?.email}`].join(
          "\n",
        );
        expect(await resolution.uploadUserList(actor, result.id, list)).toMatchObject({ matched: 0 });
        expect(await unchanged(w.organizationId, result.id, spaceId)).toEqual(before);
        const merged = await test.database.execute<{ merged_into_id: string | null }>(
          sql`select merged_into_id from accounts where id = ${foreignPlaceholder}`,
        );
        expect(merged.rows[0]?.merged_into_id).toBeNull();
        const created = await resolution.mapGroup(actor, result.id, "hr-team", { create: true });
        const group = await test.database.execute<{ organization_id: string }>(
          sql`select organization_id from groups where id = ${created.group?.id ?? ""}`,
        );
        expect(group.rows[0]?.organization_id).toBe(w.organizationId);
      },
    );

    it("never applies imported space roles to accounts or groups of another organization on accept", async () => {
      const w = await world();
      const result = await imported(w);
      const spaceId = result.quarantineSpace?.id ?? "";
      for (const grant of [
        { principalKind: "account" as const, principalId: w.foreigner, role: "reader" as const },
        { principalKind: "group" as const, principalId: w.foreignGroup, role: "reader" as const },
      ]) {
        await expect(
          test.services.imports.accept(as(w.importer), result.id, { visibility: "private", grants: [grant] }),
        ).rejects.toThrow();
      }
      const roles = await test.database.execute<{ principal_id: string | null }>(
        sql`select principal_id from space_permissions where space_id = ${spaceId}`,
      );
      expect(roles.rows.map((row) => row.principal_id)).not.toContain(w.foreigner);
      expect(roles.rows.map((row) => row.principal_id)).not.toContain(w.foreignGroup);
    });
  });
});
