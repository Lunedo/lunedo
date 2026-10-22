import { sql } from "drizzle-orm";
import type { Database } from "../database/database.js";
import { StartupError } from "../runtime/startup-error.js";
import type { EncryptedColumn } from "./encrypted-column.js";
import type { EncryptedStreamContext, EncryptedStreamOwner } from "./encrypted-stream.js";
import { KeyRingError } from "./key-ring.js";
import type { KeyRingHolder } from "./key-ring-holder.js";
import { streamMasterKeyVersion } from "./stream.js";

export interface EncryptedStreams {
  owners: () => readonly EncryptedStreamOwner[];
  context: EncryptedStreamContext;
}

/** Number of encrypted values and streams per master key version. */
export async function masterKeyVersionsInUse(options: {
  database: Database;
  columns: readonly EncryptedColumn[];
  streams?: EncryptedStreams | undefined;
}): Promise<Record<number, number>> {
  const counts: Record<number, number> = {};
  const add = (version: number, count: number) => {
    counts[version] = (counts[version] ?? 0) + count;
  };
  for (const column of options.columns) {
    const value = sql.identifier(column.column);
    const result = await options.database.execute<{ version: Buffer; count: string }>(
      sql`select substring(${value} from 5 for 4) as version, count(*) as count
          from ${sql.identifier(column.table)} where ${value} is not null group by 1`,
    );
    for (const row of result.rows) add(row.version.readUInt32BE(0), Number(row.count));
  }
  const streams = options.streams;
  for (const owner of streams?.owners() ?? []) {
    const context = (streams as EncryptedStreams).context;
    if (owner.versions) {
      for (const [version, count] of Object.entries(await owner.versions(context)))
        add(Number(version), count);
      continue;
    }
    for await (const stream of owner.streams(context)) {
      const version = streamMasterKeyVersion(await stream.readHeader());
      if (version !== undefined) add(version, 1);
    }
  }
  return counts;
}

export class MasterKeyError extends StartupError {
  override name = "MasterKeyError";
}

/**
 * Loads the master key ring at startup. A new key is created only while the database holds no
 * encrypted data, and every key version that stored data uses must be in the ring.
 */
export async function loadMasterKeyRing(options: {
  keyRing: KeyRingHolder;
  database: Database;
  columns: readonly EncryptedColumn[];
  streams?: EncryptedStreams | undefined;
}): Promise<void> {
  const inUse = Object.keys(await masterKeyVersionsInUse(options))
    .map(Number)
    .sort((a, b) => a - b);
  try {
    await options.keyRing.reload({ create: inUse.length === 0 });
  } catch (error) {
    if (!(error instanceof KeyRingError) || inUse.length === 0) throw error;
    throw new MasterKeyError(
      `The database contains data encrypted with master key version ${inUse.join(", ")}, but no master key ring is available: ${error.message}. Restore the master key ring of this instance (master-keys in the secrets directory, or LUNEDO_MASTER_KEYS) and start Lunedo again. A new key is never created while encrypted data exists.`,
    );
  }
  const missing = inUse.filter((version) => !options.keyRing.ring.has(version));
  if (missing.length > 0) {
    throw new MasterKeyError(
      `Stored data uses master key version ${missing.join(", ")}, which the master key ring does not contain. Restore the complete master key ring of this instance and start Lunedo again.`,
    );
  }
}
