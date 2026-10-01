import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { createLogger, Metrics, Secret } from "@pagehall/server";
import { configureApp, createFastifyAdapter } from "../app.js";
import { AppModule } from "../app.module.js";
import type { ApiContext } from "../context.js";

export const TEST_METRICS_TOKEN = "test-metrics-token";

export async function createTestApp(context: Partial<ApiContext> = {}): Promise<NestFastifyApplication> {
  const full: ApiContext = {
    logger: createLogger({ service: "api", level: "silent" }),
    metrics: new Metrics("api"),
    metricsToken: new Secret(TEST_METRICS_TOKEN),
    readiness: {},
    webRoot: undefined,
    trustedProxies: [],
    services: undefined,
    settings: undefined,
    ...context,
  };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(full)] }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    createFastifyAdapter(full.logger, full.trustedProxies),
    { logger: false },
  );
  await configureApp(app, full);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
