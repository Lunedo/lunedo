import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { createDatabasePool, type DatabasePool } from "@pagehall/shared/node";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { API_CONFIG, type ApiConfig } from "../config.js";

export const DATABASE_POOL = Symbol("DATABASE_POOL");
export const DATABASE = Symbol("DATABASE");

export type Database = NodePgDatabase;

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_POOL,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig): DatabasePool =>
        createDatabasePool({ connectionString: config.databaseUrl, applicationName: "pagehall-api" }),
    },
    {
      provide: DATABASE,
      inject: [DATABASE_POOL],
      useFactory: (pool: DatabasePool): Database => drizzle({ client: pool }),
    },
  ],
  exports: [DATABASE_POOL, DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_POOL) private readonly pool: DatabasePool) {}

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
