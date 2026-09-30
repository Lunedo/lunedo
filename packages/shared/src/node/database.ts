import pg from "pg";

export type DatabasePool = pg.Pool;

export function createDatabasePool(options: {
  connectionString: string;
  applicationName: string;
  max?: number;
}): DatabasePool {
  return new pg.Pool({
    connectionString: options.connectionString,
    application_name: options.applicationName,
    max: options.max ?? 10,
    connectionTimeoutMillis: 5000,
  });
}

export async function pingDatabase(pool: DatabasePool): Promise<void> {
  await pool.query("select 1");
}
