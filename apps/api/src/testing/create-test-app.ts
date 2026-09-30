import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { createLogger, type DatabasePool } from "@pagehall/shared/node";
import { configureApp, createFastifyAdapter } from "../app.js";
import { AppModule } from "../app.module.js";
import type { ApiConfig } from "../config.js";
import { DATABASE_POOL } from "../database/database.module.js";

export async function createTestApp(
  options: { config?: Partial<ApiConfig>; pool?: Pick<DatabasePool, "query" | "end"> } = {},
): Promise<NestFastifyApplication> {
  const config: ApiConfig = {
    host: "127.0.0.1",
    port: 0,
    logLevel: "silent",
    databaseUrl: "postgres://pagehall:pagehall@127.0.0.1:1/pagehall",
    webRoot: undefined,
    ...options.config,
  };
  const logger = createLogger({ service: "api", level: "silent" });
  let builder = Test.createTestingModule({ imports: [AppModule.forRoot(config, logger)] });
  if (options.pool) builder = builder.overrideProvider(DATABASE_POOL).useValue(options.pool);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter(logger), {
    logger: false,
  });
  await configureApp(app, config);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
