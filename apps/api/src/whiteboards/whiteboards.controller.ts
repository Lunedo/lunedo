import type { Readable } from "node:stream";
import { Controller, Get, Inject, Param, Post, Put, Query, Req, Res } from "@nestjs/common";
import { versionReasons } from "@pagehall/server";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { sendAttachment } from "../files/serve.js";
import { ApiRoute } from "../http/api-route.js";
import { notFound, ProblemException } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import { extensibleEnum, timestamp, uuid } from "../http/schemas.js";

const TAG = "Whiteboards";
const board = { type: "item", param: "itemId" } as const;
const page = { type: "item", param: "pageId" } as const;
const boardParams = z.object({ itemId: uuid("ID of the whiteboard.") }).strict();
const versionParams = boardParams.extend({
  number: z.coerce.number().int().min(1).max(2_147_483_647).describe("Number of the version."),
});
const drawingParams = z
  .object({
    pageId: uuid("ID of the page or blog post."),
    blockId: uuid("ID of the drawing block in the page."),
  })
  .strict();

const previewQuery = z
  .object({
    version: z.coerce
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Number of the version. Default: the current state."),
  })
  .strict();

const revisionQuery = z
  .object({
    revision: z.coerce
      .number()
      .int()
      .min(1)
      .describe("The stored state the image shows, as reported by the collaboration server after saving."),
  })
  .strict();

const sceneSchema = z
  .json()
  .describe(
    "The scene: `elements` (Excalidraw elements of the types rectangle, diamond, ellipse, arrow, line, freedraw, text, image and frame, ordered by their `index`), `files` (images by file ID, each the `attachmentId` of an attachment of the item and its `mimeType`) and `settings` (`viewBackgroundColor`).",
  );

const personSchema = z
  .object({
    id: uuid("ID of the account."),
    name: z.string().nullable().describe("Name of the person, or null when the account no longer exists."),
  })
  .describe("A person.");

const boardSchema = z
  .object({
    itemId: uuid("ID of the whiteboard."),
    scene: sceneSchema,
    revision: z.number().int().describe("Number of the stored state."),
    updatedAt: timestamp("When the scene was last stored."),
    updatedBy: personSchema.nullable().describe("Who changed it last, or null."),
    preview: z.boolean().describe("Whether an image of the current state exists."),
  })
  .describe("The current content of a whiteboard.");

const versionSchema = z
  .object({
    number: z.number().int().describe("Number of the version, counting from 1."),
    title: z.string().describe("Title of the whiteboard in this version."),
    reason: extensibleEnum(
      versionReasons,
      "Why the version exists: `session` (an editing session ended or the board was idle) or `restored` (an older version was restored).",
    ),
    restoredFrom: z.number().int().nullable().describe("The restored version, or null."),
    createdAt: timestamp("When the version was created."),
    createdBy: personSchema.nullable().describe("Who restored, or null for versions of editing sessions."),
    contributors: z
      .array(personSchema)
      .describe("Everyone who changed the board since the previous version."),
    preview: z.boolean().describe("Whether an image of this version exists."),
  })
  .describe("A version of a whiteboard.");

const examplePerson = { id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20", name: "Anna Berger" };
const exampleScene = {
  elements: [],
  files: {},
  settings: { viewBackgroundColor: null },
};
const exampleVersion = {
  number: 3,
  title: "Network redesign 2027",
  reason: "session",
  restoredFrom: null,
  createdAt: "2026-10-16T09:12:00.000Z",
  createdBy: null,
  contributors: [examplePerson],
  preview: true,
};

const rawImage = {
  contentTypes: ["image/svg+xml"],
  ranges: true,
  description:
    "The image as SVG, sanitized when it was stored. It is sent with `Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff`.",
  example: "",
};

const svgUpload = {
  contentTypes: ["application/octet-stream"],
  description:
    "The SVG image, up to 5 MB. Scripts, links, external resources and foreign content are removed.",
};

function bodyOf(request: FastifyRequest): Readable {
  const body = request.body as Readable | undefined;
  if (!body || typeof (body as { pipe?: unknown }).pipe !== "function") {
    throw new ProblemException("unsupportedMediaType", "Send the content as application/octet-stream");
  }
  return body;
}

@Controller("api/v1")
export class WhiteboardsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("whiteboards/:itemId/scene")
  @Permission("item.view", board)
  @ApiRoute({
    summary: "Get the content of a whiteboard",
    description:
      "Returns the stored scene. People who edit the board together use the collaboration server with the document name `whiteboard:<ID>`; it stores the scene about a second after each change.",
    tags: [TAG],
    params: boardParams,
    response: {
      description: "The whiteboard.",
      schema: boardSchema,
      example: {
        itemId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a21",
        scene: exampleScene,
        revision: 12,
        updatedAt: "2026-10-16T09:12:00.000Z",
        updatedBy: examplePerson,
        preview: true,
      },
    },
  })
  async scene(@Param("itemId") itemId: string) {
    const found = await this.#services.whiteboards.scene(itemId);
    if (!found) throw notFound();
    return found;
  }

  @Get("whiteboards/:itemId/preview")
  @Permission("item.view", board)
  @ApiRoute({
    summary: "Get the image of a whiteboard",
    description:
      "Sends the SVG image of the current state or of a version. Pagehall shows it in the page tree, in search results and in links. Answers 404 when no image was stored yet.",
    tags: [TAG],
    params: boardParams,
    query: previewQuery,
    raw: rawImage,
  })
  async preview(
    @Param("itemId") itemId: string,
    @Query() query: z.output<typeof previewQuery>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const preview = await this.#services.whiteboards.preview(itemId, query.version);
    if (!preview) throw notFound();
    return sendAttachment(
      request,
      reply,
      this.#services.files,
      {
        attachmentId: itemId,
        fileId: preview.fileId,
        name: "whiteboard.svg",
        size: preview.size,
        contentType: "image/svg+xml",
        preview: "svg",
        inline: false,
        version: query.version ?? 0,
        versionId: preview.id,
      },
      { inline: false, crossOrigin: false },
    );
  }

  @Put("whiteboards/:itemId/preview")
  @Permission("item.edit", board)
  @ApiRoute({
    summary: "Store the image of a whiteboard",
    description:
      "Stores the SVG image of a saved state. The web client creates it after its changes were saved. An image of an older state than the stored one is ignored. Versions of the same state get the image too.",
    tags: [TAG],
    params: boardParams,
    query: revisionQuery,
    upload: svgUpload,
    response: {
      description: "Whether the image was kept.",
      schema: z
        .object({ kept: z.boolean().describe("False when a newer image exists already.") })
        .describe("The result."),
      example: { kept: true },
    },
    errors: [
      "invalidDrawingImage",
      "revisionNotStored",
      "fileTooLarge",
      "storageFull",
      "unsupportedMediaType",
    ],
  })
  async storePreview(
    @Param("itemId") itemId: string,
    @Query() query: z.output<typeof revisionQuery>,
    @Req() request: FastifyRequest,
  ) {
    const kept = await this.#services.whiteboards.setPreview(actorOf(request), itemId, {
      revision: query.revision,
      body: bodyOf(request),
    });
    return { kept };
  }

  @Get("whiteboards/:itemId/versions")
  @Permission("item.view", board)
  @ApiRoute({
    summary: "List the versions of a whiteboard",
    description:
      "Lists all versions, newest first. A version is kept when the last person leaves the board and after it was idle for the time set for live pages.",
    tags: [TAG],
    params: boardParams,
    response: {
      description: "Versions.",
      schema: z.array(versionSchema).describe("Versions, newest first."),
      example: [exampleVersion],
    },
  })
  async versions(@Param("itemId") itemId: string) {
    return this.#services.whiteboards.list(itemId);
  }

  @Get("whiteboards/:itemId/versions/:number")
  @Permission("item.view", board)
  @ApiRoute({
    summary: "Get a version of a whiteboard",
    description: "Returns a version with its scene.",
    tags: [TAG],
    params: versionParams,
    response: {
      description: "The version.",
      schema: versionSchema.extend({ scene: sceneSchema }).describe("A version with its scene."),
      example: { ...exampleVersion, scene: exampleScene },
    },
  })
  async version(@Param("itemId") itemId: string, @Param("number") number: number) {
    const version = await this.#services.whiteboards.get(itemId, number);
    if (!version) throw notFound();
    return version;
  }

  @Post("whiteboards/:itemId/versions/:number/restore")
  @Permission("item.edit", board)
  @ApiRoute({
    summary: "Restore a version of a whiteboard",
    description:
      "The version becomes the current content at once, also for people editing the board, and a new version is created. History is never rewritten.",
    tags: [TAG],
    status: 200,
    params: versionParams,
    response: {
      description: "The new version.",
      schema: z.object({ version: z.number().int().describe("The new version.") }).describe("The result."),
      example: { version: 4 },
    },
    errors: ["versionNotFound"],
  })
  async restore(
    @Param("itemId") itemId: string,
    @Param("number") number: number,
    @Req() request: FastifyRequest,
  ) {
    return { version: await this.#services.whiteboards.restore(actorOf(request), itemId, number) };
  }

  @Put("pages/:pageId/drawings/:blockId/scene")
  @Permission("item.edit", page)
  @ApiRoute({
    summary: "Store the scene of a drawing",
    description:
      "Validates the scene of a drawing block and stores it as a new version of the attachment `drawing-<block ID>.excalidraw` of the page. Point the block to the returned attachment and version; older versions of the page keep showing the drawing they had.",
    tags: [TAG],
    params: drawingParams,
    upload: {
      contentTypes: ["application/octet-stream"],
      description: "The scene as JSON, up to 8 MB, in the same form as the scene of a whiteboard.",
    },
    response: {
      description: "Where the scene is stored and the text of the drawing.",
      schema: z
        .object({
          sceneId: uuid("ID of the attachment that holds the scene."),
          sceneVersion: z.number().int().describe("Version of the attachment."),
          text: z.string().describe("Text of the drawing, for the block and for search."),
        })
        .describe("The stored scene."),
      example: { sceneId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a22", sceneVersion: 2, text: "Server room" },
    },
    errors: ["invalidScene", "fileTooLarge", "storageFull", "unsupportedMediaType"],
  })
  async drawingScene(
    @Param("pageId") pageId: string,
    @Param("blockId") blockId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.drawings.saveScene(actorOf(request), pageId, { blockId, body: bodyOf(request) });
  }

  @Put("pages/:pageId/drawings/:blockId/preview")
  @Permission("item.edit", page)
  @ApiRoute({
    summary: "Store the image of a drawing",
    description:
      "Sanitizes the SVG image of a drawing block and stores it as a new version of the attachment `drawing-<block ID>.svg` of the page. Readers, exports and the print view show this image.",
    tags: [TAG],
    params: drawingParams,
    upload: svgUpload,
    response: {
      description: "Where the image is stored.",
      schema: z
        .object({
          previewId: uuid("ID of the attachment that holds the image."),
          previewVersion: z.number().int().describe("Version of the attachment."),
        })
        .describe("The stored image."),
      example: { previewId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a23", previewVersion: 2 },
    },
    errors: ["invalidDrawingImage", "fileTooLarge", "storageFull", "unsupportedMediaType"],
  })
  async drawingPreview(
    @Param("pageId") pageId: string,
    @Param("blockId") blockId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.drawings.savePreview(actorOf(request), pageId, { blockId, body: bodyOf(request) });
  }
}
