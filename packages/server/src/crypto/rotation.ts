import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../database/database.js";
import type { DatabasePool } from "../database/pool.js";
import type { JobContext, JobQueue } from "../jobs/job-queue.js";
import { defineJob } from "../jobs/job-queue.js";
import type { EncryptedColumn } from "./encrypted-column.js";
import type { Encryption } from "./envelope.js";
import type { KeyRingHolder } from "./key-ring-holder.js";
import { type EncryptedStreams, masterKeyVersionsInUse } from "./key-usage.js";
import { keyRotations } from "./schema.js";
import { masterStreamKeys, rewrapStreamHeader, streamMasterKeyVersion } from "./stream.js";

export const rotateDataKeysJob = defineJob({
  name: "encryption.rotate-data-keys",
  duringMaintenance: "wait",
  payload: z.object({ rotationId: z.uuid(), targetVersion: z.int().positive() }),
  retryLimit: 10,
  retryDelaySeconds: 30,
  expireInSeconds: 6 * 60 * 60,
});

const BATCH_SIZE = 200;

export interface RotationStatus {
  currentVersion: number;
  /** Encrypted values per master key version, over all registered columns and streams. */
  valuesByVersion: Record<number, number>;
  latest: { id: string; targetVersion: number; status: "running" | "completed"; rewrapped: number } | null;
}

function versionBytes(version: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(version);
  return bytes;
}

/**
 * Key rotation: after a new master key version is added, a background job
 * re-wraps the data key of every encrypted value and every registered stream with it. The
 * encrypted data itself is not touched. Values stay readable with their old version until
 * they are re-wrapped; the rotation completes only when nothing uses an older version.
 */
export class KeyRotation {
  readonly #database: Database;
  readonly #encryption: Encryption;
  readonly #keyRing: KeyRingHolder;
  readonly #jobs: JobQueue;
  readonly #columns: () => readonly EncryptedColumn[];
  readonly #streams: EncryptedStreams | undefined;

  constructor(options: {
    database: Database;
    encryption: Encryption;
    keyRing: KeyRingHolder;
    jobs: JobQueue;
    columns: () => readonly EncryptedColumn[];
    streams?: EncryptedStreams;
  }) {
    this.#database = options.database;
    this.#encryption = options.encryption;
    this.#keyRing = options.keyRing;
    this.#jobs = options.jobs;
    this.#columns = options.columns;
    this.#streams = options.streams;
  }

  /** Starts re-wrapping for the current key version; returns the running rotation if there is one. */
  async start(): Promise<{ id: string; targetVersion: number }> {
    const targetVersion = (await this.#keyRing.reload()).currentVersion;
    const [running] = await this.#database
      .select({ id: keyRotations.id })
      .from(keyRotations)
      .where(and(eq(keyRotations.targetVersion, targetVersion), eq(keyRotations.status, "running")));
    const id =
      running?.id ??
      (
        await this.#database.insert(keyRotations).values({ targetVersion }).returning({ id: keyRotations.id })
      )[0]?.id;
    if (!id) throw new Error("Creating the key rotation failed");
    await this.#jobs.enqueue(rotateDataKeysJob, { rotationId: id, targetVersion }, { idempotencyKey: id });
    return { id, targetVersion };
  }

  /** Job handler; safe to run again after an interruption. */
  readonly run = async (job: JobContext<z.infer<typeof rotateDataKeysJob.payload>>): Promise<void> => {
    const { rotationId } = job.payload;
    const ring = await this.#keyRing.reload();
    if (ring.currentVersion < job.payload.targetVersion) {
      throw new Error(
        `This node's master key ring ends at version ${ring.currentVersion}; the rotation needs version ${job.payload.targetVersion}`,
      );
    }
    // A newer version may have been added since the rotation started; it is re-wrapped to that one.
    const targetVersion = ring.currentVersion;
    const total = await this.#countOutdated(targetVersion);
    let done = 0;
    await job.reportProgress(done, total);

    for (const column of this.#columns()) {
      for (;;) {
        if (job.signal.aborted) throw new Error("Key rotation interrupted");
        const count = await this.#rewrapBatch(column, targetVersion);
        if (count === 0) break;
        done += count;
        await this.#database
          .update(keyRotations)
          .set({ rewrapped: sql`${keyRotations.rewrapped} + ${count}` })
          .where(eq(keyRotations.id, rotationId));
        await job.reportProgress(done, Math.max(total, done));
      }
    }

    const keys = masterStreamKeys(() => ring);
    const rewrapStreams = async (registered: EncryptedStreams) => {
      for (const owner of registered.owners()) {
        for await (const stream of owner.streams(registered.context, targetVersion)) {
          if (job.signal.aborted) throw new Error("Key rotation interrupted");
          const header = await stream.readHeader();
          const version = streamMasterKeyVersion(header);
          if (version === undefined || version === targetVersion) continue;
          await stream.writeHeader(rewrapStreamHeader(header, keys));
          done += 1;
          await this.#database
            .update(keyRotations)
            .set({ rewrapped: sql`${keyRotations.rewrapped} + 1` })
            .where(eq(keyRotations.id, rotationId));
          await job.reportProgress(done, Math.max(total, done));
        }
      }
    };
    if (this.#streams) {
      await rewrapStreams(this.#streams);
      await rewrapStreams(this.#streams);
    }

    const remaining = await this.#countOutdated(targetVersion);
    if (remaining > 0) throw new Error(`${remaining} values still use an older master key version`);
    await this.#database
      .update(keyRotations)
      .set({ status: "completed", completedAt: new Date(), targetVersion })
      .where(eq(keyRotations.id, rotationId));
    job.logger.info({ targetVersion, rewrapped: done }, "Key rotation completed");
  };

  async #rewrapBatch(column: EncryptedColumn, targetVersion: number): Promise<number> {
    const table = sql.identifier(column.table);
    const id = sql.identifier(column.idColumn);
    const value = sql.identifier(column.column);
    return this.#database.transaction(async (tx) => {
      const rows = await tx.execute<{ id: string; value: Buffer }>(
        sql`select ${id} as id, ${value} as value from ${table}
            where ${value} is not null and substring(${value} from 5 for 4) <> ${versionBytes(targetVersion)}
            limit ${BATCH_SIZE} for update skip locked`,
      );
      for (const row of rows.rows) {
        await tx.execute(
          sql`update ${table} set ${value} = ${this.#encryption.rewrap(row.value)} where ${id} = ${row.id}`,
        );
      }
      return rows.rows.length;
    });
  }

  async #countOutdated(targetVersion: number): Promise<number> {
    let count = 0;
    for (const [version, values] of Object.entries(await this.#valuesByVersion())) {
      if (Number(version) !== targetVersion) count += values;
    }
    return count;
  }

  #valuesByVersion(): Promise<Record<number, number>> {
    return masterKeyVersionsInUse({
      database: this.#database,
      columns: this.#columns(),
      streams: this.#streams,
    });
  }

  async status(): Promise<RotationStatus> {
    const [latest] = await this.#database
      .select({
        id: keyRotations.id,
        targetVersion: keyRotations.targetVersion,
        status: keyRotations.status,
        rewrapped: keyRotations.rewrapped,
      })
      .from(keyRotations)
      .orderBy(desc(keyRotations.createdAt))
      .limit(1);
    return {
      currentVersion: this.#keyRing.ring.currentVersion,
      valuesByVersion: await this.#valuesByVersion(),
      latest: latest ?? null,
    };
  }
}

const ROTATION_LOCK = "pagehall.key-rotation";

/**
 * Adds a master key version (where the provider manages keys) and starts the rotation to it.
 * An advisory lock serializes concurrent calls, and the key ring is read again while it is
 * held, so two rotations can never write diverging versions.
 */
export async function rotateMasterKey(options: {
  pool: DatabasePool;
  keyRing: KeyRingHolder;
  rotation: KeyRotation;
}): Promise<{ id: string; targetVersion: number }> {
  const client = await options.pool.connect();
  try {
    await client.query("select pg_advisory_lock(hashtext($1))", [ROTATION_LOCK]);
    try {
      if (options.keyRing.provider.name === "file") await options.keyRing.provider.addVersion();
      await options.keyRing.reload();
      await options.keyRing.announce(client);
      return await options.rotation.start();
    } finally {
      await client.query("select pg_advisory_unlock(hashtext($1))", [ROTATION_LOCK]);
    }
  } finally {
    client.release();
  }
}
