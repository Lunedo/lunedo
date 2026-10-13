import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountPrincipal, SYSTEM } from "../accounts/principal.js";
import { ForbiddenError } from "../authorization/service.js";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import type { AuditEntry } from "./reader.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("audit reader", () => {
  let test: TestServices;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    await test.pool.query("insert into instance (id, setup_completed_at) values (1, now())");
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

  async function organization() {
    const owner = await standard(null);
    const created = await test.services.organizations.createAsActor(SYSTEM, {
      name: `Organization ${randomUUID().slice(0, 8)}`,
      ownerAccountId: owner,
    });
    return { id: created.id, owner };
  }

  async function collect(iterable: AsyncIterable<AuditEntry>): Promise<AuditEntry[]> {
    const entries: AuditEntry[] = [];
    for await (const entry of iterable) entries.push(entry);
    return entries;
  }

  it("filters by scope, actor, target, name and time range", async () => {
    const org = await organization();
    const scope = { type: "organization" as const, id: org.id };
    const actor = accountPrincipal(org.owner);
    const group = await test.services.groups.create(actor, org.id, { name: "Writers" });
    await test.services.groups.update(actor, group.id, { name: "Editors" });
    const all = await test.services.auditReader.list(actor, { scope });
    expect(all.items.every((entry) => entry.scopeId === org.id)).toBe(true);
    const byName = await test.services.auditReader.list(actor, { scope, name: "group.updated" });
    expect(byName.items.map((entry) => entry.targetId)).toEqual([group.id]);
    const byTarget = await test.services.auditReader.list(actor, {
      scope,
      targetType: "group",
      targetId: group.id,
    });
    const names = byTarget.items.map((entry) => entry.name);
    expect(names[0]).toBe("group.updated");
    expect(names.at(-1)).toBe("group.created");
    expect(byTarget.items.every((entry) => entry.targetId === group.id)).toBe(true);
    const byActor = await test.services.auditReader.list(actor, { scope, actorId: org.owner });
    expect(byActor.items.length).toBeGreaterThanOrEqual(2);
    expect(byActor.items.every((entry) => entry.actorId === org.owner)).toBe(true);
    const future = await test.services.auditReader.list(actor, {
      scope,
      from: new Date(Date.now() + 60_000),
    });
    expect(future.items).toEqual([]);
    const past = await test.services.auditReader.list(actor, { scope, to: new Date(Date.now() - 3_600_000) });
    expect(past.items).toEqual([]);
  });

  it("pages with a cursor without gaps or duplicates", async () => {
    const org = await organization();
    const actor = accountPrincipal(org.owner);
    for (let index = 0; index < 7; index += 1) {
      await test.services.groups.create(actor, org.id, { name: `Group ${index}` });
    }
    const scope = { type: "organization" as const, id: org.id };
    const expected = (await test.services.auditReader.list(actor, { scope }, { limit: 1000 })).items;
    const seen: string[] = [];
    let cursor: Parameters<typeof test.services.auditReader.list>[2] = { limit: 3 };
    for (;;) {
      const page = await test.services.auditReader.list(actor, { scope }, cursor);
      seen.push(...page.items.map((entry) => entry.id));
      if (!page.next) break;
      cursor = { limit: 3, cursor: page.next };
    }
    expect(seen).toEqual(expected.map((entry) => entry.id));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("gives organization administrators their organization and auditors everything", async () => {
    const first = await organization();
    const second = await organization();
    const admin = accountPrincipal(first.owner);
    await expect(
      test.services.auditReader.list(admin, { scope: { type: "organization", id: second.id } }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(test.services.auditReader.list(admin, {})).rejects.toBeInstanceOf(ForbiddenError);
    const member = await standard(first.id);
    await expect(
      test.services.auditReader.list(accountPrincipal(member), {
        scope: { type: "organization", id: first.id },
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    const auditorRole = await test.services.roles.createCustom(SYSTEM, "organization", first.id, {
      name: "Auditor",
      areas: { auditLog: "view" },
    });
    await test.services.roles.assign(SYSTEM, {
      scope: "organization",
      organizationId: first.id,
      role: { customRoleId: auditorRole.id },
      principal: { kind: "account", id: member },
    });
    const own = await test.services.auditReader.list(accountPrincipal(member), {
      scope: { type: "organization", id: first.id },
    });
    expect(own.items.length).toBeGreaterThan(0);

    const auditor = await standard(null);
    await test.services.roles.assign(SYSTEM, {
      scope: "instance",
      organizationId: null,
      role: { builtIn: "securityAuditor" },
      principal: { kind: "account", id: auditor },
    });
    const everything = await test.services.auditReader.list(accountPrincipal(auditor), {}, { limit: 1000 });
    const scopes = new Set(everything.items.map((entry) => entry.scopeId));
    expect(scopes.has(first.id) && scopes.has(second.id)).toBe(true);
  });

  it("streams exports in batches and audits them", async () => {
    const org = await organization();
    const actor = accountPrincipal(org.owner);
    const scope = { type: "organization" as const, id: org.id };
    await test.database.transaction(async (tx) => {
      const head = await tx.execute<{ last: number }>(sql`
        select last_sequence::int as last from audit_chains
        where scope_type = 'organization' and scope_id = ${org.id} for update`);
      const start = head.rows[0]?.last ?? 0;
      await tx.execute(sql`
        insert into audit_events (id, scope_type, scope_id, sequence, name, actor_type, actor_id,
          target_type, target_id, fields, occurred_at, previous_hash, hash)
        select gen_random_uuid(), 'organization', ${org.id}, ${start} + n, 'group.created', 'account',
          ${org.owner}, 'group', gen_random_uuid()::text, jsonb_build_object('name', 'Group ' || n),
          date_trunc('milliseconds', now()),
          decode(md5(n::text), 'hex'), decode(md5(n::text), 'hex')
        from generate_series(1, 1203) as n`);
      await tx.execute(sql`
        update audit_chains set last_sequence = ${start} + 1203
        where scope_type = 'organization' and scope_id = ${org.id}`);
    });
    const exported = await collect(
      await test.services.auditReader.export(actor, { scope, name: "group.created" }),
    );
    expect(exported).toHaveLength(1203);
    expect(new Set(exported.map((entry) => entry.id)).size).toBe(1203);
    const audited = await test.services.auditReader.list(actor, { scope, name: "audit.exported" });
    expect(audited.items).toHaveLength(1);
    expect(audited.items[0]?.fields).toMatchObject({
      scopeType: "organization",
      scopeId: org.id,
      name: "group.created",
    });
    await expect(
      test.services.auditReader.export(accountPrincipal(await standard(org.id)), { scope }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
