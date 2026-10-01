import { readFileSync } from "node:fs";
import { Controller, Get, Post } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Permission, PublicRoute } from "../access/route-access.js";
import { ApiRoute } from "../http/api-route.js";
import { OpenApiValidator } from "../testing/openapi-validator.js";
import { completenessIssues } from "./completeness.js";
import { generateOpenApi, serializeOpenApi } from "./document.js";
import { apiRoutes, routesOf } from "./routes.js";

const committed = new URL("../../openapi.json", import.meta.url);

@Controller("api/v1/demo")
class IncompleteController {
  @Get(":thingId")
  @Permission("organization.view", { type: "organization", param: "thingId" })
  @ApiRoute({
    summary: "",
    tags: [],
    params: z.object({ thingId: z.uuid() }).strict(),
    response: { description: "A thing.", schema: z.object({ name: z.string() }) },
  })
  get() {
    return { name: "thing" };
  }

  @Post()
  @PublicRoute()
  @ApiRoute({
    summary: "Create a thing",
    description: "Creates a thing.",
    tags: ["Demo"],
    body: z.object({ name: z.string().describe("Name.") }).strict(),
  })
  create() {}
}

describe("the OpenAPI description", () => {
  const document = generateOpenApi();

  it("is committed in its current form", () => {
    const expected = serializeOpenApi(document);
    const actual = readFileSync(committed, "utf8").replaceAll("\r\n", "\n");
    expect(actual === expected, "openapi.json is outdated; run `pnpm --filter @pagehall/api openapi`").toBe(
      true,
    );
  });

  it("describes every public route completely", () => {
    expect(completenessIssues(document)).toEqual([]);
  });

  it("contains every public route and no internal one", () => {
    const operations = Object.entries(document.paths).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
    );
    const expected = apiRoutes()
      .filter((route) => !route.internal)
      .map((route) => `${route.method} ${route.path.replace(/:([A-Za-z]+)/g, "{$1}")}`);
    expect(operations.sort()).toEqual(expected.sort());
    expect(operations).toContain("GET /api/v1/organizations/{organizationId}/members");
    expect(operations).not.toContain("POST /api/v1/auth/sign-in");
    expect(operations).not.toContain("POST /api/v1/account/tokens");
    expect(Object.keys(document.paths).every((path) => path.startsWith("/api/v1/"))).toBe(true);
  });

  it("names the required permission of each route", () => {
    for (const methods of Object.values(document.paths)) {
      for (const operation of Object.values(methods)) {
        expect(operation["x-pagehall-permission"], operation.operationId).toBeDefined();
        expect(operation.description, operation.operationId).toMatch(
          /Requires (the permission|one of the permissions) `/,
        );
      }
    }
    expect(
      document.paths["/api/v1/organizations/{organizationId}/members"]?.get?.["x-pagehall-permission"],
    ).toEqual({
      action: "organization.members.view",
      resource: "organization",
      parameter: "organizationId",
    });
    expect(
      document.paths["/api/v1/organizations/{organizationId}/settings/{key}"]?.put?.["x-pagehall-permission"],
    ).toEqual({
      action: "organization.settings.manage",
      alternatives: ["organization.signIn.manage"],
      resource: "organization",
      parameter: "organizationId",
    });
  });

  it("has examples that match their schemas", () => {
    const validator = new OpenApiValidator(document);
    for (const [path, methods] of Object.entries(document.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        const body = operation.requestBody?.content["application/json"];
        if (body?.example !== undefined) {
          expect(
            validator.validateSchema(`${method} ${path} body`, body.schema, body.example),
            operation.operationId,
          ).toEqual([]);
        }
        for (const [status, response] of Object.entries(operation.responses)) {
          const content = response.content?.["application/json"];
          if (content?.example === undefined) continue;
          expect(
            validator.validateSchema(`${method} ${path} ${status}`, content.schema, content.example),
            `${operation.operationId} ${status}`,
          ).toEqual([]);
        }
      }
    }
  });

  it("uses stable problem types for every documented error", () => {
    for (const methods of Object.values(document.paths)) {
      for (const operation of Object.values(methods)) {
        for (const [status, response] of Object.entries(operation.responses)) {
          if (Number(status) < 400) continue;
          const problem = response.content?.["application/problem+json"];
          for (const example of Object.values(problem?.examples ?? {}) as {
            value: { type: string; status: number };
          }[]) {
            expect(example.value.type).toMatch(/^urn:pagehall:problem:[a-zA-Z]+$/);
            expect(example.value.status).toBe(Number(status));
          }
        }
      }
    }
  });

  it("reports routes without summary, description, tag, example or field descriptions", () => {
    const incomplete = generateOpenApi({ routes: routesOf(IncompleteController) });
    const issues = completenessIssues(incomplete);
    expect(issues).toEqual(
      expect.arrayContaining([
        "GET /api/v1/demo/{thingId} has no summary",
        "GET /api/v1/demo/{thingId} has no description",
        "GET /api/v1/demo/{thingId} has no tag",
        "GET /api/v1/demo/{thingId} parameter thingId has no description",
        "GET /api/v1/demo/{thingId} response 200 application/json has no example",
        "GET /api/v1/demo/{thingId} response 200.name has no description",
        "POST /api/v1/demo request body has no example",
      ]),
    );
  });
});
