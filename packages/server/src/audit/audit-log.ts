import { createHash } from "node:crypto";
import { isUuid } from "@lunedo/shared";
import { and, asc, desc, eq, gte, lt, lte, sql } from "drizzle-orm";
import type { z } from "zod";
import { type Principal, SYSTEM } from "../accounts/principal.js";
import type { Encryption } from "../crypto/envelope.js";
import type { Database, Transaction } from "../database/database.js";
import { currentRequestContext } from "../observability/request-context.js";
import { INSTANCE_SCOPE_ID, type SettingChangeHandler } from "../settings/service.js";
import {
  type AuditEventDefinition,
  type AuditEventFields,
  type AuditEventName,
  type AuditTargetType,
  auditCatalog,
  auditTargetTypes,
} from "./catalog.js";
import { type AuditLabelCache, type AuditLabels, preloadAuditTargets, resolveAuditLabels } from "./labels.js";
import { AuditSealer, PersonalDataMissingKeyError, type SealedParts } from "./personal-data.js";
import { auditChains, auditConfidentialEvents, auditEvents } from "./schema.js";

export interface AuditScope {
  type: "instance" | "organization";
  id: string;
}

export const INSTANCE_AUDIT_SCOPE: AuditScope = { type: "instance", id: INSTANCE_SCOPE_ID };

export type AuditEvents = AuditEventInput<AuditEventName>[];

export const AUDIT_CHANGES_CHANNEL = "lunedo_audit_changes";

export interface AuditChangeSignal {
  scope: "instance" | "organization";
  organizationId: string | null;
  target: AuditTargetType;
  accountId?: string | null;
}

export function parseAuditChangeSignal(payload: string): AuditChangeSignal | null {
  try {
    const parsed = JSON.parse(payload) as Partial<AuditChangeSignal>;
    if (!auditTargetTypes.includes(parsed.target as AuditTargetType)) return null;
    const accountId =
      parsed.target === "account" && typeof parsed.accountId === "string" && isUuid(parsed.accountId)
        ? parsed.accountId
        : null;
    if (parsed.scope === "instance" && parsed.organizationId === null) {
      return { scope: "instance", organizationId: null, target: parsed.target as AuditTargetType, accountId };
    }
    if (parsed.scope === "organization" && typeof parsed.organizationId === "string") {
      return {
        scope: "organization",
        organizationId: parsed.organizationId,
        target: parsed.target as AuditTargetType,
        accountId,
      };
    }
  } catch {
    return null;
  }
  return null;
}

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
const INSERT_BATCH = 500;

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
  labels: unknown;
  sealed?: unknown;
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
  const sealed = entry.sealed === null || entry.sealed === undefined ? null : entry.sealed;
  const content = canonicalJson([
    sealed === null ? 1 : 2,
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
    ...(sealed === null
      ? entry.labels === null || entry.labels === undefined
        ? []
        : [entry.labels]
      : [entry.labels ?? null, sealed]),
  ]);
  return createHash("sha256").update(content, "utf8").digest();
}

function storable(value: string | undefined, maxLength = Number.POSITIVE_INFINITY): string | null {
  if (value === undefined) return null;
  return value.replaceAll("\u0000", "").slice(0, maxLength);
}

interface SeparatedEvent {
  subjects: Map<string, { accountId: string | null; parts: SealedParts }>;
  labels: AuditLabels | null;
  fields: Record<string, unknown>;
  clientIp: string | null;
  userAgent: string | null;
}

interface DescribedEvent {
  input: AuditEventInput<AuditEventName>;
  definition: AuditEventDefinition;
  actor: Principal;
  context: ReturnType<typeof currentRequestContext>;
  personal: SeparatedEvent;
  confidentialSpaces: string[];
}

interface PreparedEvent {
  content: HashedContent;
  actorType: Principal["type"];
  hash: Buffer;
  confidentialSpaces: string[];
  signal: AuditChangeSignal;
}

export interface AuditVerification {
  scope: AuditScope;
  entries: number;
  broken: { sequence: number; id: string | null; problem: string } | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONTENT_FIELDS = ["name", "title", "fileName", "note", "description"] as const;
const CONTENT_SETTINGS = new Set(["name", "description"]);
const CONTENT_TARGETS = new Set<AuditTargetType>(["space", "page"]);

async function confidentialSpacesOf(
  tx: Transaction,
  targetType: AuditTargetType,
  targetId: string | null,
  fields: Record<string, unknown>,
  known: ReadonlySet<string> = new Set(),
): Promise<string[]> {
  const ids = [
    ...(CONTENT_TARGETS.has(targetType) ? [targetId] : []),
    fields.spaceId,
    fields.itemId,
    fields.pageId,
  ].filter((id): id is string => typeof id === "string" && UUID.test(id));
  if (ids.length === 0) return [];
  const earlier = ids.filter((id) => known.has(id));
  const result = await tx.execute<{ id: string }>(sql`
    select s.id from spaces s where s.confidential and (s.id = any(${sql.param(ids)}::uuid[])
      or s.id in (select space_id from tree_items where id = any(${sql.param(ids)}::uuid[])))
    union select distinct space_id from audit_confidential_events
      where space_id = any(${sql.param(ids)}::uuid[])`);
  return [...new Set([...result.rows.map((row) => row.id), ...earlier])];
}

function withoutContent(fields: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...fields };
  for (const field of CONTENT_FIELDS) if (typeof redacted[field] === "string") redacted[field] = "";
  if (typeof redacted.setting === "string" && CONTENT_SETTINGS.has(redacted.setting)) {
    redacted.value = "";
    redacted.previousValue = "";
  }
  return redacted;
}

function subjectOf(id: string | null): string | null {
  return id && UUID.test(id) ? id.toLowerCase() : null;
}

export class AuditLog {
  readonly #database: Database;
  readonly #clock: () => Date;
  readonly #sealer: AuditSealer | undefined;

  constructor(options: { database: Database; clock?: () => Date; encryption?: Encryption }) {
    this.#database = options.database;
    this.#clock = options.clock ?? (() => new Date());
    this.#sealer = options.encryption ? new AuditSealer(options.encryption) : undefined;
  }

  get sealer(): AuditSealer | undefined {
    return this.#sealer;
  }

  async record<TName extends AuditEventName>(tx: Transaction, input: AuditEventInput<TName>): Promise<void> {
    await this.recordMany(tx, [input as AuditEventInput<AuditEventName>]);
  }

  async #describe(
    tx: Transaction,
    input: AuditEventInput<AuditEventName>,
    scope: AuditScope,
    labelCache: AuditLabelCache,
    knownConfidential: Set<string>,
  ): Promise<DescribedEvent> {
    const definition = auditCatalog[input.name];
    const parsed = definition.fields.strict().parse(input.fields) as Record<string, unknown>;
    const confidentialSpaces = await confidentialSpacesOf(
      tx,
      definition.target,
      input.targetId,
      parsed,
      knownConfidential,
    );
    for (const spaceId of confidentialSpaces) knownConfidential.add(spaceId);
    const confidential = confidentialSpaces.length > 0;
    const fields: unknown = confidential ? withoutContent(parsed) : parsed;
    const context = currentRequestContext();
    const actor = input.actor ?? context?.actor ?? SYSTEM;
    if (!(definition.actor as readonly string[]).includes(actor.type)) {
      throw new Error(`Audit event ${input.name} cannot be performed by ${actor.type}`);
    }
    const resolved = await resolveAuditLabels(tx, {
      actor,
      targetType: definition.target,
      targetId: input.targetId,
      fields,
      scope,
      cache: labelCache,
    });
    if (confidential && resolved.labels && CONTENT_TARGETS.has(definition.target)) {
      delete resolved.labels.target;
    }
    const personal = this.#separate(definition, {
      actor,
      targetId: input.targetId,
      fields: fields as Record<string, unknown>,
      labels: resolved.labels,
      accountReferences: resolved.accountReferences,
      clientIp: storable(context?.clientIp),
      userAgent: storable(context?.userAgent, USER_AGENT_MAX_LENGTH),
    });
    return { input, definition, actor, context, personal, confidentialSpaces };
  }

  async #prepare(
    tx: Transaction,
    described: DescribedEvent,
    scope: AuditScope,
    sequence: number,
    previousHash: Buffer,
  ): Promise<PreparedEvent> {
    const { input, definition, actor, context, personal, confidentialSpaces } = described;
    let sealed: Record<string, string> | null = null;
    if (personal.subjects.size > 0) {
      if (!this.#sealer) throw new PersonalDataMissingKeyError();
      sealed = await this.#sealer.seal(
        tx,
        { scopeType: scope.type, scopeId: scope.id, sequence },
        personal.subjects,
      );
    }
    const content: HashedContent = {
      scopeType: scope.type,
      scopeId: scope.id,
      sequence,
      name: input.name,
      actorType: actor.type,
      actorId: actor.type === "account" ? actor.id : null,
      targetType: definition.target,
      targetId: input.targetId,
      fields: personal.fields,
      labels: personal.labels,
      sealed,
      occurredAt: this.#clock(),
      requestId: storable(context?.requestId),
      clientIp: personal.clientIp,
      userAgent: personal.userAgent,
      previousHash,
    };
    const signal: AuditChangeSignal = {
      scope: scope.type,
      organizationId: scope.type === "organization" ? scope.id : null,
      target: definition.target,
      ...(definition.target === "account" && input.targetId ? { accountId: input.targetId } : {}),
    };
    return { content, actorType: actor.type, hash: hashAuditEntry(content), confidentialSpaces, signal };
  }

  async #recordInScope(tx: Transaction, scope: AuditScope, inputs: AuditEventInput<AuditEventName>[]) {
    const chain = and(eq(auditChains.scopeType, scope.type), eq(auditChains.scopeId, scope.id));
    await tx.insert(auditChains).values({ scopeType: scope.type, scopeId: scope.id }).onConflictDoNothing();
    const [head] = await tx
      .select({ lastSequence: auditChains.lastSequence, lastHash: auditChains.lastHash })
      .from(auditChains)
      .where(chain)
      .for("update");
    if (!head) throw new Error("The audit chain head is missing");
    let sequence = head.lastSequence;
    let previousHash = head.lastHash ?? GENESIS_HASH;
    const labelCache: AuditLabelCache = new Map();
    const described: DescribedEvent[] = [];
    await preloadAuditTargets(
      tx,
      labelCache,
      inputs.map((input) => ({ targetType: auditCatalog[input.name].target, targetId: input.targetId })),
    );
    const knownConfidential = new Set<string>();
    for (const input of inputs) {
      described.push(await this.#describe(tx, input, scope, labelCache, knownConfidential));
    }
    const subjects = new Map<string, string | null>();
    for (const { personal } of described) {
      for (const [subjectId, { accountId }] of personal.subjects) subjects.set(subjectId, accountId);
    }
    if (subjects.size > 0) {
      if (!this.#sealer) throw new PersonalDataMissingKeyError();
      await this.#sealer.preload(tx, subjects);
    }
    const prepared: PreparedEvent[] = [];
    for (const entryInput of described) {
      sequence += 1;
      const entry = await this.#prepare(tx, entryInput, scope, sequence, previousHash);
      previousHash = entry.hash;
      prepared.push(entry);
    }
    for (let start = 0; start < prepared.length; start += INSERT_BATCH) {
      const batch = prepared.slice(start, start + INSERT_BATCH);
      const inserted = await tx
        .insert(auditEvents)
        .values(
          batch.map(({ content, actorType, hash }) => ({
            ...content,
            scopeType: scope.type,
            actorType,
            hash,
          })),
        )
        .returning({ id: auditEvents.id, sequence: auditEvents.sequence });
      const ids = new Map(inserted.map((row) => [row.sequence, row.id]));
      const confidential = batch.flatMap(({ content, confidentialSpaces }) => {
        const eventId = ids.get(content.sequence);
        return eventId ? confidentialSpaces.map((spaceId) => ({ eventId, spaceId })) : [];
      });
      if (confidential.length > 0) await tx.insert(auditConfidentialEvents).values(confidential);
    }
    await tx
      .update(auditChains)
      .set({ lastSequence: sequence, lastHash: previousHash, updatedAt: new Date() })
      .where(chain);
    const signals = [...new Set(prepared.map(({ signal }) => JSON.stringify(signal)))];
    await tx.execute(
      sql`select pg_notify(${AUDIT_CHANGES_CHANNEL}, signal) from unnest(${sql.param(signals)}::text[]) as signal`,
    );
  }

  #separate(
    definition: AuditEventDefinition,
    event: {
      actor: Principal;
      targetId: string | null;
      fields: Record<string, unknown>;
      labels: AuditLabels | null;
      accountReferences: string[];
      clientIp: string | null;
      userAgent: string | null;
    },
  ): SeparatedEvent {
    const subjects = new Map<string, { accountId: string | null; parts: SealedParts }>();
    const partOf = (subjectId: string, accountId: string | null): SealedParts => {
      const existing = subjects.get(subjectId);
      if (existing) return existing.parts;
      const parts: SealedParts = {};
      subjects.set(subjectId, { accountId, parts });
      return parts;
    };
    const labels: AuditLabels = { ...(event.labels ?? {}) };
    const fields = { ...event.fields };
    const actorAccount = event.actor.type === "account" ? subjectOf(event.actor.id) : null;
    const personalTarget =
      definition.target === "account" || definition.target === "invitation"
        ? subjectOf(event.targetId)
        : null;
    const targetAccount = definition.target === "account" ? personalTarget : null;
    if (actorAccount && labels.actor !== undefined) {
      partOf(actorAccount, actorAccount).actor = labels.actor;
      delete labels.actor;
    }
    if (personalTarget && labels.target !== undefined) {
      partOf(personalTarget, targetAccount).target = labels.target;
      delete labels.target;
    }
    if (labels.references) {
      const references = { ...labels.references };
      for (const id of event.accountReferences) {
        const name = references[id];
        if (name === undefined) continue;
        const parts = partOf(id, id);
        parts.references = { ...parts.references, [id]: name };
        delete references[id];
      }
      if (Object.keys(references).length > 0) labels.references = references;
      else delete labels.references;
    }
    for (const [field, owner] of Object.entries(definition.personal ?? {})) {
      const subject = owner === "actor" ? actorAccount : personalTarget;
      if (!subject || fields[field] === undefined) continue;
      const parts = partOf(subject, owner === "actor" ? actorAccount : targetAccount);
      parts.fields = { ...parts.fields, [field]: fields[field] };
      delete fields[field];
    }
    let clientIp = event.clientIp;
    let userAgent = event.userAgent;
    const visitor = actorAccount ?? targetAccount;
    if (visitor && (clientIp !== null || userAgent !== null)) {
      const parts = partOf(visitor, visitor);
      if (clientIp !== null) parts.clientIp = clientIp;
      if (userAgent !== null) parts.userAgent = userAgent;
      clientIp = null;
      userAgent = null;
    }
    return {
      subjects,
      labels: Object.keys(labels).length > 0 ? labels : null,
      fields,
      clientIp,
      userAgent,
    };
  }

  async recordMany(tx: Transaction, inputs: AuditEventInput<AuditEventName>[]): Promise<void> {
    const groups = new Map<string, { scope: AuditScope; inputs: AuditEventInput<AuditEventName>[] }>();
    for (const input of inputs) {
      const scope = input.scope ?? INSTANCE_AUDIT_SCOPE;
      const key = `${scope.type}:${scope.id}`;
      const group = groups.get(key) ?? { scope, inputs: [] };
      group.inputs.push(input);
      groups.set(key, group);
    }
    for (const key of [...groups.keys()].sort()) {
      const group = groups.get(key);
      if (group) await this.#recordInScope(tx, group.scope, group.inputs);
    }
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
          await tx.execute(sql`select set_config('lunedo.audit_retention', 'on', true)`);
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

const PERSONAL_PREFERENCE_PREFIXES = ["appearance.", "locale."];

export function isPersonalPreference(level: string, key: string): boolean {
  return level === "user" && PERSONAL_PREFERENCE_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function auditSettingChanges(audit: AuditLog): SettingChangeHandler {
  return async (tx, change) => {
    if (isPersonalPreference(change.scope.level, change.key)) return;
    const organizationId =
      change.scope.level === "organization"
        ? change.scope.id
        : change.scope.level === "space"
          ? ((
              await tx.execute<{ organization_id: string | null }>(
                sql`select organization_id from spaces where id = ${change.scope.id}`,
              )
            ).rows[0]?.organization_id ?? null)
          : null;
    await audit.record(tx, {
      name: "settings.changed",
      targetId: change.key,
      ...(organizationId ? { scope: { type: "organization" as const, id: organizationId } } : {}),
      fields: {
        level: change.scope.level,
        scopeId: change.scope.id,
        action: change.action,
        ...(change.action === "set" ? { value: change.value as z.core.util.JSONType } : {}),
        previousValue: (change.previousValue ?? null) as z.core.util.JSONType,
        previousLocked: change.previousLocked,
      },
    });
  };
}
