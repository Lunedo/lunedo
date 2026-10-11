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
import { MAX_USER_LIST_BYTES } from "@pagehall/server";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { InternalRoute, Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { decodeCursor, encodeCursor, pageQuery, pageQuerySchema } from "../http/pagination.js";
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
  importGroupSchema,
  importGroupsSchema,
  importListSchema,
  importSchema,
  macrosSchema,
  mapGroupSchema,
  mappingsSchema,
  peopleSourceSchema,
  permissionEntriesSchema,
  placeholdersSchema,
  proposedAccessSchema,
  reportEntriesSchema,
  reportSchema,
  reviewersSchema,
  updateImportSchema,
  uploadSchema,
  userListResultSchema,
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
const offsetCursorSchema = z.object({ offset: z.number().int().min(0).max(1_000_000) });
const groupParams = importParams
  .extend({ groupKey: z.string().min(1).max(255).describe("Lower-case name of the group in Confluence.") })
  .strict();
const peopleQuery = z
  .object({
    q: z.string().trim().max(200).optional().describe("Part of the name, e-mail address or Atlassian ID."),
    ...pageQuery,
  })
  .strict();

async function csvBody(request: FastifyRequest): Promise<string> {
  const body = request.body as Readable | undefined;
  if (!body || typeof (body as { pipe?: unknown }).pipe !== "function") {
    throw new ProblemException("unsupportedMediaType", "Send the user list as text/csv");
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_USER_LIST_BYTES) {
      body.destroy();
      throw new ProblemException("userListTooLarge", "The user list is larger than 10 MB.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
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
      "Lists the regular files directly inside this organization's subfolder of the import folder on the server, named after the organization's slug. Symbolic links, hidden files and further subfolders are left out; files of other organizations and at the top level are never offered.",
    tags: [TAG],
    params: organizationIdParams,
    response: {
      description: "The files.",
      schema: folderSchema,
      example: {
        enabled: true,
        path: "/data/import/acme",
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
      example: {
        categories: [{ category: "macros", code: "unsupportedMacro", count: 3 }],
        total: 3,
        placeholders: 13,
        mapped: 2,
        permissionsToCheck: 6,
        groupsMissing: 1,
      },
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
            restricted: false,
            template: null,
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
    return {
      items: page.entries.map(({ item, ...entry }) => ({
        ...entry,
        item: item?.title == null ? null : { id: item.id, title: item.title },
        restricted: item !== null && item.title === null,
      })),
      nextCursor: page.next ? encodeCursor({ id: page.next }) : null,
    };
  }

  @Put("imports/:importId/people-source")
  @Permission("import.manage", importResource)
  @ApiRoute({
    summary: "Choose how people are recognized",
    description:
      "Sets the user source of an import draft. With `token`, Pagehall checks the read-only Atlassian API token against the given site at once, stores it encrypted, uses it only while the import runs and deletes it when the import is accepted, discarded, stopped or fails. Only `https` sites under `atlassian.net` or hosts the instance administrator allowed are contacted. With `skip`, every author becomes a placeholder. A user list is sent to `people-source/user-list`.",
    tags: [TAG],
    params: importParams,
    body: peopleSourceSchema,
    bodyExample: {
      kind: "token",
      site: "example.atlassian.net",
      email: "alex@example.com",
      token: "ATATT3x…",
    },
    response: { description: "The import.", schema: importSchema, example: exampleImport },
    errors: [
      "importStarted",
      "invalidAtlassianSite",
      "invalidAtlassianEmail",
      "invalidAtlassianToken",
      "atlassianUnauthorized",
      "atlassianUnreachable",
      "atlassianRateLimited",
      "skipNotConfirmed",
    ],
  })
  async peopleSource(
    @Param("importId") importId: string,
    @Body() body: z.output<typeof peopleSourceSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.imports.setPeopleSource(actorOf(request), importId, body);
  }

  @Put("imports/:importId/people-source/user-list")
  @Permission("import.manage", importResource)
  @ApiRoute({
    summary: "Use a user list to recognize people",
    description:
      "Sets a user list exported from the Atlassian administration (admin.atlassian.com › Directory › Users › Export users) as the user source of an import draft. Send the CSV file with `Content-Type: text/csv`, up to 10 MB. People are matched by e-mail address only.",
    tags: [TAG],
    params: importParams,
    upload: { contentTypes: ["text/csv"], description: "The user list as CSV with a header row." },
    response: { description: "The import.", schema: importSchema, example: exampleImport },
    errors: ["importStarted", "userListInvalid", "userListTooLarge", "unsupportedMediaType"],
  })
  async peopleSourceList(@Param("importId") importId: string, @Req() request: FastifyRequest) {
    const userList = await csvBody(request);
    return this.#services.imports.setPeopleSource(actorOf(request), importId, { kind: "list", userList });
  }

  @Get("imports/:importId/people")
  @Permission("import.view", importResource)
  @ApiRoute({
    summary: "List the placeholders of an import",
    description:
      "Lists the people of the export who became placeholders, with the content they own, the account they were mapped to and members with a similar name. Similar names are only offered; nobody is mapped by name automatically.",
    tags: [TAG],
    params: importParams,
    query: peopleQuery,
    response: {
      description: "A page of placeholders.",
      schema: placeholdersSchema,
      example: {
        items: [
          {
            id: exampleImport.id,
            name: "J. Weber",
            externalId: "557058:4f1c0000-0000-0000-0000-000000000000",
            email: null,
            named: true,
            items: 14,
            comments: 31,
            restrictedPages: 0,
            spaceRole: "editor",
            mappedTo: null,
            candidates: [{ id: exampleImport.importer.id, name: "Jana Weber" }],
          },
        ],
        total: 13,
        mapped: 0,
        nextCursor: null,
      },
    },
    errors: ["reportUnavailable"],
  })
  async people(
    @Param("importId") importId: string,
    @Query() query: z.output<typeof peopleQuery>,
    @Req() request: FastifyRequest,
  ) {
    const offset = decodeCursor(query.cursor, offsetCursorSchema)?.offset ?? 0;
    const page = await this.#services.imports.resolution.people(actorOf(request), importId, {
      q: query.q,
      offset,
      limit: query.limit,
    });
    return {
      items: page.people,
      total: page.total,
      mapped: page.mapped,
      nextCursor: page.next === null ? null : encodeCursor({ offset: page.next }),
    };
  }

  @Post("imports/:importId/people/mappings")
  @Permission("import.resolve", importResource)
  @ApiRoute({
    summary: "Map placeholders to accounts",
    description:
      "Maps one or more placeholders to accounts of the organization. Authorship, comments, mentions, tasks, reactions and places on page restrictions move to the account in one step. Before accepting, only the person who started the import can map; after accepting, every organization administrator who manages imports. Roles the person had in the Confluence space apply when the import is accepted. Nobody is notified. A mapping cannot be undone. A placeholder that holds access to pages or the space cannot be mapped to the caller's own account.",
    tags: [TAG],
    params: importParams,
    body: mappingsSchema,
    bodyExample: { mappings: [{ placeholderId: exampleImport.id, accountId: exampleImport.importer.id }] },
    response: {
      description: "How many placeholders were mapped.",
      schema: z
        .object({ mapped: z.number().int().describe("Number of mapped placeholders.") })
        .describe("Result."),
      example: { mapped: 1 },
    },
    errors: [
      "importNotResolvable",
      "notPlaceholder",
      "invalidMapping",
      "invalidMappingTarget",
      "selfExtension",
    ],
  })
  async mapPeople(
    @Param("importId") importId: string,
    @Body() body: z.output<typeof mappingsSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.imports.resolution.mapPeople(actorOf(request), importId, body.mappings);
  }

  @Post("imports/:importId/people/user-list")
  @Permission("import.resolve", importResource)
  @ApiRoute({
    summary: "Resolve placeholders with a user list",
    description:
      "Reads a user list exported from the Atlassian administration and maps every remaining placeholder whose e-mail address belongs to a member of the organization. Placeholders without a match get the name from the list. Works before and after accepting, with the same permission as mapping placeholders. Send the CSV with `Content-Type: text/csv`, up to 10 MB.",
    tags: [TAG],
    params: importParams,
    upload: { contentTypes: ["text/csv"], description: "The user list as CSV with a header row." },
    response: {
      description: "What the list resolved.",
      schema: userListResultSchema,
      example: { matched: 9, named: 3, remaining: 4 },
    },
    errors: ["importNotResolvable", "userListInvalid", "userListTooLarge", "unsupportedMediaType"],
  })
  async userList(@Param("importId") importId: string, @Req() request: FastifyRequest) {
    const text = await csvBody(request);
    return this.#services.imports.resolution.uploadUserList(actorOf(request), importId, text);
  }

  @Get("imports/:importId/groups")
  @Permission("import.view", importResource)
  @ApiRoute({
    summary: "List the groups of an import",
    description:
      "Lists the Confluence groups named in space permissions and page restrictions, and the group of the organization each is mapped to. Groups are matched by name, including synchronized groups; nothing is created automatically.",
    tags: [TAG],
    params: importParams,
    response: {
      description: "The groups.",
      schema: importGroupsSchema,
      example: [
        { key: "contractors", name: "contractors", group: null, spaceRole: "reader", restrictedPages: 2 },
      ],
    },
    errors: ["reportUnavailable"],
  })
  async groups(@Param("importId") importId: string, @Req() request: FastifyRequest) {
    return this.#services.imports.resolution.groups(actorOf(request), importId);
  }

  @Put("imports/:importId/groups/:groupKey")
  @Permission("import.resolve", importResource)
  @ApiRoute({
    summary: "Map a group of an import",
    description:
      "Maps a Confluence group to an existing group of the organization, or creates a local group with its name (this needs the permission to create groups). The group takes its place on page restrictions at once; restrictions only narrow access, so its members still need a role in the space. Its space role applies when the import is accepted. Nobody is notified.",
    tags: [TAG],
    params: groupParams,
    body: mapGroupSchema,
    bodyExample: { create: true },
    response: {
      description: "The group.",
      schema: importGroupSchema,
      example: {
        key: "contractors",
        name: "contractors",
        group: { id: exampleImport.id, name: "contractors" },
        spaceRole: "reader",
        restrictedPages: 2,
      },
    },
    errors: ["importNotResolvable", "groupNotFound", "groupAlreadyMapped", "groupNameTaken", "forbidden"],
  })
  async mapGroup(
    @Param("importId") importId: string,
    @Param("groupKey") groupKey: string,
    @Body() body: z.output<typeof mapGroupSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.imports.resolution.mapGroup(actorOf(request), importId, groupKey, body);
  }

  @Get("imports/:importId/permissions")
  @Permission("import.view", importResource)
  @ApiRoute({
    summary: "List the permissions of an import",
    description:
      "Lists the space permissions and page restrictions taken from Confluence: the role each person or group gets, and the entries that need attention. Anonymous access is never taken over. Titles of pages the caller cannot read are left out.",
    tags: [TAG],
    params: importParams,
    query: pageQuerySchema,
    response: {
      description: "A page of entries.",
      schema: permissionEntriesSchema,
      example: {
        items: [
          {
            id: exampleImport.id,
            scope: "space",
            item: null,
            restriction: null,
            holder: { kind: "group", id: null, name: null, sourceName: "contractors" },
            role: "reader",
            permissions: ["VIEWSPACE"],
            status: "missing",
            code: "groupMissing",
          },
        ],
        nextCursor: null,
      },
    },
    errors: ["reportUnavailable"],
  })
  async permissions(
    @Param("importId") importId: string,
    @Query() query: z.output<typeof pageQuerySchema>,
    @Req() request: FastifyRequest,
  ) {
    const cursor = decodeCursor(query.cursor, cursorSchema);
    const page = await this.#services.imports.resolution.permissions(actorOf(request), importId, {
      after: cursor?.id,
      limit: query.limit,
    });
    return { items: page.entries, nextCursor: page.next ? encodeCursor({ id: page.next }) : null };
  }

  @Get("imports/:importId/proposed-access")
  @Permission("import.view", importResource)
  @ApiRoute({
    summary: "Get the imported access",
    description:
      "Returns who gets access when the import is accepted, as taken from Confluence. The accept dialog shows it instead of the organization defaults, and the administrator can change it before accepting.",
    tags: [TAG],
    params: importParams,
    response: {
      description: "The imported access.",
      schema: proposedAccessSchema,
      example: {
        visibility: "organization",
        grants: [{ principalKind: "organizationMembers", principalId: null, role: "commenter", name: null }],
        pending: 2,
      },
    },
    errors: ["reportUnavailable"],
  })
  async proposedAccess(@Param("importId") importId: string, @Req() request: FastifyRequest) {
    return this.#services.imports.resolution.proposal(actorOf(request), importId);
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
