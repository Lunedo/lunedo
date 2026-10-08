import { createHash } from "node:crypto";
import { z } from "zod";
import type { RouteAccess } from "../access/route-access.js";
import { type ApiRouteDefinition, successStatus } from "../http/api-route.js";
import { type ProblemCode, problemBody, problemSchema, problems } from "../http/problems.js";
import { GETTING_STARTED } from "./getting-started.js";
import { type ApiRouteInfo, apiRoutes } from "./routes.js";

export type JsonSchema = Record<string, unknown>;

export interface OpenApiDocument {
  openapi: string;
  info: Record<string, unknown>;
  servers: unknown[];
  tags: { name: string; description: string }[];
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: Record<string, JsonSchema>; securitySchemes: Record<string, unknown> };
}

export interface Operation {
  operationId: string;
  summary?: string;
  description?: string;
  tags?: string[];
  "x-pagehall-permission"?: unknown;
  "x-pagehall-internal"?: boolean;
  "x-stability-level"?: "alpha";
  security: Record<string, string[]>[];
  parameters?: Parameter[];
  requestBody?: { required: boolean; content: Record<string, { schema: JsonSchema; example?: unknown }> };
  responses: Record<string, Response>;
}

export interface Parameter {
  name: string;
  in: "path" | "query";
  required: boolean;
  description?: string;
  schema: JsonSchema;
}

export interface Response {
  description: string;
  headers?: Record<string, unknown>;
  content?: Record<string, { schema: JsonSchema; example?: unknown; examples?: Record<string, unknown> }>;
}

const TAG_DESCRIPTIONS: Record<string, string> = {
  Organizations: "Organizations, their domains and break-glass access.",
  Members: "Members, collaborators, guests and invitations of an organization.",
  Roles: "Custom roles and role assignments of an organization.",
  Groups: "Groups of accounts and their managers.",
  Settings: "Settings of an organization.",
  Instance: "Organizations, accounts, roles and settings of the whole instance.",
  "Service accounts": "Accounts for scripts and integrations, owned by an organization.",
  "API tokens": "Personal tokens and tokens of service accounts.",
  "Audit log": "Reading and exporting the tamper-evident audit log.",
  Spaces: "Spaces, their settings and permissions, and personal spaces.",
  Versions: "Drafts, publishing, editing modes, versions, comparison and restoring of pages.",
  Trash: "Deleting and restoring content in two trash stages, archiving spaces and deleting spaces.",
  Templates: "Page templates of the instance, organizations and spaces, and the template gallery.",
  Pages: "The page tree with pages, folders and links, page content, labels and backlinks.",
};

const ROOT = "root";

const FORMATS_WITHOUT_PATTERN = new Set(["uuid", "date-time", "email"]);

function hoistDescription(schema: JsonSchema): JsonSchema {
  const variants = schema.anyOf;
  if (schema.description !== undefined || !Array.isArray(variants)) return schema;
  const described = (variants as JsonSchema[]).find((variant) => typeof variant.description === "string");
  if (!described) return schema;
  const { description, ...rest } = described;
  return {
    ...schema,
    description,
    anyOf: (variants as JsonSchema[]).map((variant) => (variant === described ? rest : variant)),
  };
}

class SchemaCollector {
  readonly components: Record<string, JsonSchema> = {};

  convert(schema: z.ZodType, io: "input" | "output"): JsonSchema {
    let converted = z.toJSONSchema(schema, { io, unrepresentable: "any" }) as JsonSchema;
    delete converted.$schema;
    const defs = (converted.$defs ?? {}) as Record<string, JsonSchema>;
    delete converted.$defs;
    if (JSON.stringify(converted).includes('"$ref":"#"')) {
      defs[ROOT] = converted;
      converted = { $ref: `#/$defs/${ROOT}` };
    }
    const names = new Map<string, string>();
    for (const [key, definition] of Object.entries(defs)) {
      const hash = createHash("sha256").update(JSON.stringify(definition)).digest("hex").slice(0, 12);
      names.set(key, `Schema${hash}`);
    }
    const rewrite = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(rewrite);
      if (value === null || typeof value !== "object") return value;
      const formatted = "format" in value && FORMATS_WITHOUT_PATTERN.has(String(value.format));
      return Object.fromEntries(
        Object.entries(hoistDescription(value as JsonSchema))
          .filter(([key]) => !(formatted && key === "pattern"))
          .map(([key, entry]) => {
            if (key === "$ref" && entry === "#") {
              return [key, `#/components/schemas/${names.get(ROOT)}`];
            }
            if (key === "$ref" && typeof entry === "string" && entry.startsWith("#/$defs/")) {
              const name = names.get(entry.slice("#/$defs/".length));
              return [key, `#/components/schemas/${name}`];
            }
            return [key, rewrite(entry)];
          }),
      );
    };
    for (const [key, definition] of Object.entries(defs)) {
      const name = names.get(key);
      if (name) this.components[name] = rewrite(definition) as JsonSchema;
    }
    return rewrite(converted) as JsonSchema;
  }
}

function openApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function operationId(route: ApiRouteInfo): string {
  const base = route.controller.replace(/Controller$/, "");
  return `${base.charAt(0).toLowerCase()}${base.slice(1)}.${route.handler}`;
}

function acceptsTokens(access: RouteAccess | undefined): boolean {
  if (access?.kind === "apiDocumentation") return true;
  return access?.kind === "permission" && !access.sessionOnly && !access.recentAuthentication;
}

function security(access: RouteAccess | undefined): Record<string, string[]>[] {
  if (!access || access.kind === "public" || access.kind === "setupCode" || access.kind === "setupSession")
    return [];
  const open = access.kind === "permission" && access.publicForSoleOrganization ? [{}] : [];
  if (acceptsTokens(access)) return [{ bearerAuth: [] }, { sessionCookie: [] }, ...open];
  return [{ sessionCookie: [] }, ...open];
}

function accessText(access: RouteAccess | undefined): string | null {
  if (!access) return null;
  switch (access.kind) {
    case "permission": {
      const on =
        "param" in access.resource
          ? `the ${access.resource.type} in \`${access.resource.param}\``
          : "the instance";
      const via =
        access.sessionOnly || access.recentAuthentication
          ? " Needs a signed-in session; API tokens are refused."
          : "";
      const open = access.publicForSoleOrganization
        ? " Open to everyone while the instance has exactly one organization."
        : "";
      if (access.alternatives.length > 0) {
        const all = [access.action, ...access.alternatives].map((action) => `\`${action}\``).join(", ");
        return `Requires one of the permissions ${all} on ${on}; the request decides which.${via}${open}`;
      }
      return `Requires the permission \`${access.action}\` on ${on}.${via}${open}`;
    }
    case "session":
      return "Needs a signed-in session.";
    case "apiDocumentation":
      return "Open to signed-in users, or to everyone when the documentation is public.";
    default:
      return null;
  }
}

function automaticErrors(route: ApiRouteInfo, definition: ApiRouteDefinition): ProblemCode[] {
  const access = route.access;
  const codes: ProblemCode[] = [];
  if (definition.params || definition.query || definition.body) codes.push("invalidInput");
  if (access?.kind === "session" || access?.kind === "permission" || access?.kind === "apiDocumentation") {
    codes.push("notSignedIn");
    if (acceptsTokens(access)) codes.push("invalidApiToken", "ambiguousCredentials", "rateLimited");
    else codes.push("sessionRequired");
  }
  if (access?.kind === "permission") {
    codes.push("forbidden");
    if (access.recentAuthentication) codes.push("reauthenticationRequired");
  }
  if (access?.kind === "session" && access.recentAuthentication) codes.push("reauthenticationRequired");
  if (access?.kind === "setupCode") codes.push("notFound");
  if (access?.kind === "setupSession") codes.push("setupSessionRequired", "notFound");
  if (definition.params) codes.push("notFound");
  if (route.method !== "GET") codes.push("csrfRejected");
  return codes;
}

function errorResponses(codes: ProblemCode[]): Record<string, Response> {
  const byStatus = new Map<number, ProblemCode[]>();
  for (const code of new Set(codes)) {
    const status = problems[code].status;
    byStatus.set(status, [...(byStatus.get(status) ?? []), code]);
  }
  const responses: Record<string, Response> = {};
  for (const [status, list] of [...byStatus].sort(([left], [right]) => left - right)) {
    const sorted = [...list].sort();
    responses[String(status)] = {
      description: sorted.map((code) => `\`${code}\`: ${problems[code].title}.`).join(" "),
      content: {
        "application/problem+json": {
          schema: { $ref: "#/components/schemas/Problem" },
          examples: Object.fromEntries(sorted.map((code) => [code, { value: problemBody(code) }])),
        },
      },
    };
  }
  return responses;
}

function parameters(
  collector: SchemaCollector,
  schema: z.ZodObject | undefined,
  location: "path" | "query",
): Parameter[] {
  if (!schema) return [];
  const converted = collector.convert(schema, "input");
  const properties = (converted.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((converted.required ?? []) as string[]);
  return Object.entries(properties).map(([name, property]) => {
    const { description, ...rest } = property;
    return {
      name,
      in: location,
      required: location === "path" || required.has(name),
      ...(typeof description === "string" ? { description } : {}),
      schema: rest,
    };
  });
}

function operation(
  collector: SchemaCollector,
  route: ApiRouteInfo,
  definition: ApiRouteDefinition,
): Operation {
  const status = String(successStatus(definition));
  const success: Response = definition.response
    ? {
        description: definition.response.description,
        content: {
          "application/json": {
            schema: collector.convert(definition.response.schema, "output"),
            ...(definition.response.example !== undefined ? { example: definition.response.example } : {}),
          },
        },
      }
    : definition.raw
      ? {
          description: definition.raw.description,
          content: Object.fromEntries(
            definition.raw.contentTypes.map((type) => [
              type,
              { schema: { type: "string" }, example: definition.raw?.example },
            ]),
          ),
        }
      : definition.redirect
        ? {
            description: definition.redirect.description,
            headers: { Location: { description: "The page to open next.", schema: { type: "string" } } },
          }
        : { description: status === "202" ? "Accepted." : "Done. The response has no body." };
  const access = accessText(route.access);
  const description = definition.description
    ? [definition.description, access].filter(Boolean).join("\n\n")
    : undefined;
  const parameterList = [
    ...parameters(collector, definition.params, "path"),
    ...parameters(collector, definition.query, "query"),
  ];
  return {
    operationId: operationId(route),
    summary: definition.summary,
    ...(description ? { description } : {}),
    tags: definition.tags,
    ...(route.access?.kind === "permission"
      ? {
          "x-pagehall-permission": {
            action: route.access.action,
            ...(route.access.alternatives.length > 0 ? { alternatives: route.access.alternatives } : {}),
            resource: route.access.resource.type,
            ...("param" in route.access.resource ? { parameter: route.access.resource.param } : {}),
          },
        }
      : {}),
    ...(route.internal ? { "x-pagehall-internal": true, "x-stability-level": "alpha" } : {}),
    security: security(route.access),
    ...(parameterList.length > 0 ? { parameters: parameterList } : {}),
    ...(definition.body
      ? {
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: collector.convert(definition.body, "input"),
                ...(definition.bodyExample !== undefined ? { example: definition.bodyExample } : {}),
              },
            },
          },
        }
      : {}),
    responses: {
      [status]: success,
      ...errorResponses([...automaticErrors(route, definition), ...(definition.errors ?? [])]),
    },
  };
}

export function generateOpenApi(
  options: { includeInternal?: boolean; routes?: ApiRouteInfo[] } = {},
): OpenApiDocument {
  const collector = new SchemaCollector();
  const paths: OpenApiDocument["paths"] = {};
  const tags = new Set<string>();
  const routes = (options.routes ?? apiRoutes())
    .filter((route) => route.path.startsWith("/api/") && (options.includeInternal || !route.internal))
    .sort((left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method));
  for (const route of routes) {
    if (!route.definition) throw new Error(`${route.method} ${route.path} has no route declaration`);
    const path = openApiPath(route.path);
    paths[path] = {
      ...paths[path],
      [route.method.toLowerCase()]: operation(collector, route, route.definition),
    };
    if (!route.internal) for (const tag of route.definition.tags) tags.add(tag);
  }
  const problem = collector.convert(problemSchema, "output");
  const schemas = Object.fromEntries(
    Object.entries({ ...collector.components, Problem: problem }).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  return {
    openapi: "3.1.1",
    info: {
      title: "Pagehall API",
      version: "1",
      description: GETTING_STARTED,
      license: { name: "AGPL-3.0-only", identifier: "AGPL-3.0-only" },
    },
    servers: [{ url: "/", description: "This instance" }],
    tags: [...tags].sort().map((name) => ({ name, description: TAG_DESCRIPTIONS[name] ?? "" })),
    paths,
    components: {
      schemas,
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "An API token starting with `ph_`, sent as `Authorization: Bearer <token>`.",
        },
        sessionCookie: {
          type: "apiKey",
          in: "cookie",
          name: "__Host-pagehall-session",
          description:
            "The session of a signed-in user. State-changing requests also need the `X-Pagehall-Request: 1` header.",
        },
      },
    },
  };
}

export function serializeOpenApi(document: OpenApiDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}
