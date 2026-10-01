import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { ANONYMOUS, enterRequestContext, instanceUrlSetting, type Logger } from "@pagehall/server";
import { LogController } from "fastify";
import { AppModule } from "./app.module.js";
import type { ApiContext } from "./context.js";
import { isCsrfSafe } from "./http/csrf.js";
import { NestLogger } from "./nest-logger.js";
import { registerWebClient } from "./web-client.js";

/**
 * Fastify takes the client address and protocol from forwarding headers only when the request
 * comes from one of the trusted proxies.
 */
export function createFastifyAdapter(logger: Logger, trustedProxies: string[] = []): FastifyAdapter {
  return new FastifyAdapter({
    loggerInstance: logger,
    logController: new LogController({ disableRequestLogging: true, requestIdLogLabel: "requestId" }),
    genReqId: () => randomUUID(),
    trustProxy: trustedProxies.length > 0 ? trustedProxies : false,
  });
}

/** Applies request context, CSRF protection, request logging, metrics and the web client to an application. */
export async function configureApp(app: NestFastifyApplication, context: ApiContext): Promise<void> {
  const fastify = app.getHttpAdapter().getInstance();

  fastify.addHook("onRequest", async (request, reply) => {
    const userAgent = request.headers["user-agent"];
    enterRequestContext({
      requestId: request.id,
      clientIp: request.ip,
      ...(userAgent ? { userAgent } : {}),
      actor: ANONYMOUS,
    });
    reply.header("x-request-id", request.id);
  });
  fastify.addHook("onRequest", async (request, reply) => {
    const instanceUrl = context.settings ? await context.settings.get(instanceUrlSetting, {}) : "";
    if (isCsrfSafe(request, instanceUrl)) return;
    await reply.status(403).send({
      statusCode: 403,
      code: "csrfRejected",
      message: "State-changing requests need the X-Pagehall-Request header and a matching Origin",
    });
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
    createFastifyAdapter(context.logger, context.trustedProxies),
    { logger: new NestLogger(context.logger.child({ component: "nest" })) },
  );
  await configureApp(app, context);
  return app;
}
