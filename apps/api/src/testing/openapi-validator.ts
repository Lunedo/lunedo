import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import type { LightMyRequestResponse } from "fastify";
import {
  generateOpenApi,
  type JsonSchema,
  type OpenApiDocument,
  type Operation,
} from "../openapi/document.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

interface CompiledOperation {
  pattern: RegExp;
  parameters: number;
  method: string;
  path: string;
  operation: Operation;
}

export class OpenApiValidator {
  readonly #ajv: Ajv2020;
  readonly #operations: CompiledOperation[];
  readonly #definitions: Record<string, JsonSchema>;
  readonly #validators = new Map<string, ValidateFunction>();

  constructor(readonly document: OpenApiDocument) {
    this.#ajv = new Ajv2020({ strict: false, allErrors: true });
    this.#ajv.addFormat("uuid", UUID);
    this.#ajv.addFormat("date-time", DATE_TIME);
    this.#ajv.addFormat("email", /^[^@\s]+@[^@\s]+$/);
    this.#definitions = JSON.parse(
      JSON.stringify(document.components.schemas).replaceAll("#/components/schemas/", "#/$defs/"),
    ) as Record<string, JsonSchema>;
    this.#operations = Object.entries(document.paths).flatMap(([path, operations]) =>
      Object.entries(operations).map(([method, operation]) => ({
        pattern: new RegExp(`^${path.replace(/\{[^}]+\}/g, "[^/]+")}$`),
        parameters: (path.match(/\{/g) ?? []).length,
        method: method.toUpperCase(),
        path,
        operation,
      })),
    );
  }

  #validator(key: string, schema: JsonSchema): ValidateFunction {
    let validate = this.#validators.get(key);
    if (!validate) {
      const rewritten = JSON.parse(
        JSON.stringify(schema).replaceAll("#/components/schemas/", "#/$defs/"),
      ) as JsonSchema;
      validate = this.#ajv.compile({ ...rewritten, $defs: this.#definitions });
      this.#validators.set(key, validate);
    }
    return validate;
  }

  find(method: string, path: string): CompiledOperation | undefined {
    return this.#operations
      .filter((candidate) => candidate.method === method && candidate.pattern.test(path))
      .sort((left, right) => left.parameters - right.parameters)[0];
  }

  validateSchema(key: string, schema: JsonSchema, value: unknown): string[] {
    const validate = this.#validator(key, schema);
    if (validate(value)) return [];
    return (validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message ?? ""}`);
  }

  check(method: string, url: string, response: LightMyRequestResponse): string[] {
    const path = url.split("?")[0] ?? "";
    if (!path.startsWith("/api/")) return [];
    const contentType = String(response.headers["content-type"] ?? "").split(";")[0] ?? "";
    const found = this.find(method, path);
    if (contentType === "application/problem+json") {
      const problem = this.validateSchema(
        "Problem",
        { $ref: "#/components/schemas/Problem" },
        response.json(),
      );
      if (!found) return problem;
      if (!found.operation.responses[String(response.statusCode)]) {
        return [...problem, `${method} ${found.path} does not document status ${response.statusCode}`];
      }
      return problem;
    }
    if (!found) return [`${method} ${path} is not in the description`];
    const documented = found.operation.responses[String(response.statusCode)];
    if (!documented) return [`${method} ${found.path} does not document status ${response.statusCode}`];
    if (!documented.content) {
      return response.body === "" ? [] : [`${method} ${found.path} ${response.statusCode} must have no body`];
    }
    const content = documented.content[contentType];
    if (!content) return [`${method} ${found.path} ${response.statusCode} does not document ${contentType}`];
    if (contentType !== "application/json" || content.schema.type === "string") return [];
    return this.validateSchema(
      `${method} ${found.path} ${response.statusCode}`,
      content.schema,
      response.json(),
    ).map((error) => `${method} ${found.path} ${response.statusCode}: ${error}`);
  }
}

let shared: OpenApiValidator | undefined;

export function openApiValidator(): OpenApiValidator {
  shared ??= new OpenApiValidator(generateOpenApi({ includeInternal: true }));
  return shared;
}
