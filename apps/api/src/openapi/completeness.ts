import type { JsonSchema, OpenApiDocument, Operation } from "./document.js";

function resolve(document: OpenApiDocument, schema: JsonSchema): JsonSchema {
  const ref = schema.$ref;
  if (typeof ref !== "string") return schema;
  return document.components.schemas[ref.replace("#/components/schemas/", "")] ?? {};
}

function undescribedFields(
  document: OpenApiDocument,
  schema: JsonSchema,
  path: string,
  seen: Set<JsonSchema>,
): string[] {
  const resolved = resolve(document, schema);
  if (seen.has(resolved)) return [];
  seen.add(resolved);
  const issues: string[] = [];
  const properties = resolved.properties as Record<string, JsonSchema> | undefined;
  for (const [name, property] of Object.entries(properties ?? {})) {
    const fieldPath = `${path}.${name}`;
    if (typeof property.description !== "string" || property.description.trim() === "") {
      issues.push(`${fieldPath} has no description`);
    }
    issues.push(...undescribedFields(document, property, fieldPath, seen));
  }
  for (const key of ["items", "additionalProperties"] as const) {
    const nested = resolved[key];
    if (nested && typeof nested === "object") {
      issues.push(...undescribedFields(document, nested as JsonSchema, `${path}[]`, seen));
    }
  }
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    const variants = resolved[key];
    if (Array.isArray(variants)) {
      for (const variant of variants as JsonSchema[])
        issues.push(...undescribedFields(document, variant, path, seen));
    }
  }
  return issues;
}

function operationIssues(document: OpenApiDocument, name: string, operation: Operation): string[] {
  const issues: string[] = [];
  if (!operation.summary?.trim()) issues.push(`${name} has no summary`);
  if (!operation.description?.trim()) issues.push(`${name} has no description`);
  if (!operation.tags?.length) issues.push(`${name} has no tag`);
  const statuses = Object.keys(operation.responses);
  if (!statuses.some((status) => Number(status) >= 400)) issues.push(`${name} documents no error response`);
  for (const parameter of operation.parameters ?? []) {
    if (!parameter.description?.trim()) issues.push(`${name} parameter ${parameter.name} has no description`);
  }
  const body = operation.requestBody?.content["application/json"];
  if (body) {
    if (body.example === undefined) issues.push(`${name} request body has no example`);
    issues.push(...undescribedFields(document, body.schema, `${name} request body`, new Set()));
  }
  for (const [status, response] of Object.entries(operation.responses)) {
    if (Number(status) >= 400) continue;
    for (const [type, content] of Object.entries(response.content ?? {})) {
      if (content.example === undefined) issues.push(`${name} response ${status} ${type} has no example`);
      issues.push(...undescribedFields(document, content.schema, `${name} response ${status}`, new Set()));
    }
  }
  return issues;
}

export function completenessIssues(document: OpenApiDocument): string[] {
  const issues: string[] = [];
  for (const [path, operations] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      if (operation["x-lunedo-internal"]) continue;
      issues.push(...operationIssues(document, `${method.toUpperCase()} ${path}`, operation));
    }
  }
  issues.push(...undescribedFields(document, { $ref: "#/components/schemas/Problem" }, "Problem", new Set()));
  return issues;
}
