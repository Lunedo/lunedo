import { readFileSync } from "node:fs";
import { Controller, Get, Post } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Permission, PublicRoute } from "../access/route-access.js";
import { ApiRoute } from "../http/api-route.js";
import { OpenApiValidator } from "../testing/openapi-validator.js";
import { completenessIssues } from "./completeness.js";
import { generateOpenApi, serializeOpenApi } from "./document.js";
import { GETTING_STARTED } from "./getting-started.js";
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

@Controller("api/v1/json")
class JsonController {
  @Post()
  @PublicRoute()
  @ApiRoute({ summary: "Store any JSON", tags: ["Demo"], body: z.json() })
  store() {}
}

describe("the OpenAPI description", () => {
  const document = generateOpenApi();

  it("is committed in its current form, with the internal routes", () => {
    const expected = serializeOpenApi(generateOpenApi({ includeInternal: true }));
    const actual = readFileSync(committed, "utf8").replaceAll("\r\n", "\n");
    expect(actual === expected, "openapi.json is outdated; run `pnpm --filter @lunedo/api openapi`").toBe(
      true,
    );
  });

  it("declares content kinds in responses as extensible, so new content types are not breaking", () => {
    const closed: string[] = [];
    const extensible: string[] = [];
    const walk = (value: unknown, path: string) => {
      if (Array.isArray(value)) {
        for (const [index, entry] of value.entries()) walk(entry, `${path}/${index}`);
        return;
      }
      if (value === null || typeof value !== "object") return;
      const schema = value as Record<string, unknown>;
      if (Array.isArray(schema.enum) && schema.enum.includes("blogPost")) closed.push(path);
      if (Array.isArray(schema["x-extensible-enum"])) {
        extensible.push(path);
        expect(schema.enum, path).toBeUndefined();
      }
      for (const [key, entry] of Object.entries(schema)) walk(entry, `${path}/${key}`);
    };
    const full = generateOpenApi({ includeInternal: true });
    walk(full.paths, "");
    expect(closed.filter((path) => path.includes("/responses/"))).toEqual([]);
    expect(extensible.some((path) => path.includes("/api/v1/items/{itemId}/get/responses/"))).toBe(true);
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

  it("marks internal routes so that their changes are not reported as breaking", () => {
    const full = generateOpenApi({ includeInternal: true });
    const signIn = full.paths["/api/v1/auth/sign-in"]?.post;
    expect(signIn?.["x-lunedo-internal"]).toBe(true);
    expect(signIn?.["x-stability-level"]).toBe("alpha");
    const members = full.paths["/api/v1/organizations/{organizationId}/members"]?.get;
    expect(members?.["x-lunedo-internal"]).toBeUndefined();
    expect(members?.["x-stability-level"]).toBeUndefined();
    expect(full.tags.map((tag) => tag.name)).toEqual(document.tags.map((tag) => tag.name));
  });

  it("moves a recursive root schema into a component instead of pointing at the document", () => {
    const json = generateOpenApi({ routes: routesOf(JsonController) });
    const serialized = JSON.stringify(json);
    expect(serialized).not.toContain('"$ref":"#"');
    const body = json.paths["/api/v1/json"]?.post?.requestBody?.content["application/json"]?.schema;
    const reference = String(body?.$ref);
    expect(reference).toMatch(/^#\/components\/schemas\/Schema[0-9a-f]{12}$/);
    const component = json.components.schemas[reference.split("/").at(-1) ?? ""];
    expect(JSON.stringify(component)).toContain(reference);
  });

  it("names the required permission of each route", () => {
    for (const methods of Object.values(document.paths)) {
      for (const operation of Object.values(methods)) {
        expect(operation["x-lunedo-permission"], operation.operationId).toBeDefined();
        expect(operation.description, operation.operationId).toMatch(
          /Requires (the permission|one of the permissions) `/,
        );
      }
    }
    expect(
      document.paths["/api/v1/organizations/{organizationId}/members"]?.get?.["x-lunedo-permission"],
    ).toEqual({
      action: "organization.members.view",
      resource: "organization",
      parameter: "organizationId",
    });
    expect(
      document.paths["/api/v1/organizations/{organizationId}/settings/{key}"]?.put?.["x-lunedo-permission"],
    ).toEqual({
      action: "organization.settings.manage",
      alternatives: ["organization.signIn.manage"],
      resource: "organization",
      parameter: "organizationId",
    });
  });

  it("documents routes that are public while the instance has one organization", () => {
    const logo = generateOpenApi({ includeInternal: true }).paths[
      "/api/v1/organizations/{organizationId}/logo"
    ]?.get;
    expect(logo?.security).toEqual([{ bearerAuth: [] }, { sessionCookie: [] }, {}]);
    expect(logo?.description).toContain(
      "Requires the permission `organization.view` on the organization in `organizationId`. Open to everyone while the instance has exactly one organization.",
    );
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
            expect(example.value.type).toMatch(/^urn:lunedo:problem:[a-zA-Z]+$/);
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

describe("the getting-started text", () => {
  it("names no route outside the reference and states that tokens expire only when a date applies", () => {
    expect(GETTING_STARTED).not.toContain("/account/tokens");
    expect(GETTING_STARTED).not.toContain("90 days");
    expect(GETTING_STARTED).toContain("no expiry unless you set a date");
  });
});
