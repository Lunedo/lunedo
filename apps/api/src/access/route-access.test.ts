import { Controller, Get, Module } from "@nestjs/common";
import { MODULE_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { Test } from "@nestjs/testing";
import { createLogger, currentRequestContext, Metrics, Secret } from "@pagehall/server";
import { afterEach, describe, expect, it } from "vitest";
import { configureApp, createFastifyAdapter } from "../app.js";
import { AppModule } from "../app.module.js";
import type { ApiContext } from "../context.js";
import { PublicRoute, ROUTE_ACCESS } from "./route-access.js";

type Constructor = abstract new (...args: never[]) => unknown;

/** Collects the controllers of a module and of all modules it imports. */
function controllersOf(module: unknown, seen = new Set<unknown>()): Constructor[] {
  if (!module || seen.has(module)) return [];
  seen.add(module);
  const definition = module as { module?: unknown; controllers?: Constructor[]; imports?: unknown[] };
  const type = (definition.module ?? module) as object;
  const controllers = [
    ...(definition.controllers ?? []),
    ...((Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, type) as Constructor[] | undefined) ?? []),
  ];
  const imports = [
    ...(definition.imports ?? []),
    ...((Reflect.getMetadata(MODULE_METADATA.IMPORTS, type) as unknown[] | undefined) ?? []),
  ];
  return [...controllers, ...imports.flatMap((imported) => controllersOf(imported, seen))];
}

function routeHandlers(controller: Constructor): { name: string; handler: object }[] {
  const prototype = controller.prototype as Record<string, unknown>;
  return Object.getOwnPropertyNames(prototype)
    .filter((name) => name !== "constructor" && typeof prototype[name] === "function")
    .map((name) => ({ name, handler: prototype[name] as object }))
    .filter(({ handler }) => Reflect.getMetadata(PATH_METADATA, handler) !== undefined);
}

const context: ApiContext = {
  logger: createLogger({ service: "api", level: "silent" }),
  metrics: new Metrics("api"),
  metricsToken: new Secret("token"),
  readiness: {},
  webRoot: undefined,
};

describe("route access declarations", () => {
  it("exist on every API route", () => {
    const controllers = controllersOf(AppModule.forRoot(context));
    const routes = controllers.flatMap((controller) =>
      routeHandlers(controller).map(({ name, handler }) => ({
        route: `${controller.name}.${name}`,
        declared:
          Reflect.getMetadata(ROUTE_ACCESS, handler) !== undefined ||
          Reflect.getMetadata(ROUTE_ACCESS, controller) !== undefined,
      })),
    );
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.filter((route) => !route.declared).map((route) => route.route)).toEqual([]);
  });
});

@Controller("test")
class TestController {
  @Get("undeclared")
  undeclared() {
    return { reached: true };
  }

  @Get("context")
  @PublicRoute()
  context() {
    return { requestId: currentRequestContext()?.requestId ?? null };
  }
}

@Module({ controllers: [TestController] })
class TestModule {}

describe("RouteAccessGuard", () => {
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function start(): Promise<NestFastifyApplication> {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(context), TestModule],
    }).compile();
    const created = moduleRef.createNestApplication<NestFastifyApplication>(
      createFastifyAdapter(context.logger),
      {
        logger: false,
      },
    );
    await configureApp(created, context);
    await created.init();
    await created.getHttpAdapter().getInstance().ready();
    app = created;
    return created;
  }

  it("rejects routes without a declaration", async () => {
    const response = await (await start()).inject({ method: "GET", url: "/test/undeclared" });
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain("reached");
  });

  it("runs handlers in the context of their request", async () => {
    const response = await (await start()).inject({ method: "GET", url: "/test/context" });
    expect(response.json().requestId).toBe(response.headers["x-request-id"]);
  });
});
