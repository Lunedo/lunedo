import { Body, Controller, Delete, Get, Inject, Param, Post, Query, Req, Res } from "@nestjs/common";
import {
  contentDisposition,
  defaultExportOptions,
  type ExportFile,
  type ExportRequest,
  orientations,
  paperSizes,
} from "@pagehall/server";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { FILE_CONTENT_SECURITY_POLICY, parseRange } from "../files/serve.js";
import { ApiRoute } from "../http/api-route.js";
import { ProblemException } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import { uuid } from "../http/schemas.js";
import { exampleExport, exampleExportCounts, exportCountsSchema, exportSchema } from "./schemas.js";

const TAG = "Exports";
const page = { type: "item", param: "pageId" } as const;
const space = { type: "space", param: "spaceId" } as const;
const exportResource = { type: "export", param: "exportId" } as const;
const pageParams = z.object({ pageId: uuid("ID of the page.") }).strict();
const spaceParams = z.object({ spaceId: uuid("ID of the space.") }).strict();
const exportParams = z.object({ exportId: uuid("ID of the export.") }).strict();

const flag = (description: string) => z.enum(["true", "false"]).optional().describe(description);

const pageExportQuery = z
  .object({
    format: z
      .enum(["markdown", "html", "zip", "print", "pdf", "docx"])
      .describe(
        "`markdown` for one Markdown file, `html` for one HTML file with inline styles that can be read offline, `zip` for both together with the attachments of the page. `print` for print-ready HTML with page breaks, header, footer and contents, laid out into sheets by a pagination library such as Vivliostyle. `pdf` for a PDF file, which needs the optional render container. `docx` for a Word document.",
      ),
    attachments: flag(
      "For `print`, `pdf` and `docx`: `true` (the default) adds an appendix that lists the attachments of the page.",
    ),
    comments: flag(
      "For `print`, `pdf` and `docx`: `true` adds the open comments after the page. Off by default.",
    ),
    contents: flag("For `print`, `pdf` and `docx`: `true` (the default) adds a table of contents."),
    paper: z
      .enum(paperSizes)
      .optional()
      .describe("Paper size for `print`, `pdf` and `docx`; `a4` by default."),
    orientation: z
      .enum(orientations)
      .optional()
      .describe("Orientation for `print`, `pdf` and `docx`; `portrait` by default."),
  })
  .strict();

const exportRequestSchema = z
  .object({
    format: z
      .enum(["archive", "html", "markdown", "print", "pdf", "docx"])
      .default("archive")
      .describe(
        "`archive` (the default) for a ZIP with every page as Markdown and HTML, `html` or `markdown` for a ZIP with one of them, `print` for one print-ready HTML file of up to 300 pages, `pdf` for one PDF file, which needs the optional render container, `docx` for one Word document.",
      ),
    attachments: z
      .boolean()
      .default(true)
      .describe(
        "Adds the attachments: next to their pages in a ZIP, as an appendix that lists them in `print`, `pdf` and `docx`. `archive` always contains them.",
      ),
    comments: z
      .boolean()
      .default(false)
      .describe("Adds the open comments after each page in `print`, `pdf` and `docx`."),
    contents: z.boolean().default(true).describe("Adds a table of contents in `print`, `pdf` and `docx`."),
    paper: z.enum(paperSizes).default("a4").describe("Paper size for `print`, `pdf` and `docx`."),
    orientation: z
      .enum(orientations)
      .default("portrait")
      .describe("Orientation for `print`, `pdf` and `docx`."),
  })
  .strict()
  .optional()
  .describe(
    "What to export and how. Without a body, the export is a ZIP with every page as Markdown and HTML.",
  );

type ExportRequestBody = z.output<typeof exportRequestSchema>;

function exportRequest(body: ExportRequestBody): ExportRequest {
  if (!body) return { format: "archive", options: defaultExportOptions };
  const { format, ...options } = body;
  return { format, options };
}

function pagedQuery(query: z.output<typeof pageExportQuery>): ExportRequest["options"] {
  const value = (given: "true" | "false" | undefined, fallback: boolean) =>
    given === undefined ? fallback : given === "true";
  return {
    attachments: value(query.attachments, defaultExportOptions.attachments),
    comments: value(query.comments, defaultExportOptions.comments),
    contents: value(query.contents, defaultExportOptions.contents),
    paper: query.paper ?? defaultExportOptions.paper,
    orientation: query.orientation ?? defaultExportOptions.orientation,
  };
}

const EXPORT_TYPES = [
  "application/zip",
  "text/html",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const exportStarted =
  "Only space administrators, and organization administrators with access to the space outside confidential spaces, can start it. It is refused when the file store would pass the usage level where large writes are blocked (90 % by default), and stops when the usage reaches the critical level (95 % by default) while it is written. The export runs in the background. When it is ready, you get a notification with the download; only you can open it. The download is deleted 24 hours after it was first downloaded completely, or after 7 days if it is never downloaded. You can run one export at a time and keep up to 5; a new export of the same space or page replaces the earlier one.";

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
      "Sends the page as readers see it: the published version in publish mode. Modules such as child page lists and reports are rendered with your permissions; content you cannot read is left out. Private notes and the history are not exported; open comments only in `print`, `pdf` and `docx` when asked for. Links to other pages and to attachments point to Pagehall, except the attachments inside a ZIP. Images in `pdf` and `docx` are embedded when you may read them. Without the render container, `pdf` answers with `renderUnavailable`; people can still print the `print` format to PDF in their browser.",
    tags: [TAG],
    params: pageParams,
    query: pageExportQuery,
    raw: {
      contentTypes: ["text/markdown", ...EXPORT_TYPES],
      description: "The page as a Markdown file, an HTML file, a ZIP archive, a PDF file or a Word document.",
      example: "# Connect through WireGuard\n",
    },
    errors: ["exportDisabled", "nothingToExport", "renderUnavailable", "renderFailed"],
  })
  async page(
    @Param("pageId") pageId: string,
    @Query() query: z.output<typeof pageExportQuery>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return send(
      reply,
      await this.#services.exports.page(actorOf(request), pageId, query.format, pagedQuery(query)),
    );
  }

  @Post("pages/:pageId/exports")
  @Permission("item.exportPages", page)
  @ApiRoute({
    summary: "Export a page with its subpages",
    description: `Starts an export of the page and every subpage you can read: by default a ZIP archive with the page tree as folders, each page as Markdown and HTML and the attachments next to their pages; with a format, one print-ready HTML file, PDF file or Word document of all pages. ${exportStarted}`,
    tags: [TAG],
    status: 202,
    params: pageParams,
    body: exportRequestSchema,
    bodyExample: {
      format: "docx",
      attachments: true,
      comments: false,
      contents: true,
      paper: "a4",
      orientation: "portrait",
    },
    response: {
      description: "The started export.",
      schema: exportSchema,
      example: { ...exampleExport, scope: "pages", state: "queued", progress: { done: 0, total: 0 } },
    },
    errors: [
      "exportDisabled",
      "exportRunning",
      "tooManyExports",
      "notEnoughStorage",
      "nothingToExport",
      "tooManyPagesToPrint",
      "renderUnavailable",
    ],
  })
  async exportPages(
    @Param("pageId") pageId: string,
    @Body() body: ExportRequestBody,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.exports.start(actorOf(request), { pageId }, exportRequest(body));
  }

  @Get("pages/:pageId/exports/summary")
  @Permission("item.exportPages", page)
  @ApiRoute({
    summary: "Count what an export of a page with its subpages contains",
    description:
      "Counts the page and its subpages that you can read, so you can choose a format before you start the export. Browsers print up to `printLimit` pages at once; `serverPdf` tells whether the render container can create PDF files instead.",
    tags: [TAG],
    params: pageParams,
    response: { description: "The counts.", schema: exportCountsSchema, example: exampleExportCounts },
    errors: ["exportDisabled", "nothingToExport"],
  })
  async pagesSummary(@Param("pageId") pageId: string, @Req() request: FastifyRequest) {
    return this.#services.exports.counts(actorOf(request), { pageId });
  }

  @Post("spaces/:spaceId/exports")
  @Permission("space.export", space)
  @ApiRoute({
    summary: "Export a space",
    description: `Starts an export of every page of the space you can read: by default a ZIP archive with the page tree as folders, each page as Markdown and HTML, the attachments next to their pages and an index.html that lists the tree, where links between exported pages become relative paths; with a format, one print-ready HTML file, PDF file or Word document of all pages and published blog posts. ${exportStarted}`,
    tags: [TAG],
    status: 202,
    params: spaceParams,
    body: exportRequestSchema,
    bodyExample: {
      format: "pdf",
      attachments: true,
      comments: false,
      contents: true,
      paper: "a4",
      orientation: "portrait",
    },
    response: {
      description: "The started export.",
      schema: exportSchema,
      example: { ...exampleExport, state: "queued", progress: { done: 0, total: 0 } },
    },
    errors: [
      "exportDisabled",
      "exportRunning",
      "tooManyExports",
      "notEnoughStorage",
      "tooManyPagesToPrint",
      "renderUnavailable",
    ],
  })
  async exportSpace(
    @Param("spaceId") spaceId: string,
    @Body() body: ExportRequestBody,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.exports.start(actorOf(request), { spaceId }, exportRequest(body));
  }

  @Get("spaces/:spaceId/exports/summary")
  @Permission("space.export", space)
  @ApiRoute({
    summary: "Count what an export of a space contains",
    description:
      "Counts the pages and published blog posts of the space that you can read, so you can choose a format before you start the export. Browsers print up to `printLimit` pages at once; `serverPdf` tells whether the render container can create PDF files instead.",
    tags: [TAG],
    params: spaceParams,
    response: { description: "The counts.", schema: exportCountsSchema, example: exampleExportCounts },
    errors: ["exportDisabled"],
  })
  async spaceSummary(@Param("spaceId") spaceId: string, @Req() request: FastifyRequest) {
    return this.#services.exports.counts(actorOf(request), { spaceId });
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
      "Sends the file of a ready export: a ZIP archive, a print-ready HTML file, a PDF file or a Word document, depending on its format. Only the person who started it can download it, only while export is turned on for the space and they may still export what was exported. After the first complete download it is kept for 24 more hours; ranges are supported to resume an interrupted download.",
    tags: [TAG],
    params: exportParams,
    raw: {
      contentTypes: EXPORT_TYPES,
      ranges: true,
      description: "The file or the requested part of it.",
      example: "",
    },
    errors: ["exportDisabled", "rangeNotSatisfiable"],
  })
  async download(
    @Param("exportId") exportId: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const archive = await this.#services.exports.download(actorOf(request), exportId);
    reply.header("content-type", archive.contentType);
    reply.header("content-disposition", contentDisposition("attachment", archive.fileName));
    reply.header("x-content-type-options", "nosniff");
    reply.header("content-security-policy", FILE_CONTENT_SECURITY_POLICY);
    reply.header("cache-control", "private, no-store");
    reply.header("accept-ranges", "bytes");
    const range = parseRange(request.headers.range, archive.size);
    if (range === "invalid") {
      reply.header("content-range", `bytes */${archive.size}`);
      throw new ProblemException("rangeNotSatisfiable", "The requested range lies outside the file");
    }
    if (range) {
      reply.status(206);
      reply.header("content-range", `bytes ${range.start}-${range.end}/${archive.size}`);
    }
    reply.header("content-length", String(range ? range.end - range.start + 1 : archive.size));
    const body = await archive.read(range ?? undefined);
    if (!range || range.end === archive.size - 1) {
      reply.raw.once("finish", () => {
        archive.delivered().catch((error: unknown) => {
          request.log.warn({ err: error }, "The first complete download of an export was not recorded");
        });
      });
    }
    return body;
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
