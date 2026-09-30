import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import type { Logger } from "@pagehall/shared/node";
import { LogController } from "fastify";
import { AppModule } from "./app.module.js";
import type { ApiConfig } from "./config.js";
import { NestLogger } from "./nest-logger.js";
import { registerWebClient } from "./web-client.js";

export function createFastifyAdapter(logger: Logger): FastifyAdapter {
  return new FastifyAdapter({
    loggerInstance: logger,
    logController: new LogController({ disableRequestLogging: true, requestIdLogLabel: "requestId" }),
    genReqId: () => randomUUID(),
  });
}

/** Applies request logging, request IDs and the web client to an application. */
export async function configureApp(app: NestFastifyApplication, config: ApiConfig): Promise<void> {
  const fastify = app.getHttpAdapter().getInstance();

  fastify.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });
  fastify.addHook("onResponse", async (request, reply) => {
    const path = request.url.split("?")[0] ?? "";
    const entry = {
      method: request.method,
      path,
      statusCode: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
    };
    if (path.startsWith("/health/")) request.log.debug(entry, "Request completed");
    else request.log.info(entry, "Request completed");
  });

  if (config.webRoot) await registerWebClient(fastify, config.webRoot);
  app.enableShutdownHooks();
}

export async function createApp(config: ApiConfig, logger: Logger): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(config, logger),
    createFastifyAdapter(logger),
    { logger: new NestLogger(logger.child({ component: "nest" })) },
  );
  await configureApp(app, config);
  return app;
}
