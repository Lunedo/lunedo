import { Readable } from "node:stream";
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { InternalRoute, Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { decodeCursor, encodeCursor, pageQuery } from "../http/pagination.js";
import { notFound, ProblemException } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import { organizationIdParams, uuid } from "../http/schemas.js";
import {
  acceptSchema,
  candidatesSchema,
  completeUploadSchema,
  confirmationSchema,
  createImportSchema,
  createUploadSchema,
  exampleImport,
  exampleUpload,
  folderSchema,
  importListSchema,
  importSchema,
  macrosSchema,
  reportEntriesSchema,
  reportSchema,
  reviewersSchema,
  updateImportSchema,
  uploadSchema,
} from "./schemas.js";

const TAG = "Imports";
const organization = { type: "organization", param: "organizationId" } as const;
const importResource = { type: "import", param: "importId" } as const;
const importParams = z.object({ importId: uuid("ID of the import.") }).strict();
const uploadParams = organizationIdParams.extend({ uploadId: uuid("ID of the upload.") }).strict();
const partParams = uploadParams
  .extend({
    number: z.coerce.number().int().min(1).max(100_000).describe("Number of the part, starting at 1."),
  })
  .strict();
const partQuery = z
  .object({
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .describe("SHA-256 of the part in hexadecimal. The server refuses the part when it does not match."),
  })
  .strict();
const entriesQuery = z
  .object({
    category: z.string().max(50).optional().describe("Only entries of this area, such as `attachments`."),
    code: z.string().max(50).optional().describe("Only entries of this kind, such as `externalPageLink`."),
    macro: z.string().max(200).optional().describe("Only pages that use the macro with this name."),
    ...pageQuery,
  })
  .strict();
const candidatesQuery = z
  .object({ q: z.string().trim().max(200).default("").describe("Part of the name or e-mail address.") })
  .strict();
const cursorSchema = z.object({ id: z.string() });
const reportCsvExample =
  '"category","code","page","details"\r\n"macros","unsupportedMacro","Alpha","{""name"":""info"",""count"":1}"\r\n';

@Controller("api/v1")
export class ImportsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("organizations/:organizationId/imports")
  @Permission("organization.view", organization)
  @ApiRoute({
    summary: "List imports",
    description:
      "Lists the imports of the organization the caller runs or reviews, and imports that wait for another administrator to take over. Drafts are visible only to their importer.",
    tags: [TAG],
    params: organizationIdParams,
    response: { description: "The imports.", schema: importListSchema, example: [exampleImport] },
  })
  async list(@Param("organizationId") organizationId: string, @Req() request: FastifyRequest) {
    return this.#services.imports.list(actorOf(request), organizationId);
  }

  @Post("organizations/:organizationId/imports")
  @Permission("organization.imports.manage", organization)
  @ApiRoute({
    summary: "Start an import draft",
    description:
      "Creates a draft of an import into a new space. The draft is saved as it is filled in and can be continued later. Only organization administrators import.",
    tags: [TAG],
    params: organizationIdParams,
    body: createImportSchema,
    bodyExample: { source: "confluence-xml" },
    status: 201,
    response: {
      description: "The draft.",
      schema: importSchema,
      example: { ...exampleImport, state: "draft" },
    },
  })
  async create(
    @Param("organizationId") organizationId: string,
    @Body() body: z.output<typeof createImportSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.imports.create(actorOf(request), organizationId, body);
  }

  @Get("organizations/:organizationId/import-folder")
  @Permission("organization.imports.manage", organization)
  @ApiRoute({
    summary: "List the import folder",
    description:
      "Lists the regular files directly inside the import folder of the server. Symbolic links and subfolders are left out.",
    tags: [TAG],
    params: organizationIdParams,
    response: {
      description: "The files.",
      schema: folderSchema,
      example: {
        enabled: true,
        files: [{ name: "export.zip", size: 6871947673, modifiedAt: "2026-10-09T18:00:00.000Z" }],
        maxUploadBytes: 2147483648,
      },
    },
    errors: ["importFolderUnavailable"],
  })
  async folder(@Param("organizationId") organizationId: string, @Req() request: FastifyRequest) {
    return this.#services.imports.listFolder(actorOf(request), organizationId);
  }

  @Get("organizations/:organizationId/import-reviewer-candidates")
  @Permission("organization.imports.manage", organization)
  @InternalRoute()
  @ApiRoute({
    summary: "Find possible reviewers",
    tags: [TAG],
    params: organizationIdParams,
    query: candidatesQuery,
    response: {
      description: "Members.",
      schema: candidatesSchema,
      example: [{ id: exampleImport.id, name: "Robin" }],
    },
  })
  async candidates(
    @Param("organizationId") organizationId: string,
    @Query() query: z.output<typeof candidatesQuery>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.imports.reviewerCandidates(actorOf(request), organizationId, query.q);
  }

  @Post("organizations/:organizationId/import-uploads")
  @Permission("organization.imports.manage", organization)
  @ApiRoute({
    summary: "Start an upload",
    description:
      "Starts uploading an export in parts. Files above the upload limit of the instance are refused before any part is sent; use the import folder for them. An upload that no import uses is deleted after 7 days.",
    tags: [TAG],
    params: organizationIdParams,
    body: createUploadSchema,
    bodyExample: { name: "export.zip", size: 20971520 },
    status: 201,
    response: { description: "The upload.", schema: uploadSchema, example: { ...exampleUpload, parts: [] } },
    errors: ["uploadTooLarge", "invalidFileName", "invalidUpload"],
  })
  async createUpload(
    @Param("organizationId") organizationId: string,
    @Body() body: z.output<typeof createUploadSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.importUploads.create(actorOf(request), organizationId, body);
  }

  async #upload(request: FastifyRequest, organizationId: string, uploadId: string) {
    const upload = await this.#services.importUploads.get(actorOf(request), uploadId);
    if (upload.organizationId !== organizationId) throw notFound();
    return upload;
  }

  @Get("organizations/:organizationId/import-uploads/:uploadId")
  @Permission("organization.imports.manage", organization)
  @ApiRoute({
    summary: "Get an upload",
    description: "Returns the upload with the parts already stored, to continue after a lost connection.",
    tags: [TAG],
    params: uploadParams,
    response: { description: "The upload.", schema: uploadSchema, example: exampleUpload },
  })
  async getUpload(
    @Param("organizationId") organizationId: string,
    @Param("uploadId") uploadId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.#upload(request, organizationId, uploadId);
  }

  @Put("organizations/:organizationId/import-uploads/:uploadId/parts/:number")
  @Permission("organization.imports.manage", organization)
  @ApiRoute({
    summary: "Upload a part",
    description:
      "Stores one part. Send the bytes with `Content-Type: application/octet-stream`. Every part except the last has the part size of the upload. Sending a part again replaces it.",
    tags: [TAG],
    params: partParams,
    query: partQuery,
    upload: { contentTypes: ["application/octet-stream"], description: "The bytes of the part." },
    response: {
      description: "The stored part.",
      schema: z
        .object({
          number: z.number().int().describe("Number of the part."),
          size: z.number().int().describe("Size in bytes."),
        })
        .describe("A stored part."),
      example: { number: 1, size: 16777216 },
    },
    errors: ["invalidUploadPart", "uploadChecksumMismatch", "uploadComplete", "unsupportedMediaType"],
  })
  async putPart(
    @Param("organizationId") organizationId: string,
    @Param("uploadId") uploadId: string,
    @Param("number") number: number,
    @Query() query: z.output<typeof partQuery>,
    @Req() request: FastifyRequest,
  ) {
    const body = request.body as Readable | undefined;
    if (!body || typeof (body as { pipe?: unknown }).pipe !== "function") {
      throw new ProblemException("unsupportedMediaType", "Send the part as application/octet-stream");
    }
    await this.#upload(request, organizationId, uploadId);
    const length = request.headers["content-length"];
    return this.#services.importUploads.putPart(actorOf(request), uploadId, Number(number), {
      body,
      sha256: query.sha256,
      contentLength: length && /^\d+$/.test(length) ? Number(length) : undefined,
    });
  }

  @Post("organizations/:organizationId/import-uploads/:uploadId/complete")
  @Permission("organization.imports.manage", organization)
  @ApiRoute({
    summary: "Complete an upload",
    description:
      "Checks that all parts arrived, reads them again and compares the checksum with the one of the file the caller sent.",
    tags: [TAG],
    params: uploadParams,
    body: completeUploadSchema,
    bodyExample: { sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08" },
    response: {
      description: "The complete upload.",
      schema: uploadSchema,
      example: { ...exampleUpload, complete: true },
    },
    errors: ["uploadIncomplete", "uploadChecksumMismatch"],
  })
  async completeUpload(
    @Param("organizationId") organizationId: string,
    @Param("uploadId") uploadId: string,
    @Body() body: z.output<typeof completeUploadSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#upload(request, organizationId, uploadId);
    return this.#services.importUploads.complete(actorOf(request), uploadId, body);
  }

  @Delete("organizations/:organizationId/import-uploads/:uploadId")
  @Permission("organization.imports.manage", organization)
  @ApiRoute({
    summary: "Delete an upload",
    description: "Deletes an upload that no started import uses.",
    tags: [TAG],
    params: uploadParams,
  })
  async removeUpload(
    @Param("organizationId") organizationId: string,
    @Param("uploadId") uploadId: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#upload(request, organizationId, uploadId);
    await this.#services.importUploads.remove(actorOf(request), uploadId);
  }

  @Get("imports/:importId")
  @Permission(["import.view", "import.takeOver"], importResource)
  @ApiRoute({
    summary: "Get an import",
    description: "Returns the import with its state and progress.",
    tags: [TAG],
    params: importParams,
    response: { description: "The import.", schema: importSchema, example: exampleImport },
  })
  async get(@Param("importId") importId: string, @Req() request: FastifyRequest) {
    return this.#services.imports.get(actorOf(request), importId);
  }

  @Patch("imports/:importId")
  @Permission("import.manage", importResource)
  @ApiRoute({
    summary: "Change an import draft",
    description:
      "Changes what is imported and into which space, until the import starts. Choosing a file starts reading it; the import is `ready` when that is done.",
    tags: [TAG],
    params: importParams,
    body: updateImportSchema,
    bodyExample: { spaceName: "IT Operations", spaceKey: "ITOPS", archived: false },
    response: {
      description: "The import.",
      schema: importSchema,
      example: { ...exampleImport, state: "ready" },
    },
    errors: [
      "importStarted",
      "invalidSpaceName",
      "invalidSpaceKey",
      "invalidSourceUrl",
      "uploadIncomplete",
      "importFolderDisabled",
      "importFileUnavailable",
    ],
  })
  async update(
    @Param("importId") importId: string,
    @Body() body: z.output<typeof updateImportSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.imports.update(actorOf(request), importId, body);
  }

  @Delete("imports/:importId")
  @Permission("import.manage", importResource)
  @ApiRoute({
    summary: "Delete an import draft",
    description: "Deletes an import that has not started. Started imports are stopped or discarded instead.",
    tags: [TAG],
    params: importParams,
    errors: ["importStarted"],
  })
  async remove(@Param("importId") importId: string, @Req() request: FastifyRequest) {
    await this.#services.imports.remove(actorOf(request), importId);
  }

  @Put("imports/:importId/reviewers")
  @Permission("import.manage", importResource)
  @ApiRoute({
    summary: "Set the reviewers of an import",
    description:
      "Replaces the reviewers. Reviewers can read the quarantine space and the report, but cannot accept, discard or stop the import. The change is audited.",
    tags: [TAG],
    params: importParams,
    body: reviewersSchema,
    bodyExample: { accountIds: [exampleImport.reviewers[0]?.id] },
    response: { description: "The import.", schema: importSchema, example: exampleImport },
    errors: ["invalidReviewer", "tooManyReviewers", "importFinished"],
  })
  async reviewers(
    @Param("importId") importId: string,
    @Body() body: z.output<typeof reviewersSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.imports.setReviewers(actorOf(request), importId, body.accountIds);
  }

  @Post("imports/:importId/start")
  @Permission("import.manage", importResource)
  @ApiRoute({
    summary: "Start an import",
    description:
      "Creates the quarantine space and starts importing in the background. Only the importing administrator and the reviewers can see the space until the import is accepted.",
    tags: [TAG],
    params: importParams,
    response: {
      description: "The import.",
      schema: importSchema,
      example: { ...exampleImport, state: "running" },
    },
    errors: ["importNotReady", "importStarted", "keyTaken", "invalidSpaceName", "invalidSpaceKey"],
  })
  async start(@Param("importId") importId: string, @Req() request: FastifyRequest) {
    return this.#services.imports.start(actorOf(request), importId);
  }

  @Post("imports/:importId/stop")
  @Permission("import.manage", importResource)
  @ApiRoute({
    summary: "Stop an import",
    description:
      "Stops a running import and deletes the quarantine space with everything imported so far. Confirm with the key of the space. An uploaded file is kept for 7 days.",
    tags: [TAG],
    params: importParams,
    body: confirmationSchema,
    bodyExample: { confirmation: "ITOPS" },
    response: {
      description: "The import.",
      schema: importSchema,
      example: { ...exampleImport, state: "stopping" },
    },
    errors: ["importNotRunning", "confirmationMismatch"],
  })
  async stop(
    @Param("importId") importId: string,
    @Body() body: z.output<typeof confirmationSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.imports.stop(actorOf(request), importId, body.confirmation);
  }

  @Post("imports/:importId/accept")
  @Permission("import.manage", importResource)
  @ApiRoute({
    summary: "Accept an import",
    description:
      "Turns the quarantine space into a regular space with the given access, archived when the import asked for it. The importing administrator becomes space admin.",
    tags: [TAG],
    params: importParams,
    body: acceptSchema,
    bodyExample: {
      visibility: "organization",
      grants: [{ principalKind: "organizationMembers", principalId: null, role: "editor" }],
    },
    response: {
      description: "The import.",
      schema: importSchema,
      example: { ...exampleImport, state: "accepted" },
    },
    errors: ["importNotInReview", "invalidHolder"],
  })
  async accept(
    @Param("importId") importId: string,
    @Body() body: z.output<typeof acceptSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.imports.accept(actorOf(request), importId, body);
  }

  @Post("imports/:importId/discard")
  @Permission("import.manage", importResource)
  @ApiRoute({
    summary: "Discard an import",
    description:
      "Deletes the quarantine space with everything in it and the report. Confirm with the key of the space. This cannot be undone.",
    tags: [TAG],
    params: importParams,
    body: confirmationSchema,
    bodyExample: { confirmation: "ITOPS" },
    response: {
      description: "The import.",
      schema: importSchema,
      example: { ...exampleImport, state: "discarding" },
    },
    errors: ["importNotInReview", "confirmationMismatch"],
  })
  async discard(
    @Param("importId") importId: string,
    @Body() body: z.output<typeof confirmationSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.imports.discard(actorOf(request), importId, body.confirmation);
  }

  @Post("imports/:importId/take-over")
  @Permission("import.takeOver", importResource)
  @ApiRoute({
    summary: "Take over an import",
    description:
      "Continues an import whose importing administrator lost the permission to import. The caller becomes the importing administrator. The change is audited.",
    tags: [TAG],
    params: importParams,
    response: {
      description: "The import.",
      schema: importSchema,
      example: { ...exampleImport, state: "running" },
    },
    errors: ["importNotHeld"],
  })
  async takeOver(@Param("importId") importId: string, @Req() request: FastifyRequest) {
    return this.#services.imports.takeOver(actorOf(request), importId);
  }

  @Get("imports/:importId/report")
  @Permission("import.view", importResource)
  @ApiRoute({
    summary: "Get the report of an import",
    description: "Counts the report entries per kind.",
    tags: [TAG],
    params: importParams,
    response: {
      description: "The summary.",
      schema: reportSchema,
      example: { categories: [{ category: "macros", code: "unsupportedMacro", count: 3 }], total: 3 },
    },
    errors: ["reportUnavailable"],
  })
  async report(@Param("importId") importId: string, @Req() request: FastifyRequest) {
    return this.#services.imports.report(actorOf(request), importId);
  }

  @Get("imports/:importId/report/entries")
  @Permission("import.view", importResource)
  @ApiRoute({
    summary: "List report entries",
    description: "Lists the problems found during the import, each with the affected page.",
    tags: [TAG],
    params: importParams,
    query: entriesQuery,
    response: {
      description: "A page of entries.",
      schema: reportEntriesSchema,
      example: {
        items: [
          {
            id: exampleImport.id,
            category: "attachments",
            code: "missingAttachment",
            item: { id: exampleImport.organizationId, title: "Network overview" },
            details: { fileName: "diagram.png" },
          },
        ],
        nextCursor: null,
      },
    },
    errors: ["reportUnavailable"],
  })
  async entries(
    @Param("importId") importId: string,
    @Query() query: z.output<typeof entriesQuery>,
    @Req() request: FastifyRequest,
  ) {
    const cursor = decodeCursor(query.cursor, cursorSchema);
    const page = await this.#services.imports.entries(actorOf(request), importId, {
      category: query.category,
      code: query.code,
      macro: query.macro,
      after: cursor?.id,
      limit: query.limit,
    });
    return { items: page.entries, nextCursor: page.next ? encodeCursor({ id: page.next }) : null };
  }

  @Get("imports/:importId/report/macros")
  @Permission("import.view", importResource)
  @ApiRoute({
    summary: "List the macros of an import",
    description: "Lists the macros kept with their original data, with the number of pages that use them.",
    tags: [TAG],
    params: importParams,
    response: {
      description: "The macros.",
      schema: macrosSchema,
      example: [{ name: "info", pages: 12, occurrences: 30 }],
    },
    errors: ["reportUnavailable"],
  })
  async macros(@Param("importId") importId: string, @Req() request: FastifyRequest) {
    return this.#services.imports.macros(actorOf(request), importId);
  }

  @Get("imports/:importId/report/export")
  @Permission("import.view", importResource)
  @ApiRoute({
    summary: "Export the report as CSV",
    description:
      "Streams all report entries as CSV. Cells that start with a formula character are prefixed with an apostrophe.",
    tags: [TAG],
    params: importParams,
    raw: {
      contentTypes: ["text/csv"],
      description: "The entries as CSV with a header row.",
      example: reportCsvExample,
    },
    errors: ["reportUnavailable"],
  })
  async exportReport(
    @Param("importId") importId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const rows = this.#services.imports.reportCsv(actorOf(request), importId);
    const first = await rows.next();
    reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", 'attachment; filename="import-report.csv"')
      .header("cache-control", "no-store");
    return Readable.from(
      (async function* () {
        if (!first.done) yield first.value;
        yield* rows;
      })(),
    );
  }
}
