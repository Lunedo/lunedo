import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { eq, inArray, or } from "drizzle-orm";
import type { Encryption } from "../crypto/envelope.js";
import { KEY_LENGTH } from "../crypto/key-ring.js";
import type { Executor, Transaction } from "../database/database.js";
import { auditSubjectKeys } from "./schema.js";

export interface SealedParts {
  actor?: string;
  target?: string;
  references?: Record<string, string>;
  fields?: Record<string, unknown>;
  clientIp?: string;
  userAgent?: string;
}

export interface SealedPosition {
  scopeType: string;
  scopeId: string;
  sequence: number;
}

export interface UnsealedEntry {
  labels: unknown;
  fields: unknown;
  clientIp: string | null;
  userAgent: string | null;
  formerSubjects: string[];
}

const FORMAT_VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function keyContext(subjectId: string): string {
  return `audit_subject_keys.key:${subjectId}`;
}

function aad(position: SealedPosition, subjectId: string): Buffer {
  return Buffer.from(
    `audit_events.sealed:${position.scopeType}:${position.scopeId}:${position.sequence}:${subjectId}`,
    "utf8",
  );
}

export class PersonalDataMissingKeyError extends Error {
  override name = "PersonalDataMissingKeyError";

  constructor() {
    super("Audit events with personal data need encryption");
  }
}

export class AuditSealer {
  readonly #encryption: Encryption;

  constructor(encryption: Encryption) {
    this.#encryption = encryption;
  }

  async #key(tx: Transaction, subjectId: string, accountId: string | null): Promise<Buffer> {
    const fresh = randomBytes(KEY_LENGTH);
    await tx
      .insert(auditSubjectKeys)
      .values({
        subjectId,
        accountId,
        key: this.#encryption.encrypt(fresh.toString("base64"), keyContext(subjectId)),
      })
      .onConflictDoNothing();
    fresh.fill(0);
    const [row] = await tx
      .select({ key: auditSubjectKeys.key })
      .from(auditSubjectKeys)
      .where(eq(auditSubjectKeys.subjectId, subjectId));
    if (!row) throw new Error("The audit key of the subject is missing");
    return Buffer.from(this.#encryption.decryptString(row.key, keyContext(subjectId)), "base64");
  }

  async seal(
    tx: Transaction,
    position: SealedPosition,
    parts: ReadonlyMap<string, { accountId: string | null; parts: SealedParts }>,
  ): Promise<Record<string, string> | null> {
    if (parts.size === 0) return null;
    const sealed: Record<string, string> = {};
    for (const [subjectId, entry] of [...parts.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const key = await this.#key(tx, subjectId, entry.accountId);
      try {
        const iv = randomBytes(IV_LENGTH);
        const cipher = createCipheriv("aes-256-gcm", key, iv);
        cipher.setAAD(aad(position, subjectId));
        const data = Buffer.concat([cipher.update(JSON.stringify(entry.parts), "utf8"), cipher.final()]);
        sealed[subjectId] = Buffer.concat([
          Buffer.from([FORMAT_VERSION]),
          iv,
          data,
          cipher.getAuthTag(),
        ]).toString("base64");
      } finally {
        key.fill(0);
      }
    }
    return sealed;
  }

  async #keys(executor: Executor, subjectIds: string[]): Promise<Map<string, Buffer>> {
    if (subjectIds.length === 0) return new Map();
    const rows = await executor
      .select({ subjectId: auditSubjectKeys.subjectId, key: auditSubjectKeys.key })
      .from(auditSubjectKeys)
      .where(inArray(auditSubjectKeys.subjectId, subjectIds));
    return new Map(
      rows.map((row) => [
        row.subjectId,
        Buffer.from(this.#encryption.decryptString(row.key, keyContext(row.subjectId)), "base64"),
      ]),
    );
  }

  #open(key: Buffer, position: SealedPosition, subjectId: string, value: string): SealedParts | null {
    const bytes = Buffer.from(value, "base64");
    if (bytes.length < 1 + IV_LENGTH + TAG_LENGTH || bytes[0] !== FORMAT_VERSION) return null;
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(1, 1 + IV_LENGTH));
      decipher.setAAD(aad(position, subjectId));
      decipher.setAuthTag(bytes.subarray(bytes.length - TAG_LENGTH));
      const plain = Buffer.concat([
        decipher.update(bytes.subarray(1 + IV_LENGTH, bytes.length - TAG_LENGTH)),
        decipher.final(),
      ]);
      return JSON.parse(plain.toString("utf8")) as SealedParts;
    } catch {
      return null;
    }
  }

  async unseal<T extends SealedPosition & UnsealedEntry & { sealed: unknown }>(
    executor: Executor,
    entries: T[],
  ): Promise<T[]> {
    const subjectIds = new Set<string>();
    for (const entry of entries) {
      for (const subjectId of Object.keys((entry.sealed ?? {}) as Record<string, string>)) {
        subjectIds.add(subjectId);
      }
    }
    const keys = await this.#keys(executor, [...subjectIds]);
    try {
      return entries.map((entry) => this.#merge(entry, keys));
    } finally {
      for (const key of keys.values()) key.fill(0);
    }
  }

  #merge<T extends SealedPosition & UnsealedEntry & { sealed: unknown }>(
    entry: T,
    keys: Map<string, Buffer>,
  ): T {
    const sealed = (entry.sealed ?? {}) as Record<string, string>;
    if (Object.keys(sealed).length === 0) return entry;
    const labels = { ...((entry.labels ?? {}) as Record<string, unknown>) };
    const fields = { ...((entry.fields ?? {}) as Record<string, unknown>) };
    let clientIp = entry.clientIp;
    let userAgent = entry.userAgent;
    const formerSubjects: string[] = [];
    for (const [subjectId, value] of Object.entries(sealed)) {
      const key = keys.get(subjectId);
      const parts = key ? this.#open(key, entry, subjectId, value) : null;
      if (!parts) {
        formerSubjects.push(subjectId);
        continue;
      }
      if (parts.actor !== undefined) labels.actor = parts.actor;
      if (parts.target !== undefined) labels.target = parts.target;
      if (parts.references) {
        labels.references = { ...((labels.references ?? {}) as Record<string, string>), ...parts.references };
      }
      if (parts.fields) Object.assign(fields, parts.fields);
      if (parts.clientIp !== undefined) clientIp = parts.clientIp;
      if (parts.userAgent !== undefined) userAgent = parts.userAgent;
    }
    return {
      ...entry,
      labels: Object.keys(labels).length > 0 ? labels : null,
      fields,
      clientIp,
      userAgent,
      formerSubjects: formerSubjects.sort(),
    };
  }

  async linkSubject(tx: Transaction, subjectId: string, accountId: string): Promise<void> {
    await tx.update(auditSubjectKeys).set({ accountId }).where(eq(auditSubjectKeys.subjectId, subjectId));
  }

  async destroySubject(tx: Transaction, subjectId: string): Promise<void> {
    await tx.delete(auditSubjectKeys).where(eq(auditSubjectKeys.subjectId, subjectId));
  }

  async destroy(tx: Transaction, accountId: string): Promise<number> {
    const removed = await tx
      .delete(auditSubjectKeys)
      .where(or(eq(auditSubjectKeys.subjectId, accountId), eq(auditSubjectKeys.accountId, accountId)))
      .returning({ subjectId: auditSubjectKeys.subjectId });
    return removed.length;
  }
}
