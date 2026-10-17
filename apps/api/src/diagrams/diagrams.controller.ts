import type { Readable } from "node:stream";
import { Controller, Get, Inject, Param, Put, Query, Req } from "@nestjs/common";
import { diagramTypes } from "@pagehall/server";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { notFound, ProblemException } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import { extensibleEnum, uuid } from "../http/schemas.js";

const TAG = "Diagrams";
const page = { type: "item", param: "pageId" } as const;
const diagramParams = z
  .object({
    pageId: uuid("ID of the page or blog post."),
    blockId: uuid("ID of the diagram block in the page."),
  })
  .strict();

const imageQuery = z
  .object({
    type: extensibleEnum(
      [...diagramTypes],
      "Kind of diagram block: `drawio`, `mermaid` or `plantuml`. It names the attachment and sets the size limit.",
    ),
  })
  .strict();

function bodyOf(request: FastifyRequest): Readable {
  const body = request.body as Readable | undefined;
  if (!body || typeof (body as { pipe?: unknown }).pipe !== "function") {
    throw new ProblemException("unsupportedMediaType", "Send the content as application/octet-stream");
  }
  return body;
}

@Controller("api/v1")
export class DiagramsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("pages/:pageId/diagrams/:blockId")
  @Permission("item.view", page)
  @ApiRoute({
    summary: "Get the current image of a draw.io diagram",
    description:
      "Returns what readers of the page currently see of one of its draw.io diagrams: the title and address of the page and the attachment that holds the image. Other pages show a diagram of this page through it, so they always show its current version. Pages the caller may not see are not found.",
    tags: [TAG],
    params: diagramParams,
    response: {
      description: "The page and the image of the diagram.",
      schema: z
        .object({
          pageId: uuid("ID of the page or blog post that holds the diagram."),
          title: z.string().describe("Title of the page as readers see it."),
          path: z.string().describe("Address of the page in the web interface."),
          found: z.boolean().describe("Whether the page still holds the diagram."),
          previewId: uuid("ID of the attachment that holds the image.")
            .nullable()
            .describe("ID of the attachment that holds the image, or null while the diagram has none."),
          previewVersion: z
            .number()
            .int()
            .nullable()
            .describe("Version of the attachment that readers see, or null while the diagram has no image."),
        })
        .describe("The diagram."),
      example: {
        pageId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20",
        title: "Network",
        path: "/spaces/NET/pages/01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20/network",
        found: true,
        previewId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a23",
        previewVersion: 3,
      },
    },
  })
  async referenced(
    @Param("pageId") pageId: string,
    @Param("blockId") blockId: string,
    @Req() request: FastifyRequest,
  ) {
    const diagram = await this.#services.documents.referencedDiagram(actorOf(request), pageId, blockId);
    if (!diagram) throw notFound();
    return {
      pageId,
      title: diagram.title,
      path: diagram.href,
      found: diagram.found,
      previewId: diagram.previewId,
      previewVersion: diagram.previewVersion,
    };
  }

  @Put("pages/:pageId/diagrams/:blockId/drawio")
  @Permission("item.edit", page)
  @ApiRoute({
    summary: "Store the file of a draw.io diagram",
    description:
      "Checks the draw.io file of a diagram block and stores it as a new version of the attachment `drawio-<block ID>.drawio` of the page. Compressed pages are stored uncompressed; scripts, event handlers and links other than web, mail and page links are removed. Point the block to the returned attachment and version; older versions of the page keep showing the diagram they had.",
    tags: [TAG],
    params: diagramParams,
    upload: {
      contentTypes: ["application/octet-stream"],
      description: "The draw.io file (`mxfile` or `mxGraphModel` XML), up to 10 MB.",
    },
    response: {
      description: "Where the file is stored and the text of the diagram.",
      schema: z
        .object({
          sourceId: uuid("ID of the attachment that holds the file."),
          sourceVersion: z.number().int().describe("Version of the attachment."),
          text: z.string().describe("Text of the shapes and connectors, for the block and for search."),
        })
        .describe("The stored file."),
      example: { sourceId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a22", sourceVersion: 2, text: "Core switch" },
    },
    errors: ["invalidDiagram", "fileTooLarge", "storageFull", "unsupportedMediaType"],
  })
  async drawio(
    @Param("pageId") pageId: string,
    @Param("blockId") blockId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.diagrams.saveDrawio(actorOf(request), pageId, { blockId, body: bodyOf(request) });
  }

  @Put("pages/:pageId/diagrams/:blockId/image")
  @Permission("item.edit", page)
  @ApiRoute({
    summary: "Store the image of a diagram",
    description:
      "Sanitizes the SVG image of a draw.io, Mermaid or PlantUML block and stores it as a new version of the attachment `<type>-<block ID>.svg` of the page. Readers, search results, exports and the print view show this image. Scripts, links, external resources and unknown elements are removed; labels in draw.io diagrams keep simple formatting. Images may be at most 20,000 pixels wide and high, and 10 MB for draw.io or 2 MB for Mermaid and PlantUML.",
    tags: [TAG],
    params: diagramParams,
    query: imageQuery,
    upload: { contentTypes: ["application/octet-stream"], description: "The SVG image." },
    response: {
      description: "Where the image is stored and the text it shows.",
      schema: z
        .object({
          previewId: uuid("ID of the attachment that holds the image."),
          previewVersion: z.number().int().describe("Version of the attachment."),
          text: z.string().describe("Text shown in the image, for the block and for search."),
        })
        .describe("The stored image."),
      example: {
        previewId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a23",
        previewVersion: 2,
        text: "Router\nSwitch",
      },
    },
    errors: ["invalidDrawingImage", "fileTooLarge", "storageFull", "unsupportedMediaType"],
  })
  async image(
    @Param("pageId") pageId: string,
    @Param("blockId") blockId: string,
    @Query() query: z.output<typeof imageQuery>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.diagrams.savePreview(actorOf(request), pageId, {
      type: query.type,
      blockId,
      body: bodyOf(request),
    });
  }
}
