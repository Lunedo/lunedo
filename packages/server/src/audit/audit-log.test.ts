import { randomBytes } from "node:crypto";
import { uuidv7 } from "@pagehall/shared";
import { and, asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { Encryption } from "../crypto/envelope.js";
import { formatKeyEntry, parseKeyRing } from "../crypto/key-ring.js";
import { createDatabase, type Database } from "../database/database.js";
import { createDatabasePool, type DatabasePool } from "../database/pool.js";
import { runWithRequestContext } from "../observability/request-context.js";
import { AuditLog, type AuditScope } from "./audit-log.js";
import { auditCatalog } from "./catalog.js";
import { AuditReader } from "./reader.js";
import { auditChains, auditEvents, auditSubjectKeys } from "./schema.js";

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
  let encryption: Encryption;

  beforeAll(() => {
    pool = createDatabasePool({ connectionString: databaseUrl, applicationName: "pagehall-test" });
    database = createDatabase(pool);
    const ring = parseKeyRing(formatKeyEntry(1, randomBytes(32)));
    encryption = new Encryption(() => ring);
    audit = new AuditLog({ database, encryption });
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
      clientIp: null,
      userAgent: null,
    });
    const [readable] = await (audit.sealer as NonNullable<typeof audit.sealer>).unseal(database, [
      { ...(first as NonNullable<typeof first>), formerSubjects: [] },
    ]);
    expect(readable).toMatchObject({ clientIp: "203.0.113.7", userAgent: "Agent/1.0" });
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

  it("records the names at the time of the event and protects them with the hash", async () => {
    const scope = newScope();
    const accountId = uuidv7();
    await pool.query(
      `insert into accounts (id, type, state, name, email) values ($1, 'standard', 'active', 'Olivia Owner', $2)`,
      [accountId, `${accountId}@example.org`],
    );
    await audit.recordAlone({
      name: "group.memberAdded",
      actor: { type: "account", id: accountId },
      targetId: uuidv7(),
      fields: { accountId, expiresAt: null },
      scope,
    });
    await pool.query("update accounts set name = 'Olivia Renamed' where id = $1", [accountId]);
    const [event] = await eventsOf(scope);
    expect(event?.labels).toBeNull();
    expect(JSON.stringify(event)).not.toContain("Olivia");
    const [readable] = await (audit.sealer as NonNullable<typeof audit.sealer>).unseal(database, [
      { ...(event as NonNullable<typeof event>), formerSubjects: [] },
    ]);
    expect(readable?.labels).toEqual({ actor: "Olivia Owner", references: { [accountId]: "Olivia Owner" } });
    expect(await verifyScope(audit, scope)).toMatchObject({ entries: 1, broken: null });

    await tamper(sql`update audit_events set labels = '{"actor":"Mallory"}' where id = ${event?.id}`);
    expect(await verifyScope(audit, scope)).toMatchObject({
      broken: { sequence: 1, problem: "the content does not match its hash" },
    });
  });

  it("keeps personal data readable only while the key of the account exists", async () => {
    const scope = newScope();
    const accountId = uuidv7();
    const email = `${accountId}@example.org`;
    await pool.query(
      `insert into accounts (id, type, state, name, email) values ($1, 'standard', 'active', 'Petra Personal', $2)`,
      [accountId, email],
    );
    await runWithRequestContext({ requestId: "r", clientIp: "198.51.100.23" }, async () => {
      await audit.recordAlone({
        name: "account.created",
        actor: { type: "account", id: accountId },
        targetId: accountId,
        fields: { type: "standard", email },
        scope,
      });
    });
    const raw = JSON.stringify(await eventsOf(scope));
    for (const value of ["Petra", email, "198.51.100.23"]) expect(raw).not.toContain(value);

    const reader = new AuditReader({
      database,
      audit,
      authorization: { authorize: async () => true } as never,
    });
    const before = await reader.list({ type: "system" }, { scope });
    expect(before.items[0]).toMatchObject({
      fields: { type: "standard", email },
      labels: { actor: "Petra Personal", target: "Petra Personal" },
      clientIp: "198.51.100.23",
      formerSubjects: [],
    });

    await database.transaction(async (tx) =>
      (audit.sealer as NonNullable<typeof audit.sealer>).destroy(tx, accountId),
    );
    const keys = await database
      .select()
      .from(auditSubjectKeys)
      .where(eq(auditSubjectKeys.subjectId, accountId));
    expect(keys).toEqual([]);
    const after = await reader.list({ type: "system" }, { scope });
    expect(after.items[0]).toMatchObject({
      fields: { type: "standard" },
      labels: null,
      clientIp: null,
      formerSubjects: [accountId],
    });
    expect(JSON.stringify(after.items[0])).not.toContain(email);
    expect(await verifyScope(audit, scope)).toMatchObject({ entries: 1, broken: null });
  });

  it("detects a sealed part moved to another event", async () => {
    const scope = newScope();
    const accountId = uuidv7();
    await pool.query(
      `insert into accounts (id, type, state, name, email) values ($1, 'standard', 'active', 'Moved Person', $2)`,
      [accountId, `${accountId}@example.org`],
    );
    for (let i = 0; i < 2; i++) {
      await audit.recordAlone({
        name: "account.passwordChanged",
        actor: { type: "account", id: accountId },
        targetId: accountId,
        fields: { endedSessions: i },
        scope,
      });
    }
    const [first, second] = await eventsOf(scope);
    const [moved] = await (audit.sealer as NonNullable<typeof audit.sealer>).unseal(database, [
      { ...(second as NonNullable<typeof second>), sealed: first?.sealed, formerSubjects: [] },
    ]);
    expect(moved?.formerSubjects).toEqual([accountId]);
    expect(moved?.labels).toBeNull();
  });

  it("refuses to store personal data without encryption", async () => {
    const scope = newScope();
    const accountId = uuidv7();
    await pool.query(
      `insert into accounts (id, type, state, name, email) values ($1, 'standard', 'active', 'Plain Person', $2)`,
      [accountId, `${accountId}@example.org`],
    );
    const plain = new AuditLog({ database });
    await expect(plain.recordAlone(signIn(scope, accountId))).rejects.toThrow("need encryption");
    await plain.recordAlone({
      name: "account.passwordChanged",
      targetId: uuidv7(),
      fields: { endedSessions: 0 },
      scope,
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
    const clocked = new AuditLog({ database, clock: () => now, encryption });
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
    const clocked = new AuditLog({ database, clock: () => now, encryption });
    for (let i = 0; i < 2; i++) await clocked.recordAlone(signIn(scope));
    expect(await clocked.removeBefore(new Date("2026-01-01T00:00:00Z"), { scopes: [scope] })).toBe(2);
    expect(await verifyScope(clocked, scope)).toMatchObject({ entries: 0, broken: null });
    now = new Date("2026-06-01T00:00:00Z");
    await clocked.recordAlone(signIn(scope));
    expect((await eventsOf(scope)).map((event) => event.sequence)).toEqual([3]);
    expect(await verifyScope(clocked, scope)).toMatchObject({ entries: 1, broken: null });
  });
});
