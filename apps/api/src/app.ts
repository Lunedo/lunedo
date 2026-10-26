import { randomUUID } from "node:crypto";
import {
  ANONYMOUS,
  defaultEmbedServices,
  embedFrameSources,
  enterRequestContext,
  type Logger,
  type RequestContext,
} from "@lunedo/server";
import { acceptsClientApiLevel, CLIENT_API_HEADER, CLIENT_BUILD_HEADER } from "@lunedo/shared";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { type FastifyRequest, LogController } from "fastify";
import { AppModule } from "./app.module.js";
import type { ApiContext } from "./context.js";
import { COOKIES, readCookie } from "./http/cookies.js";
import { CSRF_HEADER, changesState, isCsrfSafe, ownOrigin } from "./http/csrf.js";
import { sendProblem } from "./http/error.filter.js";
import { instanceUrlOf } from "./http/instance-url.js";
import { bearerToken, carriesCookieCredentials } from "./http/request.js";
import { NestLogger } from "./nest-logger.js";
import { registerPortal } from "./portal/routes.js";
import { readClientBuild, registerWebClient } from "./web-client.js";

export function createFastifyAdapter(logger: Logger, trustedProxies: string[] = []): FastifyAdapter {
  return new FastifyAdapter({
    loggerInstance: logger,
    logController: new LogController({ disableRequestLogging: true, requestIdLogLabel: "requestId" }),
    genReqId: () => randomUUID(),
    trustProxy: trustedProxies.length > 0 ? trustedProxies : false,
    routerOptions: { maxParamLength: 300 },
  });
}

async function allowedOrigins(request: FastifyRequest, context: ApiContext): Promise<string[]> {
  const instanceUrl = await instanceUrlOf(context);
  const origins = [instanceUrl ? new URL(instanceUrl).origin : ownOrigin(request)];
  const setup = context.services?.setup;
  const path = request.url.split("?")[0] ?? "";
  if (setup && path.startsWith("/api/v1/setup/") && !(await setup.isComplete())) {
    if (path === "/api/v1/setup/session") origins.push(ownOrigin(request));
    const token = readCookie(request, COOKIES.setup);
    const origin = token ? await setup.sessionOrigin(token) : null;
    if (origin) origins.push(origin);
  }
  return origins;
}

async function movedTo(request: FastifyRequest, context: ApiContext): Promise<string | null> {
  if (request.headers[CSRF_HEADER] !== "1" || request.headers.origin !== ownOrigin(request)) return null;
  const instanceUrl = await instanceUrlOf(context);
  if (!instanceUrl || new URL(instanceUrl).origin === ownOrigin(request)) return null;
  return instanceUrl;
}

const BACKCHANNEL_LOGOUT = /^\/api\/v1\/auth\/providers\/[0-9A-Fa-f-]{36}\/backchannel-logout$/;

function isBackchannelLogout(request: FastifyRequest): boolean {
  return BACKCHANNEL_LOGOUT.test(request.url.split("?")[0] ?? "");
}

const SAML_RESPONSE = /^\/api\/v1\/auth\/providers\/[0-9A-Fa-f-]{36}\/saml\/acs$/;

function isSamlResponse(request: FastifyRequest): boolean {
  return request.method === "POST" && SAML_RESPONSE.test(request.url.split("?")[0] ?? "");
}

const ONE_CLICK_UNSUBSCRIBE = /^\/api\/v1\/notifications\/unsubscribe\/[^/]+$/;

function isOneClickUnsubscribe(request: FastifyRequest): boolean {
  return request.method === "POST" && ONE_CLICK_UNSUBSCRIBE.test(request.url.split("?")[0] ?? "");
}

const TOKEN_SEGMENTS =
  /^(\/api\/v1\/share-links\/|\/api\/v1\/files\/|\/api\/v1\/notifications\/unsubscribe\/|\/unsubscribe\/|\/s\/)[^/]+/;

export function withoutTokens(path: string): string {
  return path.replace(TOKEN_SEGMENTS, "$1:token");
}

export async function configureApp(app: NestFastifyApplication, context: ApiContext): Promise<void> {
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addContentTypeParser(
    "application/scim+json",
    { parseAs: "string" },
    fastify.getDefaultJsonParser("error", "error"),
  );
  fastify.addContentTypeParser("application/octet-stream", (_request, payload, done) => done(null, payload));
  fastify.addContentTypeParser("text/csv", (_request, payload, done) => done(null, payload));

  const clientBuild = context.webRoot ? await readClientBuild(context.webRoot) : null;
  const requestContexts = new WeakMap<FastifyRequest, RequestContext>();
  const endRequestCache = (request: FastifyRequest) => {
    const requestContext = requestContexts.get(request);
    if (requestContext) requestContext.cache = undefined;
  };
  fastify.addHook("onRequest", async (request, reply) => {
    const userAgent = request.headers["user-agent"];
    const requestContext: RequestContext = {
      requestId: request.id,
      clientIp: request.ip,
      ...(userAgent ? { userAgent } : {}),
      actor: ANONYMOUS,
      cache: new Map(),
    };
    requestContexts.set(request, requestContext);
    enterRequestContext(requestContext);
    reply.header("x-request-id", request.id);
    if (clientBuild) reply.header(CLIENT_BUILD_HEADER, clientBuild);
  });
  fastify.addHook("onRequestAbort", async (request) => endRequestCache(request));
  registerPortal(fastify, context);
  fastify.addHook("onRequest", async (request, reply) => {
    if (bearerToken(request) !== undefined) {
      if (readCookie(request, COOKIES.session) !== undefined) {
        return sendProblem(reply, "ambiguousCredentials", "Send either a session cookie or an API token");
      }
      if (!carriesCookieCredentials(request)) return;
    }
    if (isBackchannelLogout(request) && !carriesCookieCredentials(request)) return;
    if (isSamlResponse(request) || isOneClickUnsubscribe(request)) return;
    if (!changesState(request) || isCsrfSafe(request, await allowedOrigins(request, context))) return;
    const moved = await movedTo(request, context);
    if (moved) {
      return sendProblem(reply, "instanceMoved", "Open Lunedo at its current address", {
        instanceUrl: moved,
      });
    }
    return sendProblem(
      reply,
      "csrfRejected",
      "State-changing requests need the X-Lunedo-Request header and a matching Origin",
    );
  });
  fastify.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/")) return;
    const level = request.headers[CLIENT_API_HEADER.toLowerCase()];
    if (acceptsClientApiLevel(Array.isArray(level) ? level[0] : level)) return;
    return sendProblem(reply, "clientOutdated", "Reload Lunedo to load the current web client");
  });
  fastify.addHook("onResponse", async (request, reply) => {
    endRequestCache(request);
    const path = request.url.split("?")[0] ?? "";
    const route = request.routeOptions.url ?? "unmatched";
    context.metrics.observeHttpRequest(request.method, route, reply.statusCode, reply.elapsedTime / 1000);
    const entry = {
      method: request.method,
      path: withoutTokens(path),
      statusCode: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
    };
    if (path.startsWith("/health/") || path === "/metrics") request.log.debug(entry, "Request completed");
    else request.log.info(entry, "Request completed");
  });

  if (context.webRoot) {
    await registerWebClient(fastify, context.webRoot, () =>
      context.services
        ? context.services.embeds.frameSources()
        : Promise.resolve(embedFrameSources(defaultEmbedServices)),
    );
  }
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
