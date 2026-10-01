import { Readable } from "node:stream";
import { Controller, Get, Inject, Param, Query, Req, Res } from "@nestjs/common";
import type { AuditEntry, AuditFilter } from "@pagehall/server";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { decodeCursor, encodeCursor, pageQuery, pageSchema } from "../http/pagination.js";
import { actorOf } from "../http/request.js";
import {
  auditEntrySchema,
  exampleAuditEntry,
  inputTimestamp,
  organizationIdParams,
  uuid,
} from "../http/schemas.js";

const TAG = "Audit log";
const organization = { type: "organization", param: "organizationId" } as const;

const filterShape = {
  from: inputTimestamp("Only events at or after this time.").optional(),
  to: inputTimestamp("Only events before this time.").optional(),
  actorId: uuid("Only events of this account.").optional(),
  targetType: z
    .string()
    .max(100)
    .optional()
    .describe("Only events about this kind of object, for example `group`."),
  targetId: z
    .string()
    .max(200)
    .optional()
    .describe("Only events about this object. Combine it with `targetType`."),
  name: z.string().max(100).optional().describe("Only events of this type, for example `role.assigned`."),
};

const instanceFilter = z
  .object({ ...filterShape, organizationId: uuid("Only events of this organization.").optional() })
  .strict();
const instanceListQuery = instanceFilter.extend(pageQuery);
const organizationFilter = z.object(filterShape).strict();
const organizationListQuery = organizationFilter.extend(pageQuery);

const cursorSchema = z.object({ occurredAt: z.iso.datetime(), id: z.uuid() });
const auditPage = pageSchema(auditEntrySchema, "Events, newest first.");
const pageExample = { items: [exampleAuditEntry], nextCursor: null };

const CSV_COLUMNS = [
  "occurredAt",
  "name",
  "scopeType",
  "scopeId",
  "actorType",
  "actorId",
  "targetType",
  "targetId",
  "fields",
  "clientIp",
  "userAgent",
  "requestId",
  "sequence",
  "id",
] as const;

const csvExample = `${CSV_COLUMNS.join(",")}\r\n"2026-10-01T08:00:00.000Z","role.assigned","organization",...\r\n`;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text =
    value instanceof Date
      ? value.toISOString()
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function csvRow(entry: AuditEntry): string {
  return `${CSV_COLUMNS.map((column) => csvCell(entry[column])).join(",")}\r\n`;
}

function toFilter(query: z.output<typeof instanceFilter>, organizationId?: string): AuditFilter {
  const scopeId = organizationId ?? query.organizationId;
  return {
    ...(scopeId ? { scope: { type: "organization" as const, id: scopeId } } : {}),
    ...(query.from ? { from: query.from } : {}),
    ...(query.to ? { to: query.to } : {}),
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(query.targetType ? { targetType: query.targetType } : {}),
    ...(query.targetId ? { targetId: query.targetId } : {}),
    ...(query.name ? { name: query.name } : {}),
  };
}

@Controller("api/v1")
export class AuditController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  async #list(
    request: FastifyRequest,
    filter: AuditFilter,
    query: { cursor?: string | undefined; limit: number },
  ) {
    const cursor = decodeCursor(query.cursor, cursorSchema);
    const page = await this.#services.auditReader.list(actorOf(request), filter, {
      limit: query.limit,
      ...(cursor ? { cursor: { occurredAt: new Date(cursor.occurredAt), id: cursor.id } } : {}),
    });
    return {
      items: page.items,
      nextCursor: page.next
        ? encodeCursor({ occurredAt: page.next.occurredAt.toISOString(), id: page.next.id })
        : null,
    };
  }

  async #export(request: FastifyRequest, reply: FastifyReply, filter: AuditFilter) {
    const entries = await this.#services.auditReader.export(actorOf(request), filter);
    reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="audit-log.csv"')
      .header("cache-control", "no-store");
    return Readable.from(
      (async function* () {
        yield `${CSV_COLUMNS.join(",")}\r\n`;
        for await (const entry of entries) yield csvRow(entry);
      })(),
    );
  }

  @Get("instance/audit-events")
  @Permission("instance.audit.view")
  @ApiRoute({
    summary: "List audit events of the instance",
    description:
      "Lists events of the instance and of all organizations, newest first, with optional filters.",
    tags: [TAG],
    query: instanceListQuery,
    response: { description: "A page of events.", schema: auditPage, example: pageExample },
  })
  async listInstance(@Req() request: FastifyRequest, @Query() query: z.output<typeof instanceListQuery>) {
    return this.#list(request, toFilter(query), query);
  }

  @Get("instance/audit-events/export")
  @Permission("instance.audit.view")
  @ApiRoute({
    summary: "Export audit events of the instance as CSV",
    description:
      "Streams all events that match the filters as CSV, newest first. The export itself is recorded in the audit log. Cells that start with a formula character are prefixed with an apostrophe.",
    tags: [TAG],
    query: instanceFilter,
    raw: {
      contentTypes: ["text/csv"],
      description: "The events as CSV with a header row.",
      example: csvExample,
    },
  })
  async exportInstance(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Query() query: z.output<typeof instanceFilter>,
  ) {
    return this.#export(request, reply, toFilter(query));
  }

  @Get("organizations/:organizationId/audit-events")
  @Permission("organization.audit.view", organization)
  @ApiRoute({
    summary: "List audit events of an organization",
    description: "Lists events of the organization, newest first, with optional filters.",
    tags: [TAG],
    params: organizationIdParams,
    query: organizationListQuery,
    response: { description: "A page of events.", schema: auditPage, example: pageExample },
  })
  async listOrganization(
    @Req() request: FastifyRequest,
    @Param("organizationId") organizationId: string,
    @Query() query: z.output<typeof organizationListQuery>,
  ) {
    return this.#list(request, toFilter(query, organizationId), query);
  }

  @Get("organizations/:organizationId/audit-events/export")
  @Permission("organization.audit.view", organization)
  @ApiRoute({
    summary: "Export audit events of an organization as CSV",
    description:
      "Streams all events of the organization that match the filters as CSV, newest first. The export itself is recorded in the audit log.",
    tags: [TAG],
    params: organizationIdParams,
    query: organizationFilter,
    raw: {
      contentTypes: ["text/csv"],
      description: "The events as CSV with a header row.",
      example: csvExample,
    },
  })
  async exportOrganization(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Param("organizationId") organizationId: string,
    @Query() query: z.output<typeof organizationFilter>,
  ) {
    return this.#export(request, reply, toFilter(query, organizationId));
  }
}
