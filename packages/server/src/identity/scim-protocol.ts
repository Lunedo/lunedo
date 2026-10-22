export const SCIM_SCHEMAS = {
  user: "urn:ietf:params:scim:schemas:core:2.0:User",
  group: "urn:ietf:params:scim:schemas:core:2.0:Group",
  listResponse: "urn:ietf:params:scim:api:messages:2.0:ListResponse",
  patchOp: "urn:ietf:params:scim:api:messages:2.0:PatchOp",
  error: "urn:ietf:params:scim:api:messages:2.0:Error",
  serviceProviderConfig: "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig",
  resourceType: "urn:ietf:params:scim:schemas:core:2.0:ResourceType",
  schema: "urn:ietf:params:scim:schemas:core:2.0:Schema",
} as const;

export type ScimErrorType =
  | "invalidFilter"
  | "invalidSyntax"
  | "invalidPath"
  | "noTarget"
  | "invalidValue"
  | "mutability"
  | "uniqueness"
  | "tooMany"
  | null;

export class ScimError extends Error {
  override name = "ScimError";

  constructor(
    readonly status: number,
    readonly scimType: ScimErrorType,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export function scimErrorBody(error: ScimError): Record<string, unknown> {
  return {
    schemas: [SCIM_SCHEMAS.error],
    status: String(error.status),
    ...(error.scimType ? { scimType: error.scimType } : {}),
    detail: error.message,
  };
}

export interface ScimFilter {
  attribute: string;
  value: string;
}

const FILTER = /^\s*([A-Za-z][A-Za-z0-9.:]*)\s+eq\s+"((?:[^"\\]|\\.)*)"\s*$/i;

export function parseFilter(filter: string | undefined, attributes: readonly string[]): ScimFilter | null {
  if (filter === undefined || filter.trim() === "") return null;
  const match = FILTER.exec(filter);
  const attribute = match?.[1];
  const raw = match?.[2];
  if (!attribute || raw === undefined) {
    throw new ScimError(400, "invalidFilter", 'Only filters of the form attribute eq "value" are supported');
  }
  const known = attributes.find((candidate) => candidate.toLowerCase() === attribute.toLowerCase());
  if (!known) throw new ScimError(400, "invalidFilter", `Filtering by ${attribute} is not supported`);
  return { attribute: known, value: raw.replace(/\\(.)/g, "$1") };
}

export interface PatchOperation {
  op: "add" | "replace" | "remove";
  path: string | null;
  value: unknown;
}

export function parsePatch(body: unknown): PatchOperation[] {
  const operations =
    (body as { Operations?: unknown; operations?: unknown } | null)?.Operations ??
    (body as { operations?: unknown } | null)?.operations;
  if (!Array.isArray(operations) || operations.length === 0 || operations.length > 1000) {
    throw new ScimError(400, "invalidSyntax", "The request needs between 1 and 1000 operations");
  }
  return operations.map((operation: unknown) => {
    const entry = (operation ?? {}) as { op?: unknown; path?: unknown; value?: unknown };
    const op = typeof entry.op === "string" ? entry.op.toLowerCase() : "";
    if (op !== "add" && op !== "replace" && op !== "remove") {
      throw new ScimError(400, "invalidSyntax", `The operation ${String(entry.op)} is not supported`);
    }
    if (entry.path !== undefined && entry.path !== null && typeof entry.path !== "string") {
      throw new ScimError(400, "invalidPath", "The path must be text");
    }
    return {
      op,
      path: typeof entry.path === "string" && entry.path.trim() !== "" ? entry.path.trim() : null,
      value: entry.value,
    };
  });
}

export function scimBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string" && /^(true|false)$/i.test(value.trim()))
    return value.trim().toLowerCase() === "true";
  throw new ScimError(400, "invalidValue", "The value must be true or false");
}

export function scimText(value: unknown, field: string, maxLength = 500): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > maxLength) {
    throw new ScimError(400, "invalidValue", `${field} must be text of 1 to ${maxLength} characters`);
  }
  return value.trim();
}

export function listResponse<T>(resources: T[], total: number, startIndex: number) {
  return {
    schemas: [SCIM_SCHEMAS.listResponse],
    totalResults: total,
    itemsPerPage: resources.length,
    startIndex,
    Resources: resources,
  };
}

export function serviceProviderConfig(documentationUri: string) {
  return {
    schemas: [SCIM_SCHEMAS.serviceProviderConfig],
    documentationUri,
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: "oauthbearertoken",
        name: "Bearer token",
        description: "The secret token created in the SCIM tab of the identity provider in Lunedo.",
        primary: true,
      },
    ],
    meta: { resourceType: "ServiceProviderConfig" },
  };
}

export function resourceTypes(base: string) {
  return [
    {
      schemas: [SCIM_SCHEMAS.resourceType],
      id: "User",
      name: "User",
      endpoint: "/Users",
      schema: SCIM_SCHEMAS.user,
      meta: { resourceType: "ResourceType", location: `${base}/ResourceTypes/User` },
    },
    {
      schemas: [SCIM_SCHEMAS.resourceType],
      id: "Group",
      name: "Group",
      endpoint: "/Groups",
      schema: SCIM_SCHEMAS.group,
      meta: { resourceType: "ResourceType", location: `${base}/ResourceTypes/Group` },
    },
  ];
}

function attribute(name: string, type: string, extra: Record<string, unknown> = {}) {
  return {
    name,
    type,
    multiValued: false,
    required: false,
    caseExact: false,
    mutability: "readWrite",
    returned: "default",
    uniqueness: "none",
    ...extra,
  };
}

export function schemaDefinitions(base: string) {
  return [
    {
      schemas: [SCIM_SCHEMAS.schema],
      id: SCIM_SCHEMAS.user,
      name: "User",
      attributes: [
        attribute("userName", "string", { required: true, uniqueness: "server" }),
        attribute("externalId", "string", { caseExact: true }),
        attribute("displayName", "string"),
        attribute("active", "boolean"),
        attribute("name", "complex", {
          subAttributes: [
            attribute("formatted", "string"),
            attribute("givenName", "string"),
            attribute("familyName", "string"),
          ],
        }),
        attribute("emails", "complex", {
          multiValued: true,
          subAttributes: [
            attribute("value", "string"),
            attribute("type", "string"),
            attribute("primary", "boolean"),
          ],
        }),
      ],
      meta: { resourceType: "Schema", location: `${base}/Schemas/${SCIM_SCHEMAS.user}` },
    },
    {
      schemas: [SCIM_SCHEMAS.schema],
      id: SCIM_SCHEMAS.group,
      name: "Group",
      attributes: [
        attribute("displayName", "string", { required: true }),
        attribute("externalId", "string", { caseExact: true }),
        attribute("members", "complex", {
          multiValued: true,
          subAttributes: [
            attribute("value", "string", { mutability: "immutable" }),
            attribute("display", "string"),
          ],
        }),
      ],
      meta: { resourceType: "Schema", location: `${base}/Schemas/${SCIM_SCHEMAS.group}` },
    },
  ];
}
