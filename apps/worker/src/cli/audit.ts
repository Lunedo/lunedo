import { AuditLog, createDatabase, createDatabasePool } from "@pagehall/server";

/**
 * Checks the hash chains of the audit log. Prints one line per chain and returns 1 when a chain
 * is broken, naming its first broken entry.
 */
export async function verifyAuditLog(databaseUrl: string, write: (line: string) => void): Promise<number> {
  const pool = createDatabasePool({ connectionString: databaseUrl, applicationName: "pagehall-cli" });
  try {
    const results = await new AuditLog({ database: createDatabase(pool) }).verify();
    if (results.length === 0) write("The audit log is empty.");
    let broken = 0;
    for (const result of results) {
      const scope = result.scope.type === "instance" ? "instance" : `organization ${result.scope.id}`;
      if (result.broken) {
        broken += 1;
        const entry = result.broken.id ? ` (${result.broken.id})` : "";
        write(
          `Audit log of the ${scope} is broken at entry ${result.broken.sequence}${entry}: ${result.broken.problem}. Intact entries before it: ${result.entries}.`,
        );
      } else {
        write(`Audit log of the ${scope} is intact: ${result.entries} entries.`);
      }
    }
    return broken > 0 ? 1 : 0;
  } finally {
    await pool.end();
  }
}
