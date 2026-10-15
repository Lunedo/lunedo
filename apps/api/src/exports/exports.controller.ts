import { Controller, Delete, Get, Inject, Param, Post, Query, Req, Res } from "@nestjs/common";
import { contentDisposition, type ExportFile } from "@pagehall/server";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { FILE_CONTENT_SECURITY_POLICY } from "../files/serve.js";
import { ApiRoute } from "../http/api-route.js";
import { actorOf } from "../http/request.js";
import { uuid } from "../http/schemas.js";
import { exampleExport, exportSchema } from "./schemas.js";

const TAG = "Exports";
const page = { type: "item", param: "pageId" } as const;
const space = { type: "space", param: "spaceId" } as const;
const exportResource = { type: "export", param: "exportId" } as const;
const pageParams = z.object({ pageId: uuid("ID of the page.") }).strict();
const spaceParams = z.object({ spaceId: uuid("ID of the space.") }).strict();
const exportParams = z.object({ exportId: uuid("ID of the export.") }).strict();

const pageExportQuery = z
  .object({
    format: z
      .enum(["markdown", "html", "zip"])
      .describe(
        "`markdown` for one Markdown file, `html` for one HTML file with inline styles that can be read offline, `zip` for both together with the attachments of the page.",
      ),
  })
  .strict();

const exportStarted =
  "The export runs in the background. When it is ready, you get a notification with the download; the download is kept for 7 days and only you can open it. You can run one export at a time and keep up to 5; a new export of the same space or page replaces the earlier one.";

function send(reply: FastifyReply, file: ExportFile) {
  reply.header("content-type", file.contentType);
  reply.header("content-disposition", contentDisposition("attachment", file.fileName));
  reply.header("x-content-type-options", "nosniff");
  reply.header("content-security-policy", FILE_CONTENT_SECURITY_POLICY);
  reply.header("cache-control", "private, no-store");
  if (file.size !== undefined) reply.header("content-length", String(file.size));
  else if (Buffer.isBuffer(file.body)) reply.header("content-length", String(file.body.length));
  return file.body;
}

@Controller("api/v1")
export class ExportsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("pages/:pageId/export")
  @Permission("item.export", page)
  @ApiRoute({
    summary: "Export a page",
    description:
      "Sends the page as readers see it: the published version in publish mode. Modules such as child page lists and reports are rendered with your permissions; content you cannot read is left out. Comments, private notes and the history are not exported. Links to other pages and to attachments point to Pagehall, except the attachments inside a ZIP.",
    tags: [TAG],
    params: pageParams,
    query: pageExportQuery,
    raw: {
      contentTypes: ["text/markdown", "text/html", "application/zip"],
      description: "The page as a Markdown file, an HTML file or a ZIP archive.",
      example: "# Connect through WireGuard\n",
    },
    errors: ["exportDisabled", "nothingToExport"],
  })
  async page(
    @Param("pageId") pageId: string,
    @Query() query: z.output<typeof pageExportQuery>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return send(reply, await this.#services.exports.page(actorOf(request), pageId, query.format));
  }

  @Post("pages/:pageId/exports")
  @Permission("item.export", page)
  @ApiRoute({
    summary: "Export a page with its subpages",
    description: `Starts an export of the page and every subpage you can read, as a ZIP archive with the page tree as folders, each page as Markdown and HTML and the attachments next to their pages. ${exportStarted}`,
    tags: [TAG],
    status: 202,
    params: pageParams,
    response: {
      description: "The started export.",
      schema: exportSchema,
      example: { ...exampleExport, scope: "pages", state: "queued", progress: { done: 0, total: 0 } },
    },
    errors: ["exportDisabled", "exportRunning", "tooManyExports", "exportStorageFull", "nothingToExport"],
  })
  async exportPages(@Param("pageId") pageId: string, @Req() request: FastifyRequest) {
    return this.#services.exports.start(actorOf(request), { pageId });
  }

  @Post("spaces/:spaceId/exports")
  @Permission("space.export", space)
  @ApiRoute({
    summary: "Export a space",
    description: `Starts an export of every page of the space you can read, as a ZIP archive with the page tree as folders, each page as Markdown and HTML, the attachments next to their pages and an index.html that lists the tree. Links between exported pages become relative paths. ${exportStarted}`,
    tags: [TAG],
    status: 202,
    params: spaceParams,
    response: {
      description: "The started export.",
      schema: exportSchema,
      example: { ...exampleExport, state: "queued", progress: { done: 0, total: 0 } },
    },
    errors: ["exportDisabled", "exportRunning", "tooManyExports", "exportStorageFull"],
  })
  async exportSpace(@Param("spaceId") spaceId: string, @Req() request: FastifyRequest) {
    return this.#services.exports.start(actorOf(request), { spaceId });
  }

  @Get("exports")
  @Permission("instance.content.view")
  @ApiRoute({
    summary: "List your exports",
    description: "Lists your exports of the last 7 days that were not deleted, newest first.",
    tags: [TAG],
    response: {
      description: "Your exports.",
      schema: z.array(exportSchema).describe("Exports, newest first, at most 50."),
      example: [exampleExport],
    },
  })
  async list(@Req() request: FastifyRequest) {
    return this.#services.exports.list(actorOf(request));
  }

  @Get("exports/:exportId")
  @Permission("export.view", exportResource)
  @ApiRoute({
    summary: "Get an export",
    description: "Returns the state and progress of one of your exports.",
    tags: [TAG],
    params: exportParams,
    response: { description: "The export.", schema: exportSchema, example: exampleExport },
  })
  async get(@Param("exportId") exportId: string, @Req() request: FastifyRequest) {
    return this.#services.exports.get(actorOf(request), exportId);
  }

  @Get("exports/:exportId/content")
  @Permission("export.download", exportResource)
  @ApiRoute({
    summary: "Download an export",
    description:
      "Sends the ZIP archive of a ready export. Only the person who started it can download it, for 7 days, and only while export is turned on for the space and they can still read what was exported.",
    tags: [TAG],
    params: exportParams,
    raw: { contentTypes: ["application/zip"], description: "The ZIP archive.", example: "" },
    errors: ["exportDisabled"],
  })
  async download(
    @Param("exportId") exportId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return send(reply, await this.#services.exports.download(actorOf(request), exportId));
  }

  @Delete("exports/:exportId")
  @Permission("export.delete", exportResource)
  @ApiRoute({
    summary: "Delete an export",
    description: "Deletes one of your exports and its file. A running export stops.",
    tags: [TAG],
    params: exportParams,
  })
  async remove(@Param("exportId") exportId: string, @Req() request: FastifyRequest) {
    await this.#services.exports.remove(actorOf(request), exportId);
  }
}
