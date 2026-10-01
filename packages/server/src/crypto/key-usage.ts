import { sql } from "drizzle-orm";
import type { Database } from "../database/database.js";
import type { EncryptedColumn } from "./encrypted-column.js";
import type { EncryptedStreamContext, EncryptedStreamOwner } from "./encrypted-stream.js";
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
    for await (const stream of owner.streams((streams as EncryptedStreams).context)) {
      const version = streamMasterKeyVersion(await stream.readHeader());
      if (version !== undefined) add(version, 1);
    }
  }
  return counts;
}
