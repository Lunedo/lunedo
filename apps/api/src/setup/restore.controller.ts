import type { Readable } from "node:stream";
import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { InternalRoute, PublicRoute, SetupSessionRoute } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { COOKIES, readCookie, setCookie } from "../http/cookies.js";
import { ProblemException } from "../http/problems.js";

const TAG = "Setup";
const RESTORE_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;
const MAX_BACKUP_BYTES = 10 * 1024 ** 4;

const uploadId = z
  .string()
  .regex(/^[0-9a-f-]{36}$/)
  .describe("ID of the upload.");

const backupSchema = z
  .object({
    name: z.string().describe("File name of the backup."),
    size: z.number().int().describe("Size in bytes."),
    createdAt: z.string().nullable().describe("When the backup was created, from its header."),
    lunedoVersion: z.string().nullable().describe("The Lunedo version that created the backup."),
    scope: z
      .enum(["all", "database"])
      .nullable()
      .describe("`all` with the file store, `database` without it. Null when the header is not readable."),
    readable: z.boolean().describe("Whether the header of the backup could be read."),
  })
  .describe("A backup that can be restored.");

const directoryQuery = z
  .object({
    directory: z
      .string()
      .max(4096)
      .optional()
      .describe("An absolute directory on the server. Defaults to LUNEDO_BACKUP_DIR."),
  })
  .strict();

const s3Schema = z
  .object({
    endpoint: z
      .url()
      .max(2048)
      .nullable()
      .describe("Endpoint of S3-compatible storage, or null for Amazon S3."),
    region: z.string().min(1).max(64).default("us-east-1").describe("Region of the bucket."),
    bucket: z.string().min(1).max(255).describe("Name of the bucket."),
    prefix: z.string().max(512).default("").describe("Prefix of the backups in the bucket."),
    forcePathStyle: z.boolean().default(true).describe("Address the bucket in the path instead of the host."),
    accessKeyId: z.string().min(1).max(256).describe("Access key. Used for this restore only, never stored."),
    secretAccessKey: z
      .string()
      .min(1)
      .max(1024)
      .describe("Secret key. Used for this restore only, never stored."),
  })
  .strict()
  .describe("The bucket the backups of the earlier server are in.");

const uploadSchema = z
  .object({
    id: uploadId,
    name: z.string().describe("File name the backup gets in the backup directory."),
    size: z.number().int().describe("Size of the whole file in bytes."),
    received: z.number().int().describe("Bytes received so far; the next part starts here."),
    complete: z.boolean().describe("Whether the whole file was received."),
    file: z.string().nullable().describe("File name in the backup directory once complete."),
  })
  .describe("A backup that is being uploaded in parts.");

const startSchema = z
  .object({
    source: z
      .discriminatedUnion("type", [
        z
          .object({
            type: z.literal("directory"),
            directory: z
              .string()
              .max(4096)
              .optional()
              .describe("Directory on the server; LUNEDO_BACKUP_DIR if not set."),
            name: z.string().min(1).max(255).describe("File name of the backup."),
          })
          .strict()
          .describe("A backup in a directory of the server."),
        z
          .object({
            type: z.literal("upload"),
            name: z.string().min(1).max(255).describe("File name of the completed upload."),
          })
          .strict()
          .describe("A backup uploaded in parts."),
        s3Schema
          .extend({
            type: z.literal("s3"),
            name: z.string().min(1).max(255).describe("Name of the backup in the bucket."),
          })
          .strict()
          .describe("A backup in a bucket; the server downloads it directly."),
      ])
      .describe("Where the backup comes from."),
    backupKey: z
      .string()
      .min(1)
      .max(4096)
      .describe("The backup key ring of the earlier server, as in LUNEDO_BACKUP_KEY or its key file."),
    masterKeys: z
      .string()
      .min(1)
      .max(65536)
      .describe("The content of the key file or the master key ring of the earlier server."),
  })
  .strict()
  .describe("What to restore and the keys to read it.");

const statusSchema = z
  .object({
    state: z.enum(["running", "done", "failed"]).describe("State of the restore."),
    backup: z.string().describe("File name of the backup."),
    steps: z
      .array(
        z
          .object({
            id: z
              .enum(["download", "verify", "database", "files", "migrations"])
              .describe("The step: download from the bucket, verify, database, file store, migrations."),
            state: z.enum(["waiting", "running", "done", "failed"]).describe("State of the step."),
          })
          .describe("A step of the restore."),
      )
      .describe("The steps in order."),
    failure: z
      .object({
        code: z
          .enum([
            "backupKey",
            "masterKeys",
            "invalidBackup",
            "source",
            "restore",
            "migrations",
            "interrupted",
          ])
          .describe("Why the restore failed."),
        message: z.string().describe("What went wrong, in English, as the command line restore says it."),
      })
      .nullable()
      .describe("Why the restore failed, or null."),
    startedAt: z.string().describe("When the restore started."),
    finishedAt: z.string().nullable().describe("When it finished, or null while it runs."),
  })
  .describe("Progress of the restore during the setup.");

@Controller("api/v1/setup/restore")
@InternalRoute()
export class SetupRestoreController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #restore() {
    return servicesOf(this.context).setupRestore;
  }

  @Get("sources")
  @SetupSessionRoute()
  @ApiRoute({
    summary: "List the backups in a directory of the server",
    tags: [TAG],
    query: directoryQuery,
    response: {
      description: "The directory, the free space of the backup directory and the backups.",
      schema: z.object({
        directory: z.string().describe("The directory that was listed."),
        freeBytes: z.number().describe("Free space in the backup directory, the limit for uploads."),
        backups: z.array(backupSchema).describe("Backups, newest first."),
      }),
    },
    errors: ["directoryNotReadable"],
  })
  async sources(@Query() query: z.output<typeof directoryQuery>) {
    return this.#restore.listDirectory(query.directory);
  }

  @Post("s3")
  @SetupSessionRoute()
  @ApiRoute({
    summary: "List the backups in a bucket",
    tags: [TAG],
    status: 200,
    body: s3Schema,
    response: {
      description: "The backups in the bucket, newest first.",
      schema: z.object({ backups: z.array(backupSchema).describe("Backups, newest first.") }),
    },
    errors: ["backupTargetFailed"],
  })
  async s3(@Body() body: z.output<typeof s3Schema>) {
    return { backups: await this.#restore.listS3(body) };
  }

  @Post("uploads")
  @SetupSessionRoute()
  @ApiRoute({
    summary: "Start uploading a backup",
    description:
      "Announces a backup file that is sent in parts of at most 8 MiB, so the body limit of a reverse proxy does not matter. The file may be as large as the free space of the backup directory.",
    tags: [TAG],
    status: 201,
    body: z
      .object({
        name: z.string().min(1).max(255).describe("File name of the backup."),
        size: z.number().int().positive().max(MAX_BACKUP_BYTES).describe("Size of the file in bytes."),
      })
      .strict(),
    response: { description: "The upload.", schema: uploadSchema },
    errors: ["notEnoughSpace"],
  })
  async startUpload(@Body() body: { name: string; size: number }) {
    return this.#restore.startUpload(body);
  }

  @Get("uploads/:uploadId")
  @SetupSessionRoute()
  @ApiRoute({
    summary: "Get an upload",
    description: "Says how many bytes arrived, so an interrupted upload continues where it stopped.",
    tags: [TAG],
    params: z.object({ uploadId }).strict(),
    response: { description: "The upload.", schema: uploadSchema },
    errors: ["uploadNotFound"],
  })
  async upload(@Param("uploadId") id: string) {
    return this.#restore.upload(id);
  }

  @Put("uploads/:uploadId")
  @SetupSessionRoute()
  @ApiRoute({
    summary: "Upload a part of a backup",
    description:
      "Send the next bytes with `Content-Type: application/octet-stream` and `offset` set to the bytes received so far. A part has at most 8 MiB.",
    tags: [TAG],
    params: z.object({ uploadId }).strict(),
    query: z
      .object({ offset: z.coerce.number().int().min(0).describe("Position of the part in the file.") })
      .strict(),
    upload: { contentTypes: ["application/octet-stream"], description: "The bytes of the part." },
    response: { description: "The upload.", schema: uploadSchema },
    errors: ["uploadNotFound", "uploadOffset", "uploadTooLarge", "unsupportedMediaType"],
  })
  async appendUpload(
    @Param("uploadId") id: string,
    @Query() query: { offset: number },
    @Req() request: FastifyRequest,
  ) {
    const body = request.body as Readable | undefined;
    if (!body || typeof (body as { pipe?: unknown }).pipe !== "function") {
      throw new ProblemException("unsupportedMediaType", "Send the part as application/octet-stream");
    }
    return this.#restore.appendUpload(id, query.offset, body);
  }

  @Post()
  @SetupSessionRoute()
  @ApiRoute({
    summary: "Restore a backup into this instance",
    description:
      "Verifies the backup with the given keys and restores it in the background. The status is read with the cookie this request sets. Afterwards the processes of the instance restart, and scheduled backups stay paused until the backup target is confirmed.",
    tags: [TAG],
    status: 202,
    body: startSchema,
    errors: ["invalidKeys", "directoryNotReadable", "backupNotFound", "backupTargetFailed", "restoreRunning"],
  })
  async start(@Body() body: z.output<typeof startSchema>, @Res({ passthrough: true }) reply: FastifyReply) {
    const token = await this.#restore.start(body);
    setCookie(reply, COOKIES.restore, token, RESTORE_COOKIE_MAX_AGE_SECONDS);
  }

  @Get("status")
  @PublicRoute()
  @ApiRoute({
    summary: "Get the progress of the restore",
    description:
      "Answers only the browser that started the restore, through its cookie, also after the restart that ends it.",
    tags: [TAG],
    response: { description: "The progress.", schema: statusSchema },
    errors: ["notFound"],
  })
  async status(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const status = await this.#restore.status(readCookie(request, COOKIES.restore) ?? "");
    if (!status) throw new ProblemException("notFound", "No restore was started in this browser");
    reply.header("cache-control", "no-store");
    return status;
  }
}
