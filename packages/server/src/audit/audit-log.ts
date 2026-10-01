import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import type { z } from "zod";
import { type Principal, SYSTEM } from "../accounts/principal.js";
import type { Database, Transaction } from "../database/database.js";
import { currentRequestContext } from "../observability/request-context.js";
import { INSTANCE_SCOPE_ID, type SettingChangeHandler } from "../settings/service.js";
import { type AuditEventFields, type AuditEventName, auditCatalog } from "./catalog.js";
import { auditChains, auditEvents } from "./schema.js";

export interface AuditScope {
  type: "instance" | "organization";
  id: string;
}

export const INSTANCE_AUDIT_SCOPE: AuditScope = { type: "instance", id: INSTANCE_SCOPE_ID };

export type AuditEvents = AuditEventInput<AuditEventName>[];

export interface AuditEventInput<TName extends AuditEventName> {
  name: TName;
  actor?: Principal;
  targetId: string | null;
  fields: AuditEventFields<TName>;
  scope?: AuditScope;
}

const GENESIS_HASH = Buffer.alloc(32);
const USER_AGENT_MAX_LENGTH = 512;
const VERIFY_BATCH = 1000;
const RETENTION_BATCH = 5000;

interface HashedContent {
  scopeType: string;
  scopeId: string;
  sequence: number;
  name: string;
  actorType: string;
  actorId: string | null;
  targetType: string;
  targetId: string | null;
  fields: unknown;
  occurredAt: Date;
  requestId: string | null;
  clientIp: string | null;
  userAgent: string | null;
  previousHash: Buffer;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function hashAuditEntry(entry: HashedContent): Buffer {
  const content = canonicalJson([
    1,
    entry.scopeType,
    entry.scopeId,
    entry.sequence,
    entry.name,
    entry.actorType,
    entry.actorId,
    entry.targetType,
    entry.targetId,
    entry.fields,
    entry.occurredAt.toISOString(),
    entry.requestId,
    entry.clientIp,
    entry.userAgent,
    entry.previousHash.toString("hex"),
  ]);
  return createHash("sha256").update(content, "utf8").digest();
}

function storable(value: string | undefined, maxLength = Number.POSITIVE_INFINITY): string | null {
  if (value === undefined) return null;
  return value.replaceAll("\u0000", "").slice(0, maxLength);
}

export interface AuditVerification {
  scope: AuditScope;
  entries: number;
  broken: { sequence: number; id: string | null; problem: string } | null;
}

export class AuditLog {
  readonly #database: Database;
  readonly #clock: () => Date;

  constructor(options: { database: Database; clock?: () => Date }) {
    this.#database = options.database;
    this.#clock = options.clock ?? (() => new Date());
  }

  async record<TName extends AuditEventName>(tx: Transaction, input: AuditEventInput<TName>): Promise<void> {
    const definition = auditCatalog[input.name];
    const fields: unknown = definition.fields.strict().parse(input.fields);
    const context = currentRequestContext();
    const actor = input.actor ?? context?.actor ?? SYSTEM;
    if (!(definition.actor as readonly string[]).includes(actor.type)) {
      throw new Error(`Audit event ${input.name} cannot be performed by ${actor.type}`);
    }
    const scope = input.scope ?? INSTANCE_AUDIT_SCOPE;
    const chain = and(eq(auditChains.scopeType, scope.type), eq(auditChains.scopeId, scope.id));

    await tx.insert(auditChains).values({ scopeType: scope.type, scopeId: scope.id }).onConflictDoNothing();
    const [head] = await tx
      .select({ lastSequence: auditChains.lastSequence, lastHash: auditChains.lastHash })
      .from(auditChains)
      .where(chain)
      .for("update");
    if (!head) throw new Error("The audit chain head is missing");

    const content: HashedContent = {
      scopeType: scope.type,
      scopeId: scope.id,
      sequence: head.lastSequence + 1,
      name: input.name,
      actorType: actor.type,
      actorId: actor.type === "account" ? actor.id : null,
      targetType: definition.target,
      targetId: input.targetId,
      fields,
      occurredAt: this.#clock(),
      requestId: storable(context?.requestId),
      clientIp: storable(context?.clientIp),
      userAgent: storable(context?.userAgent, USER_AGENT_MAX_LENGTH),
      previousHash: head.lastHash ?? GENESIS_HASH,
    };
    const hash = hashAuditEntry(content);
    await tx.insert(auditEvents).values({
      ...content,
      scopeType: scope.type,
      actorType: actor.type,
      hash,
    });
    await tx
      .update(auditChains)
      .set({ lastSequence: content.sequence, lastHash: hash, updatedAt: new Date() })
      .where(chain);
  }

  async recordMany(tx: Transaction, inputs: AuditEventInput<AuditEventName>[]): Promise<void> {
    const key = (input: AuditEventInput<AuditEventName>) => {
      const scope = input.scope ?? INSTANCE_AUDIT_SCOPE;
      return `${scope.type}:${scope.id}`;
    };
    const ordered = inputs
      .map((input, index) => ({ input, index }))
      .sort((a, b) =>
        key(a.input) === key(b.input) ? a.index - b.index : key(a.input) < key(b.input) ? -1 : 1,
      );
    for (const { input } of ordered) await this.record(tx, input);
  }

  async recordAlone<TName extends AuditEventName>(input: AuditEventInput<TName>): Promise<void> {
    await this.#database.transaction((tx) => this.record(tx, input));
  }

  async removeBefore(before: Date, options: { scopes?: AuditScope[] } = {}): Promise<number> {
    const chains =
      options.scopes?.map((scope) => ({ scopeType: scope.type, scopeId: scope.id })) ??
      (await this.#database
        .select({ scopeType: auditChains.scopeType, scopeId: auditChains.scopeId })
        .from(auditChains));
    let removed = 0;
    for (const { scopeType, scopeId } of chains) {
      const chain = and(eq(auditChains.scopeType, scopeType), eq(auditChains.scopeId, scopeId));
      const ofScope = and(eq(auditEvents.scopeType, scopeType), eq(auditEvents.scopeId, scopeId));
      for (;;) {
        const count = await this.#database.transaction(async (tx) => {
          await tx.select({ scopeId: auditChains.scopeId }).from(auditChains).where(chain).for("update");
          const expired = await tx
            .select({ sequence: auditEvents.sequence, hash: auditEvents.hash })
            .from(auditEvents)
            .where(and(ofScope, lt(auditEvents.occurredAt, before)))
            .orderBy(asc(auditEvents.sequence))
            .limit(RETENTION_BATCH);
          const last = expired.at(-1);
          if (!last) return 0;
          await tx.execute(sql`select set_config('pagehall.audit_retention', 'on', true)`);
          const deleted = await tx
            .delete(auditEvents)
            .where(and(ofScope, lte(auditEvents.sequence, last.sequence)));
          await tx
            .update(auditChains)
            .set({ anchorSequence: last.sequence, anchorHash: last.hash, updatedAt: new Date() })
            .where(chain);
          return deleted.rowCount ?? 0;
        });
        removed += count;
        if (count < RETENTION_BATCH) break;
      }
    }
    return removed;
  }

  async verify(): Promise<AuditVerification[]> {
    return this.#database.transaction(
      async (tx) => {
        const chains = await tx.select().from(auditChains).orderBy(auditChains.scopeType);
        const results: AuditVerification[] = [];
        for (const chain of chains) results.push(await this.#verifyChain(tx, chain));
        return results;
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }

  async #verifyChain(tx: Transaction, chain: typeof auditChains.$inferSelect): Promise<AuditVerification> {
    const scope: AuditScope = { type: chain.scopeType, id: chain.scopeId };
    const ofScope = and(eq(auditEvents.scopeType, chain.scopeType), eq(auditEvents.scopeId, chain.scopeId));
    let expectedSequence = (chain.anchorSequence ?? 0) + 1;
    let previousHash = chain.anchorHash ?? GENESIS_HASH;
    let entries = 0;
    const broken = (sequence: number, id: string | null, problem: string): AuditVerification => ({
      scope,
      entries,
      broken: { sequence, id, problem },
    });

    const [before] = await tx
      .select({ sequence: auditEvents.sequence })
      .from(auditEvents)
      .where(and(ofScope, lt(auditEvents.sequence, expectedSequence)))
      .orderBy(desc(auditEvents.sequence))
      .limit(1);
    if (before) return broken(before.sequence, null, "an entry exists before the retention anchor");

    for (;;) {
      const rows = await tx
        .select()
        .from(auditEvents)
        .where(and(ofScope, gte(auditEvents.sequence, expectedSequence)))
        .orderBy(asc(auditEvents.sequence))
        .limit(VERIFY_BATCH);
      for (const row of rows) {
        if (row.sequence !== expectedSequence) {
          return broken(expectedSequence, null, "the entry is missing");
        }
        if (!row.previousHash.equals(previousHash)) {
          return broken(row.sequence, row.id, "the previous hash does not match the previous entry");
        }
        if (!hashAuditEntry(row).equals(row.hash)) {
          return broken(row.sequence, row.id, "the content does not match its hash");
        }
        previousHash = row.hash;
        expectedSequence += 1;
        entries += 1;
      }
      if (rows.length < VERIFY_BATCH) break;
    }

    if (expectedSequence - 1 < chain.lastSequence) {
      return broken(expectedSequence, null, "the entry is missing");
    }
    if (expectedSequence - 1 > chain.lastSequence) {
      return broken(chain.lastSequence + 1, null, "the entry is not part of the chain head");
    }
    if (
      chain.lastSequence > (chain.anchorSequence ?? 0) &&
      !(chain.lastHash ?? GENESIS_HASH).equals(previousHash)
    ) {
      return broken(chain.lastSequence, null, "the chain head does not match the last entry");
    }
    return { scope, entries, broken: null };
  }
}

export function auditSettingChanges(audit: AuditLog): SettingChangeHandler {
  return (tx, change) =>
    audit.record(tx, {
      name: "settings.changed",
      targetId: change.key,
      ...(change.scope.level === "organization"
        ? { scope: { type: "organization" as const, id: change.scope.id } }
        : {}),
      fields: {
        level: change.scope.level,
        scopeId: change.scope.id,
        action: change.action,
        ...(change.action === "set" ? { value: change.value as z.core.util.JSONType } : {}),
      },
    });
}
