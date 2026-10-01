import { Controller, type ExecutionContext, ForbiddenException, Get, Module, Post } from "@nestjs/common";
import { DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { createLogger, currentRequestContext, Metrics, Secret } from "@pagehall/server";
import { afterEach, describe, expect, it } from "vitest";
import { configureApp, createFastifyAdapter } from "../app.js";
import { AppModule } from "../app.module.js";
import type { ApiContext } from "../context.js";
import { RouteAccessGuard } from "./route-access.guard.js";
import { PublicRoute } from "./route-access.js";
import { registeredRoutes } from "./route-access.verifier.js";

const context: ApiContext = {
  logger: createLogger({ service: "api", level: "silent" }),
  metrics: new Metrics("api"),
  metricsToken: new Secret("token"),
  readiness: {},
  webRoot: undefined,
  trustedProxies: [],
  services: undefined,
  settings: undefined,
  settingsRegistry: undefined,
};

@Controller("test")
class UndeclaredController {
  @Get("declared")
  @PublicRoute()
  declared() {
    return { reached: true };
  }

  @Post("undeclared")
  undeclared() {
    return { reached: true };
  }
}

@Module({ controllers: [UndeclaredController] })
class UndeclaredModule {}

@Controller("test")
class ContextController {
  @Get("context")
  @PublicRoute()
  context() {
    return { requestId: currentRequestContext()?.requestId ?? null };
  }
}

@Module({ controllers: [ContextController] })
class ContextModule {}

let app: NestFastifyApplication | undefined;

afterEach(async () => {
  await app?.close().catch(() => {});
  app = undefined;
});

async function createApp(...modules: unknown[]): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(context), ...(modules as never[])],
  }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(createFastifyAdapter(context.logger), {
    logger: false,
  });
  await configureApp(app, context);
  return app;
}

describe("route access declarations", () => {
  it("exist on every registered route of the API", async () => {
    const created = await createApp();
    await created.init();
    const routes = registeredRoutes(
      created.get(DiscoveryService),
      created.get(MetadataScanner),
      created.get(Reflector),
    );
    expect(routes.map((route) => route.route)).toEqual(
      expect.arrayContaining([
        "GET /health/live (HealthController.live)",
        "GET /health/ready (HealthController.ready)",
        "GET /metrics (MetricsController.metrics)",
      ]),
    );
    expect(routes.filter((route) => route.access === undefined)).toEqual([]);
  });

  it("are required to start the API, and the error names the route", async () => {
    const created = await createApp(UndeclaredModule);
    await expect(created.init()).rejects.toThrow(
      "Routes without an access declaration: POST /test/undeclared (UndeclaredController.undeclared)",
    );
  });
});

describe("RouteAccessGuard", () => {
  function executionFor(handler: () => unknown): ExecutionContext {
    return {
      getHandler: () => handler,
      getClass: () => UndeclaredController,
      switchToHttp: () => ({
        getRequest: () => ({ headers: {} }),
        getResponse: () => ({ header: () => {} }),
      }),
    } as unknown as ExecutionContext;
  }

  const guard = new RouteAccessGuard(new Reflector(), context);

  it("denies a route without a declaration", async () => {
    await expect(guard.canActivate(executionFor(UndeclaredController.prototype.undeclared))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("allows a public route", async () => {
    await expect(guard.canActivate(executionFor(UndeclaredController.prototype.declared))).resolves.toBe(
      true,
    );
  });
});

describe("request context", () => {
  it("is available in route handlers", async () => {
    const created = await createApp(ContextModule);
    await created.init();
    await created.getHttpAdapter().getInstance().ready();
    const response = await created.inject({ method: "GET", url: "/test/context" });
    expect(response.json().requestId).toBe(response.headers["x-request-id"]);
  });
});
