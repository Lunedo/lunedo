import type { HealthCheck } from "@lunedo/shared";
import type { KeyRingHolder } from "../crypto/key-ring-holder.js";
import { migrationStatus } from "../database/migrate.js";
import { type DatabasePool, pingDatabase } from "../database/pool.js";

/** Readiness checks shared by all roles: database, schema version and master key. */
export function readinessChecks(options: {
  pool: DatabasePool;
  keyRing: KeyRingHolder;
}): Record<string, HealthCheck> {
  return {
    database: () => pingDatabase(options.pool),
    migrations: async () => {
      const status = await migrationStatus(options.pool);
      if (!status.upToDate) throw new Error(`${status.expected - status.applied} migrations are pending`);
    },
    masterKey: async () => {
      options.keyRing.ring.current();
    },
  };
}
