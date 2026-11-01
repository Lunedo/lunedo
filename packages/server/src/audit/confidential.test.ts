import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";
import type { AuditEntry } from "./reader.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("audit entries about confidential spaces", () => {
  let test: TestServices;
  const { organization, member, space } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function auditor(organizationId: string, accountId: string) {
    const role = await test.services.roles.createCustom(SYSTEM, "organization", organizationId, {
      name: `Auditor ${randomUUID().slice(0, 6)}`,
      areas: { auditLog: "view" },
    });
    await test.services.roles.assign(SYSTEM, {
      scope: "organization",
      organizationId,
      role: { customRoleId: role.id },
      principal: { kind: "account", id: accountId },
    });
  }

  async function setup() {
    const org = await organization();
    const alice = await member(org.id, "member", `Alice ${randomUUID().slice(0, 6)}`);
    const bob = await member(org.id, "member", `Bob ${randomUUID().slice(0, 6)}`);
    const carol = await member(org.id, "member", `Carol ${randomUUID().slice(0, 6)}`);
    const council = await test.services.spaces.create(
      accountPrincipal(alice),
      org.id,
      {
        name: `Council ${randomUUID().slice(0, 6)}`,
        key: `C${randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`,
        visibility: "private",
        confidential: true,
        grants: [{ principalKind: "account", principalId: bob, role: "editor" }],
      },
      test.services.spacePermissions.holders,
    );
    const page = await test.services.tree.create(accountPrincipal(alice), council.id, {
      kind: "page",
      title: "Notes",
      mode: "live",
      placement: { parentId: null },
    });
    await test.services.pageAccess.change(accountPrincipal(alice), page.id, [
      { action: "share", holderKind: "account", holderId: carol, role: "reader" },
    ]);
    const open = await space(org.id, alice);
    const scope = { type: "organization" as const, id: org.id };
    const people = [alice, bob, carol];
    const names = (
      await test.database.execute<{ name: string }>(
        sql`select name from accounts where id = any(${sql.param(people)}::uuid[])`,
      )
    ).rows.map((row) => row.name);
    return { org, alice, bob, carol, council, page, open, scope, people: [...people, ...names] };
  }

  function aboutCouncil(entries: AuditEntry[], councilId: string, pageId: string): AuditEntry[] {
    return entries.filter((entry) => {
      const fields = entry.fields as Record<string, unknown>;
      return (
        entry.targetId === councilId ||
        entry.targetId === pageId ||
        fields.spaceId === councilId ||
        fields.itemId === pageId
      );
    });
  }

  function grants(entry: AuditEntry, principalId: string): boolean {
    return (
      entry.name === "space.permissionGranted" &&
      (entry.fields as Record<string, unknown>).principalId === principalId
    );
  }

  function expectNoPeople(entries: AuditEntry[], people: string[]) {
    const text = JSON.stringify(entries);
    for (const person of people) expect(text).not.toContain(person);
  }

  async function collect(iterable: AsyncIterable<AuditEntry>): Promise<AuditEntry[]> {
    const entries: AuditEntry[] = [];
    for await (const entry of iterable) entries.push(entry);
    return entries;
  }

  it("shows organization administrators the events without the people involved", async () => {
    const { org, council, page, open, scope, people, alice } = await setup();
    const admin = accountPrincipal(org.owner);
    const { items } = await test.services.auditReader.list(admin, { scope }, { limit: 1000 });
    const confidential = aboutCouncil(items, council.id, page.id);
    expect(confidential.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(["space.created", "space.permissionGranted", "page.shared"]),
    );
    for (const entry of confidential) {
      expect(entry.peopleHidden).toBe(true);
      expect(entry.actorId).toBeNull();
      expect(entry.formerSubjects).toEqual([]);
    }
    expectNoPeople(confidential, people);
    const other = items.find((entry) => entry.name === "space.created" && entry.targetId === open.id);
    expect(other).toMatchObject({ actorId: alice, peopleHidden: false });
  });

  it("does not reveal confidential events through a filter by person", async () => {
    const { org, council, page, open, scope, alice } = await setup();
    const admin = accountPrincipal(org.owner);
    const { items } = await test.services.auditReader.list(admin, { scope, actorId: alice }, { limit: 1000 });
    expect(items.some((entry) => entry.targetId === open.id)).toBe(true);
    expect(aboutCouncil(items, council.id, page.id)).toEqual([]);
  });

  it("leaves the people out of the organization export", async () => {
    const { org, council, page, scope, people, alice } = await setup();
    const admin = accountPrincipal(org.owner);
    const exported = await collect(await test.services.auditReader.export(admin, { scope }));
    const confidential = aboutCouncil(exported, council.id, page.id);
    expect(confidential.length).toBeGreaterThanOrEqual(3);
    expectNoPeople(confidential, people);
    const byPerson = await collect(await test.services.auditReader.export(admin, { scope, actorId: alice }));
    expect(aboutCouncil(byPerson, council.id, page.id)).toEqual([]);
  });

  it("shows members of the space the full entry", async () => {
    const { org, council, page, scope, alice, bob, carol } = await setup();
    await auditor(org.id, bob);
    await auditor(org.id, carol);
    const forBob = await test.services.auditReader.list(accountPrincipal(bob), { scope }, { limit: 1000 });
    const full = aboutCouncil(forBob.items, council.id, page.id);
    expect(full.every((entry) => !entry.peopleHidden)).toBe(true);
    expect(full.find((entry) => entry.name === "space.created")?.actorId).toBe(alice);
    expect(full.some((entry) => grants(entry, bob))).toBe(true);
    const byAlice = await test.services.auditReader.list(
      accountPrincipal(bob),
      { scope, actorId: alice },
      { limit: 1000 },
    );
    expect(aboutCouncil(byAlice.items, council.id, page.id).length).toBeGreaterThan(0);

    const forCarol = await test.services.auditReader.list(
      accountPrincipal(carol),
      { scope },
      { limit: 1000 },
    );
    const hidden = aboutCouncil(forCarol.items, council.id, page.id);
    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden.every((entry) => entry.peopleHidden && entry.actorId === null)).toBe(true);
  });

  it("keeps the full entry in the instance audit", async () => {
    const { council, page, alice, bob } = await setup();
    const instanceAuditor = await member((await organization()).id);
    await test.services.roles.assign(SYSTEM, {
      scope: "instance",
      organizationId: null,
      role: { builtIn: "securityAuditor" },
      principal: { kind: "account", id: instanceAuditor },
    });
    const viewer = accountPrincipal(instanceAuditor);
    const { items } = await test.services.auditReader.list(viewer, { targetId: council.id });
    const created = items.find((entry) => entry.name === "space.created");
    expect(created).toMatchObject({ actorId: alice, peopleHidden: false });
    expect(created?.labels).toMatchObject({ actor: expect.any(String) });
    const exported = await collect(await test.services.auditReader.export(viewer, { actorId: alice }));
    expect(aboutCouncil(exported, council.id, page.id).length).toBeGreaterThan(0);
    expect(items.some((entry) => grants(entry, bob))).toBe(true);
  });

  it("keeps hiding the people after the space was deleted", async () => {
    const { org, council, scope, alice, bob, people } = await setup();
    for (const id of [alice, bob]) {
      await test.services.memberships.deactivate(accountPrincipal(org.owner), id);
    }
    await test.database.execute(
      sql`update spaces set orphaned_at = now() - interval '31 days' where id = ${council.id}`,
    );
    await test.services.spaceCleanup.delete(accountPrincipal(org.owner), org.id, council.id, {
      confirmation: council.key,
      reason: "No active member remains",
    });
    await test.services.audit.recordAlone({
      name: "space.permissionRemoved",
      actor: accountPrincipal(org.owner),
      targetId: council.id,
      fields: { name: "", principalKind: "account", principalId: bob, role: "editor" },
      scope,
    });
    const { items } = await test.services.auditReader.list(accountPrincipal(org.owner), {
      scope,
      targetId: council.id,
    });
    expect(items.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(["space.permissionRemoved", "space.cleanupDeleted"]),
    );
    expect(items.every((entry) => entry.peopleHidden)).toBe(true);
    expectNoPeople(items, people);
  });
});
