import { uuidv7 } from "@pagehall/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDatabase, type Database } from "../database/database.js";
import { createDatabasePool, type DatabasePool } from "../database/pool.js";
import { runWithRequestContext } from "../observability/request-context.js";
import { AuditLog, type AuditScope } from "./audit-log.js";
import { auditCatalog } from "./catalog.js";
import { auditChains, auditEvents } from "./schema.js";

const databaseUrl = inject("databaseUrl");

describe("audit catalog", () => {
  it("never records secrets", () => {
    const forbidden = /password(?!Changed)|token|secret|code(?!s?Generated)|otp|hash/i;
    for (const [name, definition] of Object.entries(auditCatalog)) {
      for (const field of Object.keys(definition.fields.shape)) {
        expect(field, `${name}.${field}`).not.toMatch(forbidden);
      }
    }
  });

  it("names every event <area>.<pastTense> and allows at least one actor", () => {
    for (const [name, definition] of Object.entries(auditCatalog)) {
      expect(name).toMatch(/^[a-z][a-zA-Z]*\.[a-z][a-zA-Z]*$/);
      expect(definition.actor.length).toBeGreaterThan(0);
    }
  });
});

describe.skipIf(!databaseUrl)("AuditLog", () => {
  let pool: DatabasePool;
  let database: Database;
  let audit: AuditLog;

  beforeAll(() => {
    pool = createDatabasePool({ connectionString: databaseUrl, applicationName: "pagehall-test" });
    database = createDatabase(pool);
    audit = new AuditLog({ database });
  });

  afterAll(async () => {
    await pool?.end();
  });

  function newScope(): AuditScope {
    return { type: "organization", id: uuidv7() };
  }

  async function verifyScope(log: AuditLog, scope: AuditScope) {
    const result = (await log.verify()).find(
      (entry) => entry.scope.type === scope.type && entry.scope.id === scope.id,
    );
    if (!result) throw new Error("The scope has no chain");
    return result;
  }

  async function eventsOf(scope: AuditScope) {
    return database
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.scopeType, scope.type), eq(auditEvents.scopeId, scope.id)))
      .orderBy(asc(auditEvents.sequence));
  }

  /** Changes rows behind the append-only trigger, as someone with direct database access could. */
  async function tamper(statement: ReturnType<typeof sql>) {
    await database.transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(statement);
    });
  }

  function signIn(scope: AuditScope, accountId = uuidv7()) {
    return {
      name: "auth.signedIn" as const,
      actor: { type: "account" as const, id: accountId },
      targetId: accountId,
      fields: { sessionId: uuidv7(), methods: ["password" as const, "totp" as const] },
      scope,
    };
  }

  it("chains entries of a scope and records the request context", async () => {
    const scope = newScope();
    await runWithRequestContext(
      { requestId: "request-1", clientIp: "203.0.113.7", userAgent: "Agent\u0000/1.0" },
      () => audit.recordAlone(signIn(scope)),
    );
    await audit.recordAlone(signIn(scope));

    const [first, second] = await eventsOf(scope);
    expect(first).toMatchObject({
      sequence: 1,
      name: "auth.signedIn",
      actorType: "account",
      targetType: "account",
      requestId: "request-1",
      clientIp: "203.0.113.7",
      userAgent: "Agent/1.0",
    });
    expect(first?.previousHash.equals(Buffer.alloc(32))).toBe(true);
    expect(second?.previousHash.equals(first?.hash ?? Buffer.alloc(0))).toBe(true);
    expect(second?.requestId).toBeNull();
    expect(await verifyScope(audit, scope)).toMatchObject({ entries: 2, broken: null });
  });

  it("takes the actor from the request context and falls back to system", async () => {
    const scope = newScope();
    const accountId = uuidv7();
    await runWithRequestContext({ requestId: "r", actor: { type: "account", id: accountId } }, () =>
      audit.recordAlone({
        name: "account.passwordChanged",
        targetId: accountId,
        fields: { endedSessions: 1 },
        scope,
      }),
    );
    await audit.recordAlone({
      name: "account.passwordChanged",
      targetId: accountId,
      fields: { endedSessions: 0 },
      scope,
    });
    const [byAccount, bySystem] = await eventsOf(scope);
    expect(byAccount).toMatchObject({ actorType: "account", actorId: accountId });
    expect(bySystem).toMatchObject({ actorType: "system", actorId: null });
  });

  it("rejects fields outside the schema and actors the event does not allow", async () => {
    const scope = newScope();
    await expect(
      audit.recordAlone({
        name: "account.passwordChanged",
        targetId: null,
        // @ts-expect-error The field is not part of the event.
        fields: { endedSessions: 1, password: "secret" },
        scope,
      }),
    ).rejects.toThrow();
    await expect(audit.recordAlone({ ...signIn(scope), actor: { type: "system" } })).rejects.toThrow(
      "cannot be performed by system",
    );
    await expect(
      // @ts-expect-error Events outside the catalog do not compile.
      audit.recordAlone({ name: "auth.unknown", targetId: null, fields: {}, scope }),
    ).rejects.toThrow();
    expect(await eventsOf(scope)).toEqual([]);
  });

  it("writes the event in the transaction of the change", async () => {
    const scope = newScope();
    await expect(
      database.transaction(async (tx) => {
        await audit.record(tx, signIn(scope));
        throw new Error("the change failed");
      }),
    ).rejects.toThrow("the change failed");
    expect(await eventsOf(scope)).toEqual([]);
    await audit.recordAlone(signIn(scope));
    expect((await eventsOf(scope)).map((event) => event.sequence)).toEqual([1]);
  });

  it("keeps the chain intact under concurrent writes", async () => {
    const scope = newScope();
    await Promise.all(Array.from({ length: 25 }, () => audit.recordAlone(signIn(scope))));
    const events = await eventsOf(scope);
    expect(events.map((event) => event.sequence)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(await verifyScope(audit, scope)).toMatchObject({ entries: 25, broken: null });
  });

  it("reports no gap when entries are written while it runs", async () => {
    const scope = newScope();
    await database.transaction(async (tx) => {
      for (let i = 0; i < 2500; i++) await audit.record(tx, signIn(scope));
    });
    let writing = true;
    const writer = (async () => {
      while (writing) await audit.recordAlone(signIn(scope));
    })();
    try {
      for (let run = 0; run < 3; run++) {
        expect((await verifyScope(audit, scope)).broken).toBeNull();
      }
    } finally {
      writing = false;
      await writer;
    }
  });

  it("rejects updates, deletes and truncation in the database", async () => {
    const scope = newScope();
    await audit.recordAlone(signIn(scope));
    const ofScope = and(eq(auditEvents.scopeType, scope.type), eq(auditEvents.scopeId, scope.id));
    await expect(
      database.update(auditEvents).set({ name: "auth.changed" }).where(ofScope),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringContaining("append-only") }),
    });
    await expect(database.delete(auditEvents).where(ofScope)).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringContaining("append-only") }),
    });
    await expect(database.execute(sql`truncate audit_events`)).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringContaining("append-only") }),
    });
    await expect(
      database.transaction(async (tx) => {
        await tx.execute(sql`select set_config('pagehall.audit_retention', 'on', true)`);
        await tx.update(auditEvents).set({ name: "auth.changed" }).where(ofScope);
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringContaining("UPDATE") }),
    });
    expect(await eventsOf(scope)).toHaveLength(1);
  });

  it("reports the first entry whose content was changed", async () => {
    const scope = newScope();
    for (let i = 0; i < 4; i++) await audit.recordAlone(signIn(scope));
    const third = (await eventsOf(scope))[2];
    await tamper(
      sql`update audit_events set fields = '{"sessionId":"x","methods":["password"]}' where id = ${third?.id}`,
    );
    expect(await verifyScope(audit, scope)).toMatchObject({
      entries: 2,
      broken: { sequence: 3, id: third?.id, problem: "the content does not match its hash" },
    });
  });

  it("reports a removed entry and a removed last entry", async () => {
    const scope = newScope();
    for (let i = 0; i < 4; i++) await audit.recordAlone(signIn(scope));
    const ofScope = sql`scope_type = ${scope.type} and scope_id = ${scope.id}`;
    await tamper(sql`delete from audit_events where ${ofScope} and sequence = 4`);
    expect((await verifyScope(audit, scope)).broken).toMatchObject({
      sequence: 4,
      problem: "the entry is missing",
    });
    await tamper(sql`delete from audit_events where ${ofScope} and sequence = 2`);
    expect((await verifyScope(audit, scope)).broken).toMatchObject({
      sequence: 2,
      problem: "the entry is missing",
    });
  });

  it("reports a rewritten chain that no longer matches the head", async () => {
    const scope = newScope();
    for (let i = 0; i < 2; i++) await audit.recordAlone(signIn(scope));
    const [, last] = await eventsOf(scope);
    if (!last) throw new Error("missing entry");
    const forged = { ...last, fields: { sessionId: uuidv7(), methods: ["password"] } };
    const { hashAuditEntry } = await import("./audit-log.js");
    const hash = hashAuditEntry(forged);
    await tamper(
      sql`update audit_events set fields = ${JSON.stringify(forged.fields)}::jsonb, hash = ${hash} where id = ${last.id}`,
    );
    expect((await verifyScope(audit, scope)).broken).toMatchObject({
      sequence: 2,
      problem: "the chain head does not match the last entry",
    });
  });

  it("removes old entries and keeps an anchor so the rest still verifies", async () => {
    const scope = newScope();
    let now = new Date("2025-01-01T00:00:00Z");
    const clocked = new AuditLog({ database, clock: () => now });
    for (let i = 0; i < 3; i++) await clocked.recordAlone(signIn(scope));
    now = new Date("2026-06-01T00:00:00Z");
    for (let i = 0; i < 2; i++) await clocked.recordAlone(signIn(scope));
    const removedHash = (await eventsOf(scope))[2]?.hash;

    expect(await clocked.removeBefore(new Date("2026-01-01T00:00:00Z"), { scopes: [scope] })).toBe(3);
    expect((await eventsOf(scope)).map((event) => event.sequence)).toEqual([4, 5]);
    const [chain] = await database
      .select()
      .from(auditChains)
      .where(and(eq(auditChains.scopeType, scope.type), eq(auditChains.scopeId, scope.id)));
    expect(chain?.anchorSequence).toBe(3);
    expect(chain?.anchorHash?.equals(removedHash ?? Buffer.alloc(0))).toBe(true);
    expect(await verifyScope(clocked, scope)).toMatchObject({ entries: 2, broken: null });

    await clocked.recordAlone(signIn(scope));
    expect(await verifyScope(clocked, scope)).toMatchObject({ entries: 3, broken: null });
    expect(await clocked.removeBefore(new Date("2026-01-01T00:00:00Z"), { scopes: [scope] })).toBe(0);

    await tamper(sql`delete from audit_events where scope_id = ${scope.id} and sequence = 4`);
    expect((await verifyScope(clocked, scope)).broken).toMatchObject({ sequence: 4 });
  });

  it("removes everything when all entries expired and continues the chain afterwards", async () => {
    const scope = newScope();
    let now = new Date("2025-01-01T00:00:00Z");
    const clocked = new AuditLog({ database, clock: () => now });
    for (let i = 0; i < 2; i++) await clocked.recordAlone(signIn(scope));
    expect(await clocked.removeBefore(new Date("2026-01-01T00:00:00Z"), { scopes: [scope] })).toBe(2);
    expect(await verifyScope(clocked, scope)).toMatchObject({ entries: 0, broken: null });
    now = new Date("2026-06-01T00:00:00Z");
    await clocked.recordAlone(signIn(scope));
    expect((await eventsOf(scope)).map((event) => event.sequence)).toEqual([3]);
    expect(await verifyScope(clocked, scope)).toMatchObject({ entries: 1, broken: null });
  });
});
