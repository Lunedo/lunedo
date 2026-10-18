import type { Readable } from "node:stream";
import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, Req, Res } from "@nestjs/common";
import {
  type AttachmentView,
  accountPrincipal,
  FILE_NAME_MAX_LENGTH,
  type Principal,
} from "@pagehall/server";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { InternalRoute, Permission, PublicRoute } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { notFound, ProblemException } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import { uuid } from "../http/schemas.js";
import {
  attachmentListSchema,
  attachmentSchema,
  attachmentVersionSchema,
  exampleAttachment,
  exampleAttachmentVersion,
  fileLinkSchema,
  keepVersionSchema,
} from "./schemas.js";
import { imageSizeSchema, sendAttachment, sized } from "./serve.js";

const TAG = "Attachments";
const page = { type: "item", param: "pageId" } as const;
const attachment = { type: "attachment", param: "attachmentId" } as const;
const pageParams = z.object({ pageId: uuid("ID of the page or blog post.") }).strict();
const attachmentParams = z.object({ attachmentId: uuid("ID of the attachment.") }).strict();
const restoreParams = pageParams.extend({ attachmentId: uuid("ID of the deleted attachment.") }).strict();
const versionParams = attachmentParams
  .extend({ number: z.coerce.number().int().min(1).describe("Number of the version, starting at 1.") })
  .strict();
const LINK_MINUTES = 10;

const uploadQuery = z
  .object({
    name: z
      .string()
      .min(1)
      .max(FILE_NAME_MAX_LENGTH * 4)
      .describe(
        "File name. Paths and control characters are removed. A file with the same name, compared without case, becomes a new version.",
      ),
  })
  .strict();

const contentQuery = z
  .object({
    version: z.coerce
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Number of the version. Default: the current one."),
    download: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true")
      .describe(
        "`true` always sends the file as a download. Otherwise images, video and audio are sent inline and everything else as a download.",
      ),
    size: imageSizeSchema,
  })
  .strict();

const linkQuery = z
  .object({
    version: z.coerce
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Number of the version. Default: the current one."),
  })
  .strict();

const fileTokenParams = z
  .object({ token: z.string().max(300).describe("The signed part of the address from the link endpoint.") })
  .strict();

const rawFile = {
  contentTypes: ["*/*"],
  ranges: true,
  description:
    "The file. The content type is decided from the content. Files are sent with `Content-Security-Policy: sandbox` and `X-Content-Type-Options: nosniff`; ranges are supported.",
  example: "",
};

@Controller("api/v1")
export class AttachmentsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  async #view(
    actor: Principal,
    action: "item.edit" | "attachment.edit",
    id: string,
  ): Promise<AttachmentView> {
    const type = action === "item.edit" ? "item" : "attachment";
    return (await this.#services.authorization.authorize(actor, action, { type, id }))
      ? "draft"
      : "published";
  }

  @Get("pages/:pageId/attachments")
  @Permission("item.view", page)
  @ApiRoute({
    summary: "List the attachments of a page",
    description:
      "Lists the files attached to a page or blog post with their current version, ordered by name. People who can edit the page get the draft state, with attachments that readers do not see yet marked in `draft`; everyone else gets the attachments of the published version.",
    tags: [TAG],
    params: pageParams,
    response: { description: "The attachments.", schema: attachmentListSchema, example: [exampleAttachment] },
  })
  async list(@Param("pageId") pageId: string, @Req() request: FastifyRequest) {
    const actor = actorOf(request);
    return this.#services.attachments.list(actor, pageId, await this.#view(actor, "item.edit", pageId));
  }

  @Post("pages/:pageId/attachments")
  @Permission("item.edit", page)
  @ApiRoute({
    summary: "Upload a file",
    description:
      "Attaches a file to a page or blog post. Send the bytes as the request body with `Content-Type: application/octet-stream` and the name in `name`. Files above the size limit of the organization are refused before anything is stored. A file with the same name becomes a new version of that attachment.",
    tags: [TAG],
    params: pageParams,
    query: uploadQuery,
    upload: { contentTypes: ["application/octet-stream"], description: "The bytes of the file." },
    status: 201,
    response: {
      description: "The attachment with the new version.",
      schema: attachmentSchema,
      example: exampleAttachment,
    },
    errors: ["fileTooLarge", "invalidFileName", "invalidItem", "unsupportedMediaType", "storageFull"],
  })
  async upload(
    @Param("pageId") pageId: string,
    @Query() query: z.output<typeof uploadQuery>,
    @Req() request: FastifyRequest,
  ) {
    const body = request.body as Readable | undefined;
    if (!body || typeof (body as { pipe?: unknown }).pipe !== "function") {
      throw new ProblemException("unsupportedMediaType", "Send the file as application/octet-stream");
    }
    const length = request.headers["content-length"];
    return this.#services.attachments.upload(actorOf(request), pageId, {
      name: query.name,
      body,
      contentLength: length && /^\d+$/.test(length) ? Number(length) : undefined,
    });
  }

  @Get("attachments/:attachmentId")
  @Permission("attachment.view", attachment)
  @ApiRoute({
    summary: "Get an attachment",
    description:
      "Returns the attachment with its current version: the draft state for people who can edit the page, the published state for everyone else.",
    tags: [TAG],
    params: attachmentParams,
    response: { description: "The attachment.", schema: attachmentSchema, example: exampleAttachment },
  })
  async get(@Param("attachmentId") attachmentId: string, @Req() request: FastifyRequest) {
    const actor = actorOf(request);
    const found = await this.#services.attachments.get(
      actor,
      attachmentId,
      await this.#view(actor, "attachment.edit", attachmentId),
    );
    if (!found) throw notFound();
    return found;
  }

  @Get("attachments/:attachmentId/versions")
  @Permission("attachment.view", attachment)
  @ApiRoute({
    summary: "List the versions of an attachment",
    description:
      "Lists the stored versions, newest first. People who cannot edit the page see only versions that were published. When a new version is added and more versions than configured exist, the oldest version not marked to keep is removed.",
    tags: [TAG],
    params: attachmentParams,
    response: {
      description: "The versions.",
      schema: z.array(attachmentVersionSchema).describe("Versions, newest first."),
      example: [exampleAttachmentVersion],
    },
  })
  async versions(@Param("attachmentId") attachmentId: string, @Req() request: FastifyRequest) {
    const actor = actorOf(request);
    return this.#services.attachments.versions(
      actor,
      attachmentId,
      await this.#view(actor, "attachment.edit", attachmentId),
    );
  }

  @Post("attachments/:attachmentId/versions/:number/restore")
  @Permission("attachment.edit", attachment)
  @ApiRoute({
    summary: "Restore an earlier version",
    description: "Makes an earlier version current again by adding it as a new version.",
    tags: [TAG],
    params: versionParams,
    status: 200,
    response: { description: "The attachment.", schema: attachmentSchema, example: exampleAttachment },
    errors: ["versionNotFound"],
  })
  async restoreVersion(
    @Param("attachmentId") attachmentId: string,
    @Param("number") number: number,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.attachments.restoreVersion(actorOf(request), attachmentId, number);
  }

  @Put("attachments/:attachmentId/versions/:number/keep")
  @Permission("attachment.edit", attachment)
  @ApiRoute({
    summary: "Keep a version",
    description:
      "Marks a version to keep or removes the mark. Marked versions are never removed automatically and do not count towards the number of versions kept. The change is recorded in the audit log.",
    tags: [TAG],
    params: versionParams,
    body: keepVersionSchema,
    bodyExample: { kept: true },
    status: 200,
    response: {
      description: "The version.",
      schema: attachmentVersionSchema,
      example: { ...exampleAttachmentVersion, kept: true },
    },
    errors: ["versionNotFound"],
  })
  async keepVersion(
    @Param("attachmentId") attachmentId: string,
    @Param("number") number: number,
    @Body() body: z.output<typeof keepVersionSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.attachments.setKept(actorOf(request), attachmentId, number, body.kept);
  }

  @Delete("attachments/:attachmentId")
  @Permission("attachment.edit", attachment)
  @ApiRoute({
    summary: "Delete an attachment",
    description:
      "Removes the attachment from the page. It can be brought back with all versions until the page itself is deleted for good. A blog post that used it as cover loses its cover.",
    tags: [TAG],
    params: attachmentParams,
  })
  async delete(@Param("attachmentId") attachmentId: string, @Req() request: FastifyRequest) {
    await this.#services.attachments.delete(actorOf(request), attachmentId);
  }

  @Post("pages/:pageId/attachments/:attachmentId/restore")
  @Permission("item.edit", page)
  @ApiRoute({
    summary: "Bring back a deleted attachment",
    description:
      "Undoes the deletion of an attachment of this page, also of one deleted in the draft that readers still see until the next publication.",
    tags: [TAG],
    params: restoreParams,
    status: 200,
    response: { description: "The attachment.", schema: attachmentSchema, example: exampleAttachment },
    errors: ["nameTaken", "attachmentNotFound"],
  })
  async undelete(
    @Param("pageId") pageId: string,
    @Param("attachmentId") attachmentId: string,
    @Req() request: FastifyRequest,
  ) {
    if ((await this.#services.attachments.deletedItemOf(attachmentId)) !== pageId) throw notFound();
    return this.#services.attachments.undelete(actorOf(request), attachmentId);
  }

  @Get("attachments/:attachmentId/content")
  @Permission("attachment.view", attachment)
  @ApiRoute({
    summary: "Download an attachment",
    description:
      "Sends the bytes of the current or a given version. People who cannot edit the page get the published version and can ask only for published versions. Images, video and audio are sent inline unless `download` is set; every other type always as a download.",
    tags: [TAG],
    params: attachmentParams,
    query: contentQuery,
    raw: rawFile,
    errors: ["versionNotFound", "rangeNotSatisfiable", "imageTooLarge"],
  })
  async content(
    @Param("attachmentId") attachmentId: string,
    @Query() query: z.output<typeof contentQuery>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const view = await this.#view(actorOf(request), "attachment.edit", attachmentId);
    const content = await this.#services.attachments.content(attachmentId, view, query.version);
    if (!content) throw new ProblemException("versionNotFound", "This version does not exist");
    const shown = sized(await this.#services.displayVersions.apply(content, query.size));
    return sendAttachment(request, reply, this.#services.files, shown, {
      inline: !query.download,
      crossOrigin: false,
    });
  }

  @Get("attachments/:attachmentId/link")
  @Permission("attachment.view", attachment, { sessionOnly: true })
  @ApiRoute({
    summary: "Get a short-lived address of an attachment",
    description: `Returns an address of the file that works for ${LINK_MINUTES} minutes without the session cookie, for media players and the separate file origin. Access is checked again on every request to it.`,
    tags: [TAG],
    params: attachmentParams,
    query: linkQuery,
    response: {
      description: "The address.",
      schema: fileLinkSchema,
      example: { url: "/api/v1/files/1a2b3c.example", expiresAt: "2026-10-08T12:10:00.000Z" },
    },
  })
  async link(
    @Param("attachmentId") attachmentId: string,
    @Query() query: z.output<typeof linkQuery>,
    @Req() request: FastifyRequest,
  ) {
    const actor = actorOf(request);
    const view = await this.#view(actor, "attachment.edit", attachmentId);
    const content = await this.#services.attachments.content(attachmentId, view, query.version);
    if (!content) throw new ProblemException("versionNotFound", "This version does not exist");
    const expiresAt = new Date(Date.now() + LINK_MINUTES * 60_000);
    const signature = await this.#services.signer.sign(
      "file",
      [actor.id, attachmentId, String(content.version)],
      expiresAt,
    );
    const token = `${actor.id}.${attachmentId}.${content.version}.${signature}`;
    return { url: `${this.context.filesUrl ?? ""}/api/v1/files/${encodeURIComponent(token)}`, expiresAt };
  }

  @Get("files/:token")
  @PublicRoute()
  @InternalRoute()
  @ApiRoute({
    summary: "Download through a short-lived address",
    description:
      "Sends a file through an address from the link endpoint. The address expires after a few minutes, and the access of the person it was made for is checked again.",
    tags: [TAG],
    params: fileTokenParams,
    raw: rawFile,
    errors: ["rangeNotSatisfiable"],
  })
  async file(
    @Param("token") token: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const parts = token.split(".");
    const [accountId = "", attachmentId = "", version = ""] = parts;
    const signature = parts.slice(3).join(".");
    const valid =
      parts.length === 5 &&
      /^\d+$/.test(version) &&
      (await this.#services.signer.verify("file", [accountId, attachmentId, version], signature));
    if (!valid) throw notFound("The address has expired; open the file again from the page");
    const allowed = await this.#services.authorization.authorize(
      accountPrincipal(accountId),
      "attachment.view",
      {
        type: "attachment",
        id: attachmentId,
      },
    );
    if (!allowed) throw notFound();
    const view = await this.#view(accountPrincipal(accountId), "attachment.edit", attachmentId);
    const content = await this.#services.attachments.content(attachmentId, view, Number(version));
    if (!content) throw notFound();
    return sendAttachment(request, reply, this.#services.files, content, {
      inline: true,
      crossOrigin: this.context.filesUrl !== undefined,
    });
  }
}
