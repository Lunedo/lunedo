import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { spaceFixtures } from "../testing/spaces.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("self-addition to a group", () => {
  let test: TestServices;
  const { organization, member } = spaceFixtures(() => test);

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
  });

  afterAll(async () => {
    await test?.close();
  });

  async function allowed(accountId: string, action: string, id: string): Promise<boolean> {
    const type = action.startsWith("space.") ? "space" : "item";
    return (
      await test.services.authorization.explain(
        accountPrincipal(accountId),
        action,
        { type, id },
        { fresh: true },
      )
    ).allowed;
  }

  async function events(name: string, targetId: string) {
    const result = await test.database.execute<{ actor_id: string | null; fields: Record<string, unknown> }>(
      sql`select actor_id, fields from audit_events where name = ${name} and target_id = ${targetId}`,
    );
    return result.rows;
  }

  async function administrator(organizationId: string): Promise<string> {
    const id = await member(organizationId);
    await test.services.roles.assign(SYSTEM, {
      scope: "organization",
      organizationId,
      role: { builtIn: "administrator" },
      principal: { kind: "account", id },
    });
    return id;
  }

  it("is allowed for a group manager and recorded as its own event", async () => {
    const org = await organization();
    const carol = await member(org.id);
    const group = await test.services.groups.create(SYSTEM, org.id, { name: `Payroll ${randomUUID()}` });
    await test.services.groups.addManager(SYSTEM, group.id, carol);
    await test.services.groups.addMember(accountPrincipal(carol), group.id, carol);
    expect(await events("group.selfAdded", group.id)).toEqual([
      { actor_id: carol, fields: { accountId: carol, source: "member", importId: null, expiresAt: null } },
    ]);
    expect(await events("group.memberAdded", group.id)).toEqual([]);
  });

  it("is allowed for an organization administrator and recorded as its own event", async () => {
    const org = await organization();
    const admin = await administrator(org.id);
    const group = await test.services.groups.create(SYSTEM, org.id, { name: `Board ${randomUUID()}` });
    const expiresAt = new Date(Date.now() + 86_400_000);
    await test.services.groups.addMember(accountPrincipal(admin), group.id, admin, expiresAt);
    expect(await events("group.selfAdded", group.id)).toEqual([
      {
        actor_id: admin,
        fields: { accountId: admin, source: "member", importId: null, expiresAt: expiresAt.toISOString() },
      },
    ]);
  });

  it("stays an ordinary member addition when a manager adds someone else", async () => {
    const org = await organization();
    const carol = await member(org.id);
    const dave = await member(org.id);
    const group = await test.services.groups.create(SYSTEM, org.id, { name: `Sales ${randomUUID()}` });
    await test.services.groups.addManager(SYSTEM, group.id, carol);
    await test.services.groups.addMember(accountPrincipal(carol), group.id, dave);
    expect(await events("group.selfAdded", group.id)).toEqual([]);
    expect((await events("group.memberAdded", group.id)).map((row) => row.fields.accountId)).toEqual([dave]);
  });

  it("gives no access to a confidential space, which never holds groups", async () => {
    const org = await organization();
    const admin = await administrator(org.id);
    const owner = await member(org.id);
    const council = await test.services.spaces.create(
      accountPrincipal(owner),
      org.id,
      {
        name: `Council ${randomUUID().slice(0, 6)}`,
        key: `C${randomUUID().replace(/-/g, "").slice(0, 7).toUpperCase()}`,
        visibility: "private",
        confidential: true,
        grants: [],
      },
      test.services.spacePermissions.holders,
    );
    const minutes = await test.services.tree.create(accountPrincipal(owner), council.id, {
      kind: "page",
      title: "Minutes",
      mode: "live",
      placement: { parentId: null },
    });
    const group = await test.services.groups.create(SYSTEM, org.id, { name: `Council ${randomUUID()}` });
    await expect(
      test.services.spacePermissions.apply(accountPrincipal(owner), council.id, {
        action: "grant",
        principalKind: "group",
        principalId: group.id,
        role: "reader",
      }),
    ).rejects.toMatchObject({ code: "invalidHolder" });
    await test.services.groups.addMember(accountPrincipal(admin), group.id, admin);
    expect(await allowed(admin, "space.view", council.id)).toBe(false);
    expect(await allowed(admin, "item.view", minutes.id)).toBe(false);
  });
});
