import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { enterRequestContext, type Logger } from "@pagehall/server";
import { LogController } from "fastify";
import { AppModule } from "./app.module.js";
import type { ApiContext } from "./context.js";
import { NestLogger } from "./nest-logger.js";
import { registerWebClient } from "./web-client.js";

export function createFastifyAdapter(logger: Logger): FastifyAdapter {
  return new FastifyAdapter({
    loggerInstance: logger,
    logController: new LogController({ disableRequestLogging: true, requestIdLogLabel: "requestId" }),
    genReqId: () => randomUUID(),
  });
}

/** Applies request context, request logging, metrics and the web client to an application. */
export async function configureApp(app: NestFastifyApplication, context: ApiContext): Promise<void> {
  const fastify = app.getHttpAdapter().getInstance();

  fastify.addHook("onRequest", async (request, reply) => {
    enterRequestContext({ requestId: request.id });
    reply.header("x-request-id", request.id);
  });
  fastify.addHook("onResponse", async (request, reply) => {
    const path = request.url.split("?")[0] ?? "";
    const route = request.routeOptions.url ?? "unmatched";
    context.metrics.observeHttpRequest(request.method, route, reply.statusCode, reply.elapsedTime / 1000);
    const entry = {
      method: request.method,
      path,
      statusCode: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
    };
    if (path.startsWith("/health/") || path === "/metrics") request.log.debug(entry, "Request completed");
    else request.log.info(entry, "Request completed");
  });

  if (context.webRoot) await registerWebClient(fastify, context.webRoot);
  app.enableShutdownHooks();
}

export async function createApp(context: ApiContext): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.forRoot(context),
    createFastifyAdapter(context.logger),
    { logger: new NestLogger(context.logger.child({ component: "nest" })) },
  );
  await configureApp(app, context);
  return app;
}
