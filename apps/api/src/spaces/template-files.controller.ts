import type { Readable } from "node:stream";
import { Body, Controller, Delete, Get, Inject, Param, Post, Query, Req, Res } from "@nestjs/common";
import {
  type AttachmentContent,
  contentDisposition,
  type ExportSource,
  FILE_NAME_MAX_LENGTH,
  MAX_TEMPLATES_PER_UPLOAD,
  type TemplateExport,
  type TemplateLanguage,
  type TemplateScope,
  templateLanguages,
  templateRemovalKinds,
} from "@pagehall/server";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { FILE_CONTENT_SECURITY_POLICY, sendAttachment } from "../files/serve.js";
import { ApiRoute } from "../http/api-route.js";
import { notFound, ProblemException } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import { uuid } from "../http/schemas.js";
import { documentSchema } from "./schemas.js";
import {
  categorySchema,
  exampleTemplate,
  fieldSchema,
  seriesDefaultsResponse,
  templateSchema,
} from "./templates.controller.js";

const TAG = "Templates";
const space = { type: "space", param: "spaceId" } as const;
const organization = { type: "organization", param: "organizationId" } as const;
const instance = { type: "instance" } as const;

const spaceParams = z.object({ spaceId: uuid("ID of the space.") }).strict();
const organizationParams = z.object({ organizationId: uuid("ID of the organization.") }).strict();
const templateId = uuid("ID of the template.");
const fileId = uuid("ID of the file.");
const importId = uuid("ID of the import preview.");
const spaceTemplateParams = spaceParams.extend({ templateId });
const spaceFileParams = spaceTemplateParams.extend({ fileId });
const spaceImportParams = spaceParams.extend({ importId });
const spaceImportFileParams = spaceImportParams.extend({ fileId });
const organizationTemplateParams = organizationParams.extend({ templateId });
const organizationFileParams = organizationTemplateParams.extend({ fileId });
const organizationImportParams = organizationParams.extend({ importId });
const organizationImportFileParams = organizationImportParams.extend({ fileId });
const instanceTemplateParams = z.object({ templateId }).strict();
const instanceFileParams = instanceTemplateParams.extend({ fileId });
const instanceImportParams = z.object({ importId }).strict();
const instanceImportFileParams = instanceImportParams.extend({ fileId });

const nameQuery = z
  .object({
    name: z
      .string()
      .min(1)
      .max(FILE_NAME_MAX_LENGTH * 4)
      .describe("Name of the uploaded file. Paths and control characters are removed."),
  })
  .strict();

const pageQuery = z.object({ pageId: uuid("The page to save as a template.") }).strict();

const templateFileSchema = z
  .object({
    id: uuid(
      "ID of the file. Content of the template refers to it, for example as `attachmentId` of an image.",
    ),
    templateId: uuid("ID of the template."),
    name: z.string().describe("File name."),
    size: z.number().int().describe("Size in bytes."),
    contentType: z.string().describe("Media type, decided from the content."),
  })
  .describe("A file of a template.");

const exampleFile = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a91",
  templateId: exampleTemplate.id,
  name: "rollout.png",
  size: 48213,
  contentType: "image/png",
};

const removedSchema = z
  .partialRecord(z.enum(templateRemovalKinds), z.number().int())
  .describe(
    "What is removed because it cannot work in another instance, by kind: `pageLink` (links to pages and spaces), `mention`, `include`, `diagramReference`, `whiteboard`, `templateButton`, `report`, `roadmap`, `person`, `comment`, `meetingTopic`, `file` (files that are not part of the template or not images) and `unsupportedMacro`.",
  );

const exportSelection = z
  .object({
    templateIds: z
      .array(uuid("ID of a template."))
      .min(1)
      .max(MAX_TEMPLATES_PER_UPLOAD)
      .nullable()
      .default(null)
      .describe(`The templates to export; null for all of this level, at most ${MAX_TEMPLATES_PER_UPLOAD}.`),
  })
  .strict()
  .describe("Which templates to export.");

const builtInSelection = z
  .object({
    language: z.enum(templateLanguages).describe("Language of the exported built-in templates."),
    templateIds: z
      .array(
        z
          .string()
          .regex(/^builtin:[a-z][a-z0-9-]{0,63}$/)
          .describe("ID of a built-in template."),
      )
      .min(1)
      .max(MAX_TEMPLATES_PER_UPLOAD)
      .nullable()
      .default(null)
      .describe("The built-in templates to export, such as `builtin:how-to`; null for all."),
  })
  .strict()
  .describe("Which built-in templates to export, and in which language.");

const exportSummarySchema = z
  .object({
    templates: z
      .array(
        z
          .object({
            name: z.string().describe("Name of the template."),
            files: z.number().int().describe("Number of files in the export."),
            removed: removedSchema,
          })
          .describe("A template of the export."),
      )
      .describe("The templates in the order of the file."),
  })
  .describe("What an export will contain.");

const exampleSummary = {
  templates: [{ name: "Change request", files: 1, removed: { pageLink: 2, mention: 1 } }],
};

const importedTemplateSchema = z
  .object({
    index: z.number().int().describe("Position in the file, counted from 0."),
    name: z.string().describe("Name of the template, or `#n` when the file gives none."),
    description: z.string().describe("Short description."),
    category: categorySchema.nullable(),
    language: z.enum(templateLanguages).nullable().describe("Language the file states, or null."),
    title: z.string().describe("Title pattern of new pages."),
    fields: z.array(fieldSchema).describe("Input fields."),
    series: seriesDefaultsResponse.nullable().describe("Series defaults, or null."),
    document: documentSchema.nullable().describe("Content as it will be saved, or null if it is not valid."),
    files: z
      .array(
        z
          .object({
            id: uuid("ID of the file; the preview content refers to it."),
            name: z.string().describe("File name."),
            mediaType: z.string().describe("Media type."),
            size: z.number().int().describe("Size in bytes after the safety checks."),
          })
          .describe("A file of the template."),
      )
      .describe("Files the content uses."),
    removed: removedSchema,
    blockedEmbeds: z
      .array(z.string().describe("Address of an embed."))
      .describe("Embeds this instance does not allow; they stay in the content and show as links."),
    problems: z
      .array(
        z
          .object({
            place: z.string().nullable().describe("Where, such as `field 3` or `content`."),
            message: z.string().describe("Explanation naming the template and the place."),
          })
          .describe("A problem."),
      )
      .describe("Why the template cannot be imported; empty when it can."),
    valid: z.boolean().describe("Whether the template can be imported."),
    conflict: z
      .object({
        templateId: uuid("The template with the same name at this level."),
        suggestedName: z.string().describe("A new name to use instead, in the caller's language."),
      })
      .nullable()
      .describe("A template with the same name at this level, or null."),
  })
  .describe("A template of the uploaded file.");

const importPreviewSchema = z
  .object({
    id: uuid("ID of the preview; confirm or discard it with this ID."),
    fileName: z.string().describe("Name of the uploaded file."),
    templates: z.array(importedTemplateSchema).describe("The templates of the file."),
    expiresAt: z.iso.datetime().describe("When the preview is discarded."),
  })
  .describe("What an import will create. Nothing is saved before it is confirmed.");

const examplePreview = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5aa0",
  fileName: "change-request.pagehall-template.zip",
  templates: [
    {
      index: 0,
      name: "Change request",
      description: "Planned change with risk and rollback",
      category: "operations",
      language: "en",
      title: "Change {name}",
      fields: exampleTemplate.fields,
      series: null,
      document: exampleTemplate.document,
      files: [{ id: exampleFile.id, name: "rollout.png", mediaType: "image/png", size: 48213 }],
      removed: {},
      blockedEmbeds: [],
      problems: [],
      valid: true,
      conflict: { templateId: exampleTemplate.id, suggestedName: "Change request (imported)" },
    },
  ],
  expiresAt: "2026-10-18T20:00:00.000Z",
};

const confirmSchema = z
  .object({
    decisions: z
      .array(
        z
          .object({
            index: z.number().int().min(0).max(MAX_TEMPLATES_PER_UPLOAD).describe("Position in the file."),
            action: z
              .enum(["create", "replace", "skip"])
              .describe(
                "`create` a new template, `replace` the template with the same name (it keeps its ID), or `skip` it.",
              ),
            name: z
              .string()
              .max(200)
              .optional()
              .describe("Name of a new template; default: the name in the file."),
          })
          .strict()
          .describe("What to do with one template."),
      )
      .max(MAX_TEMPLATES_PER_UPLOAD)
      .default([])
      .describe("Decisions per template. Templates without a decision are created under their own name."),
    skipInvalid: z
      .boolean()
      .default(false)
      .describe(
        "Import the valid templates when others in the file are not valid. Without it, nothing is imported.",
      ),
  })
  .strict()
  .describe("Confirms an import preview.");

const importResultSchema = z
  .object({
    created: z.array(templateSchema).describe("Templates created."),
    replaced: z.array(templateSchema).describe("Templates replaced; they keep their IDs."),
    skipped: z.number().int().describe("Templates not imported."),
  })
  .describe("The result of an import.");

const rawImage = {
  contentTypes: ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml", "*/*"],
  ranges: true,
  description:
    "The file. Sent with `Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff`; ranges are supported.",
  example: "",
};

const rawTemplateFile = {
  contentTypes: ["application/json", "application/zip"],
  description:
    "A template file: JSON for templates without files, otherwise a ZIP archive with `template.json` and the files under `files/`.",
  example: '{\n  "format": "pagehall-template",\n  "formatVersion": 1\n}\n',
};

const importErrors = [
  "busy",
  "uploadTimeout",
  "fileTooLarge",
  "invalidTemplateFile",
  "newerTemplateFormat",
  "tooManyTemplates",
  "tooManyTemplateFiles",
  "templateArchiveTooLarge",
  "templateArchiveCompression",
  "unsafeTemplateArchive",
  "nestedTemplateArchive",
  "unexpectedTemplateEntry",
  "unsupportedMediaType",
  "storageFull",
] as const;
const confirmErrors = [
  "templateImportNotFound",
  "invalidTemplatesInFile",
  "templateNameTaken",
  "templateNotFound",
  "invalidTemplateName",
  "storageFull",
] as const;
const exportErrors = [
  "noTemplates",
  "tooManyTemplates",
  "templateExportTooLarge",
  "templateNotFound",
] as const;

function bodyOf(request: FastifyRequest): Readable {
  const body = request.body as Readable | undefined;
  if (!body || typeof (body as { pipe?: unknown }).pipe !== "function") {
    throw new ProblemException("unsupportedMediaType", "Send the file as application/octet-stream");
  }
  return body;
}

function lengthOf(request: FastifyRequest): number | undefined {
  const length = request.headers["content-length"];
  return length && /^\d+$/.test(length) ? Number(length) : undefined;
}

function sendExport(reply: FastifyReply, file: TemplateExport) {
  reply.header("content-type", file.contentType);
  reply.header("content-disposition", contentDisposition("attachment", file.fileName));
  reply.header("x-content-type-options", "nosniff");
  reply.header("content-security-policy", FILE_CONTENT_SECURITY_POLICY);
  reply.header("cache-control", "private, no-store");
  reply.header("content-length", String(file.body.length));
  return file.body;
}

function pagehallVersion(): string {
  return process.env.PAGEHALL_VERSION ?? "dev";
}

@Controller("api/v1")
export class TemplateFilesController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  async #owned(templateId: string, scope: TemplateScope): Promise<void> {
    const found = await this.#services.templates.scopeOf(templateId);
    if (!found || JSON.stringify(found) !== JSON.stringify(scope)) throw notFound();
  }

  async #upload(request: FastifyRequest, scope: TemplateScope, templateId: string, name: string) {
    const body = bodyOf(request);
    try {
      await this.#owned(templateId, scope);
    } catch (error) {
      body.resume();
      throw error;
    }
    return this.#services.templates.files.upload(actorOf(request), templateId, {
      name,
      body,
      contentLength: lengthOf(request),
    });
  }

  async #file(
    request: FastifyRequest,
    reply: FastifyReply,
    scope: TemplateScope,
    templateId: string,
    fileId: string,
  ) {
    await this.#owned(templateId, scope);
    return this.#send(request, reply, await this.#services.templates.files.content(templateId, fileId));
  }

  async #send(
    request: FastifyRequest,
    reply: FastifyReply,
    content: AttachmentContent | null,
    staged = false,
  ) {
    if (!content) throw notFound();
    return sendAttachment(request, reply, this.#services.files, content, {
      inline: true,
      crossOrigin: false,
      staged,
    });
  }

  async #summary(source: ExportSource, templateIds: string[] | null) {
    return { templates: await this.#services.templateTransfers.exportSummary(source, templateIds) };
  }

  async #export(
    request: FastifyRequest,
    reply: FastifyReply,
    source: ExportSource,
    templateIds: string[] | null,
  ) {
    const file = await this.#services.templateTransfers.exportTemplates(
      actorOf(request),
      source,
      templateIds,
      pagehallVersion(),
    );
    return sendExport(reply, file);
  }

  #preview(request: FastifyRequest, scope: TemplateScope, fileName: string) {
    return this.#services.templateTransfers.preview(actorOf(request), scope, {
      fileName,
      body: bodyOf(request),
      contentLength: lengthOf(request),
    });
  }

  async #importFile(
    request: FastifyRequest,
    reply: FastifyReply,
    scope: TemplateScope,
    id: string,
    file: string,
  ) {
    const content = await this.#services.templateTransfers.fileContent(actorOf(request), scope, id, file);
    return this.#send(request, reply, content, true);
  }

  #confirm(request: FastifyRequest, scope: TemplateScope, id: string, body: z.output<typeof confirmSchema>) {
    return this.#services.templateTransfers.confirm(actorOf(request), scope, id, body);
  }

  @Get("spaces/:spaceId/templates/from-page/files")
  @Permission("space.edit", space)
  @ApiRoute({
    summary: "Check the files a page would give a template",
    description:
      "Tells how many files of the page a new template would take over, and whether the page is restricted. Files of a restricted page become visible to everyone who can use the template.",
    tags: [TAG],
    params: spaceParams,
    query: pageQuery,
    response: {
      description: "Files and restriction of the page.",
      schema: z
        .object({
          files: z.number().int().describe("Files the template would take over."),
          restricted: z.boolean().describe("Whether the page or a page above it has a view restriction."),
        })
        .describe("What saving the page as a template would share."),
      example: { files: 2, restricted: true },
    },
  })
  async pageFiles(
    @Param("spaceId") spaceId: string,
    @Query() query: z.output<typeof pageQuery>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.authorization.require(actorOf(request), "item.edit", {
      type: "item",
      id: query.pageId,
    });
    return this.#services.templates.pageFiles(spaceId, query.pageId);
  }

  @Get("spaces/:spaceId/templates/:templateId/files/:fileId/content")
  @Permission("space.view", space)
  @ApiRoute({
    summary: "Download a file of a template",
    description:
      "Sends a file of a template that can be used in the space: an image the template shows, or a file of a drawing or diagram. Templates of the instance and the organization need edit access to the space.",
    tags: [TAG],
    params: spaceFileParams,
    raw: rawImage,
  })
  async spaceTemplateFile(
    @Param("spaceId") spaceId: string,
    @Param("templateId") templateId: string,
    @Param("fileId") fileId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const found = await this.#services.templates.scopeOf(templateId);
    if (!found) throw notFound();
    if (found.level !== "space" || found.spaceId !== spaceId) {
      const usable = await this.#services.templates.usable(actorOf(request), spaceId);
      if (!usable.some((template) => template.id === templateId)) throw notFound();
      await this.#services.authorization.require(actorOf(request), "space.edit", {
        type: "space",
        id: spaceId,
      });
    }
    return this.#send(request, reply, await this.#services.templates.files.content(templateId, fileId));
  }

  @Post("spaces/:spaceId/templates/:templateId/files")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Add an image to a space template",
    description:
      "Stores an image for the template. Send the bytes with `Content-Type: application/octet-stream`. PNG, JPEG, GIF, WebP and SVG are accepted up to 5 MB; SVG images are cleaned of scripts and links. Use the returned ID as `attachmentId` of an image in the content and save the template; files the content no longer uses are removed when the template is saved.",
    tags: [TAG],
    status: 201,
    params: spaceTemplateParams,
    query: nameQuery,
    upload: { contentTypes: ["application/octet-stream"], description: "The bytes of the image." },
    response: { description: "The file.", schema: templateFileSchema, example: exampleFile },
    errors: [
      "fileTooLarge",
      "unsupportedTemplateFile",
      "invalidFileName",
      "storageFull",
      "unsupportedMediaType",
      "busy",
      "uploadTimeout",
    ],
  })
  spaceUpload(
    @Param("spaceId") spaceId: string,
    @Param("templateId") templateId: string,
    @Query() query: z.output<typeof nameQuery>,
    @Req() request: FastifyRequest,
  ) {
    return this.#upload(request, { level: "space", spaceId }, templateId, query.name);
  }

  @Post("spaces/:spaceId/templates/export-summary")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Check an export of space templates",
    description:
      "Tells per template what an export removes because it cannot work in another instance, before anything is downloaded.",
    tags: [TAG],
    status: 200,
    params: spaceParams,
    body: exportSelection,
    bodyExample: { templateIds: [exampleTemplate.id] },
    response: {
      description: "What the export contains.",
      schema: exportSummarySchema,
      example: exampleSummary,
    },
    errors: ["templateNotFound"],
  })
  spaceExportSummary(@Param("spaceId") spaceId: string, @Body() body: z.output<typeof exportSelection>) {
    return this.#summary({ scope: { level: "space", spaceId } }, body.templateIds);
  }

  @Post("spaces/:spaceId/templates/export")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Export space templates",
    description:
      "Sends the chosen templates as a template file. Links to pages and spaces, mentions, includes, live diagram references, whiteboard blocks, template buttons, reports bound to pages or spaces and people are removed; the template's own images and external links stay. The file contains no IDs, names of people or titles of other pages.",
    tags: [TAG],
    params: spaceParams,
    body: exportSelection,
    bodyExample: { templateIds: null },
    raw: rawTemplateFile,
    errors: [...exportErrors],
  })
  spaceExport(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof exportSelection>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.#export(request, reply, { scope: { level: "space", spaceId } }, body.templateIds);
  }

  @Post("spaces/:spaceId/template-imports")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Upload a template file for import",
    description:
      "Checks a template file and returns a preview; nothing is saved yet. Send the file with `Content-Type: application/octet-stream`, at most 20 MB, with at most 50 templates and 200 files. Every part is validated like content entered in the editor. Confirm the preview to import.",
    tags: [TAG],
    status: 201,
    params: spaceParams,
    query: nameQuery,
    upload: { contentTypes: ["application/octet-stream"], description: "The template file." },
    response: { description: "The preview.", schema: importPreviewSchema, example: examplePreview },
    errors: [...importErrors],
  })
  spaceImport(
    @Param("spaceId") spaceId: string,
    @Query() query: z.output<typeof nameQuery>,
    @Req() request: FastifyRequest,
  ) {
    return this.#preview(request, { level: "space", spaceId }, query.name);
  }

  @Get("spaces/:spaceId/template-imports/:importId/files/:fileId/content")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Download a file of an import preview",
    description: "Sends a checked file of your import preview, to show it before you confirm.",
    tags: [TAG],
    params: spaceImportFileParams,
    raw: rawImage,
    errors: ["templateImportNotFound"],
  })
  spaceImportFile(
    @Param("spaceId") spaceId: string,
    @Param("importId") id: string,
    @Param("fileId") file: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.#importFile(request, reply, { level: "space", spaceId }, id, file);
  }

  @Post("spaces/:spaceId/template-imports/:importId/confirm")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Confirm an import",
    description:
      "Imports the templates of your preview into the space. A template whose name exists already needs a decision: replace it (it keeps its ID, so template buttons keep working) or create it under a new name.",
    tags: [TAG],
    status: 200,
    params: spaceImportParams,
    body: confirmSchema,
    bodyExample: { decisions: [{ index: 0, action: "create", name: "Change request (imported)" }] },
    response: {
      description: "The result.",
      schema: importResultSchema,
      example: { created: [exampleTemplate], replaced: [], skipped: 0 },
    },
    errors: [...confirmErrors],
  })
  spaceConfirm(
    @Param("spaceId") spaceId: string,
    @Param("importId") id: string,
    @Body() body: z.output<typeof confirmSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#confirm(request, { level: "space", spaceId }, id, body);
  }

  @Delete("spaces/:spaceId/template-imports/:importId")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Discard an import preview",
    description: "Discards your preview and its files. Previews are also discarded after 12 hours.",
    tags: [TAG],
    params: spaceImportParams,
    errors: ["templateImportNotFound"],
  })
  async spaceDiscard(
    @Param("spaceId") spaceId: string,
    @Param("importId") id: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.templateTransfers.discard(actorOf(request), { level: "space", spaceId }, id);
  }

  @Get("organizations/:organizationId/templates/:templateId/files/:fileId/content")
  @Permission("organization.templates.manage", organization)
  @ApiRoute({
    summary: "Download a file of an organization template",
    description: "Sends a file of a template of the organization.",
    tags: [TAG],
    params: organizationFileParams,
    raw: rawImage,
  })
  organizationTemplateFile(
    @Param("organizationId") organizationId: string,
    @Param("templateId") templateId: string,
    @Param("fileId") fileId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.#file(request, reply, { level: "organization", organizationId }, templateId, fileId);
  }

  @Post("organizations/:organizationId/templates/:templateId/files")
  @Permission("organization.templates.manage", organization)
  @ApiRoute({
    summary: "Add an image to an organization template",
    description:
      "Stores an image for the template, like for space templates: PNG, JPEG, GIF, WebP or SVG up to 5 MB.",
    tags: [TAG],
    status: 201,
    params: organizationTemplateParams,
    query: nameQuery,
    upload: { contentTypes: ["application/octet-stream"], description: "The bytes of the image." },
    response: { description: "The file.", schema: templateFileSchema, example: exampleFile },
    errors: [
      "fileTooLarge",
      "unsupportedTemplateFile",
      "invalidFileName",
      "storageFull",
      "unsupportedMediaType",
      "busy",
      "uploadTimeout",
    ],
  })
  organizationUpload(
    @Param("organizationId") organizationId: string,
    @Param("templateId") templateId: string,
    @Query() query: z.output<typeof nameQuery>,
    @Req() request: FastifyRequest,
  ) {
    return this.#upload(request, { level: "organization", organizationId }, templateId, query.name);
  }

  @Post("organizations/:organizationId/templates/export-summary")
  @Permission("organization.templates.manage", organization)
  @ApiRoute({
    summary: "Check an export of organization templates",
    description: "Tells per template what an export removes, before anything is downloaded.",
    tags: [TAG],
    status: 200,
    params: organizationParams,
    body: exportSelection,
    bodyExample: { templateIds: null },
    response: {
      description: "What the export contains.",
      schema: exportSummarySchema,
      example: exampleSummary,
    },
    errors: ["templateNotFound"],
  })
  organizationExportSummary(
    @Param("organizationId") organizationId: string,
    @Body() body: z.output<typeof exportSelection>,
  ) {
    return this.#summary({ scope: { level: "organization", organizationId } }, body.templateIds);
  }

  @Post("organizations/:organizationId/templates/export")
  @Permission("organization.templates.manage", organization)
  @ApiRoute({
    summary: "Export organization templates",
    description:
      "Sends the chosen templates of the organization as a template file, cleaned like space templates.",
    tags: [TAG],
    params: organizationParams,
    body: exportSelection,
    bodyExample: { templateIds: null },
    raw: rawTemplateFile,
    errors: [...exportErrors],
  })
  organizationExport(
    @Param("organizationId") organizationId: string,
    @Body() body: z.output<typeof exportSelection>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.#export(
      request,
      reply,
      { scope: { level: "organization", organizationId } },
      body.templateIds,
    );
  }

  @Post("organizations/:organizationId/template-imports")
  @Permission("organization.templates.manage", organization)
  @ApiRoute({
    summary: "Upload a template file for import into the organization",
    description: "Checks a template file and returns a preview, like for spaces; nothing is saved yet.",
    tags: [TAG],
    status: 201,
    params: organizationParams,
    query: nameQuery,
    upload: { contentTypes: ["application/octet-stream"], description: "The template file." },
    response: { description: "The preview.", schema: importPreviewSchema, example: examplePreview },
    errors: [...importErrors],
  })
  organizationImport(
    @Param("organizationId") organizationId: string,
    @Query() query: z.output<typeof nameQuery>,
    @Req() request: FastifyRequest,
  ) {
    return this.#preview(request, { level: "organization", organizationId }, query.name);
  }

  @Get("organizations/:organizationId/template-imports/:importId/files/:fileId/content")
  @Permission("organization.templates.manage", organization)
  @ApiRoute({
    summary: "Download a file of an organization import preview",
    description: "Sends a checked file of your import preview.",
    tags: [TAG],
    params: organizationImportFileParams,
    raw: rawImage,
    errors: ["templateImportNotFound"],
  })
  organizationImportFile(
    @Param("organizationId") organizationId: string,
    @Param("importId") id: string,
    @Param("fileId") file: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.#importFile(request, reply, { level: "organization", organizationId }, id, file);
  }

  @Post("organizations/:organizationId/template-imports/:importId/confirm")
  @Permission("organization.templates.manage", organization)
  @ApiRoute({
    summary: "Confirm an import into the organization",
    description:
      "Imports the templates of your preview as organization templates, with the same decisions as for spaces.",
    tags: [TAG],
    status: 200,
    params: organizationImportParams,
    body: confirmSchema,
    bodyExample: { decisions: [{ index: 0, action: "replace" }] },
    response: {
      description: "The result.",
      schema: importResultSchema,
      example: { created: [], replaced: [exampleTemplate], skipped: 0 },
    },
    errors: [...confirmErrors],
  })
  organizationConfirm(
    @Param("organizationId") organizationId: string,
    @Param("importId") id: string,
    @Body() body: z.output<typeof confirmSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#confirm(request, { level: "organization", organizationId }, id, body);
  }

  @Delete("organizations/:organizationId/template-imports/:importId")
  @Permission("organization.templates.manage", organization)
  @ApiRoute({
    summary: "Discard an organization import preview",
    description: "Discards your preview and its files.",
    tags: [TAG],
    params: organizationImportParams,
    errors: ["templateImportNotFound"],
  })
  async organizationDiscard(
    @Param("organizationId") organizationId: string,
    @Param("importId") id: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.templateTransfers.discard(
      actorOf(request),
      { level: "organization", organizationId },
      id,
    );
  }

  @Get("instance/templates/:templateId/files/:fileId/content")
  @Permission("instance.templates.manage", instance)
  @ApiRoute({
    summary: "Download a file of an instance template",
    description: "Sends a file of a template of the instance.",
    tags: [TAG],
    params: instanceFileParams,
    raw: rawImage,
  })
  instanceTemplateFile(
    @Param("templateId") templateId: string,
    @Param("fileId") fileId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.#file(request, reply, { level: "instance" }, templateId, fileId);
  }

  @Post("instance/templates/:templateId/files")
  @Permission("instance.templates.manage", instance)
  @ApiRoute({
    summary: "Add an image to an instance template",
    description: "Stores an image for the template: PNG, JPEG, GIF, WebP or SVG up to 5 MB.",
    tags: [TAG],
    status: 201,
    params: instanceTemplateParams,
    query: nameQuery,
    upload: { contentTypes: ["application/octet-stream"], description: "The bytes of the image." },
    response: { description: "The file.", schema: templateFileSchema, example: exampleFile },
    errors: [
      "fileTooLarge",
      "unsupportedTemplateFile",
      "invalidFileName",
      "storageFull",
      "unsupportedMediaType",
      "busy",
      "uploadTimeout",
    ],
  })
  instanceUpload(
    @Param("templateId") templateId: string,
    @Query() query: z.output<typeof nameQuery>,
    @Req() request: FastifyRequest,
  ) {
    return this.#upload(request, { level: "instance" }, templateId, query.name);
  }

  @Post("instance/templates/export-summary")
  @Permission("instance.templates.manage", instance)
  @ApiRoute({
    summary: "Check an export of instance templates",
    description: "Tells per template what an export removes, before anything is downloaded.",
    tags: [TAG],
    status: 200,
    body: exportSelection,
    bodyExample: { templateIds: null },
    response: {
      description: "What the export contains.",
      schema: exportSummarySchema,
      example: exampleSummary,
    },
    errors: ["templateNotFound"],
  })
  instanceExportSummary(@Body() body: z.output<typeof exportSelection>) {
    return this.#summary({ scope: { level: "instance" } }, body.templateIds);
  }

  @Post("instance/templates/export")
  @Permission("instance.templates.manage", instance)
  @ApiRoute({
    summary: "Export instance templates",
    description:
      "Sends the chosen templates of the instance as a template file, cleaned like space templates.",
    tags: [TAG],
    body: exportSelection,
    bodyExample: { templateIds: null },
    raw: rawTemplateFile,
    errors: [...exportErrors],
  })
  instanceExport(
    @Body() body: z.output<typeof exportSelection>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.#export(request, reply, { scope: { level: "instance" } }, body.templateIds);
  }

  @Post("instance/templates/built-in/export")
  @Permission("instance.templates.manage", instance)
  @ApiRoute({
    summary: "Export built-in templates",
    description:
      "Sends built-in templates in the chosen language as a template file, as a starting point for own templates.",
    tags: [TAG],
    body: builtInSelection,
    bodyExample: { language: "de", templateIds: ["builtin:how-to"] },
    raw: rawTemplateFile,
    errors: [...exportErrors],
  })
  builtInExport(
    @Body() body: z.output<typeof builtInSelection>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.#export(request, reply, { builtIn: body.language as TemplateLanguage }, body.templateIds);
  }

  @Post("instance/template-imports")
  @Permission("instance.templates.manage", instance)
  @ApiRoute({
    summary: "Upload a template file for import into the instance",
    description: "Checks a template file and returns a preview, like for spaces; nothing is saved yet.",
    tags: [TAG],
    status: 201,
    query: nameQuery,
    upload: { contentTypes: ["application/octet-stream"], description: "The template file." },
    response: { description: "The preview.", schema: importPreviewSchema, example: examplePreview },
    errors: [...importErrors],
  })
  instanceImport(@Query() query: z.output<typeof nameQuery>, @Req() request: FastifyRequest) {
    return this.#preview(request, { level: "instance" }, query.name);
  }

  @Get("instance/template-imports/:importId/files/:fileId/content")
  @Permission("instance.templates.manage", instance)
  @ApiRoute({
    summary: "Download a file of an instance import preview",
    description: "Sends a checked file of your import preview.",
    tags: [TAG],
    params: instanceImportFileParams,
    raw: rawImage,
    errors: ["templateImportNotFound"],
  })
  instanceImportFile(
    @Param("importId") id: string,
    @Param("fileId") file: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.#importFile(request, reply, { level: "instance" }, id, file);
  }

  @Post("instance/template-imports/:importId/confirm")
  @Permission("instance.templates.manage", instance)
  @ApiRoute({
    summary: "Confirm an import into the instance",
    description:
      "Imports the templates of your preview as instance templates, with the same decisions as for spaces.",
    tags: [TAG],
    status: 200,
    params: instanceImportParams,
    body: confirmSchema,
    bodyExample: { decisions: [], skipInvalid: true },
    response: {
      description: "The result.",
      schema: importResultSchema,
      example: { created: [exampleTemplate], replaced: [], skipped: 1 },
    },
    errors: [...confirmErrors],
  })
  instanceConfirm(
    @Param("importId") id: string,
    @Body() body: z.output<typeof confirmSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#confirm(request, { level: "instance" }, id, body);
  }

  @Delete("instance/template-imports/:importId")
  @Permission("instance.templates.manage", instance)
  @ApiRoute({
    summary: "Discard an instance import preview",
    description: "Discards your preview and its files.",
    tags: [TAG],
    params: instanceImportParams,
    errors: ["templateImportNotFound"],
  })
  async instanceDiscard(@Param("importId") id: string, @Req() request: FastifyRequest) {
    await this.#services.templateTransfers.discard(actorOf(request), { level: "instance" }, id);
  }
}
