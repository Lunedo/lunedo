import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { NotificationCursor, SettingChangeSignal } from "@pagehall/server";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { InternalRoute, SessionRoute } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { decodeCursor, encodeCursor, pageQuery, pageSchema } from "../http/pagination.js";
import { notFound } from "../http/problems.js";
import { sessionOf } from "../http/request.js";

const TAG = "Notifications";

export const HEARTBEAT_MS = 25_000;

const cursorSchema = z.tuple([
  z
    .string()
    .max(64)
    .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/),
  z.uuid(),
]);

const listQuery = z.object({ ...pageQuery, unread: z.enum(["true", "false"]).optional() }).strict();

const notificationSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  organizationId: z.uuid().nullable(),
  target: z.object({ type: z.string(), id: z.string().nullable() }),
  actor: z.object({ type: z.string(), id: z.uuid().nullable(), name: z.string().nullable() }).nullable(),
  params: z.json(),
  count: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
});

const idParams = z.object({ notificationId: z.uuid() }).strict();
const readAllSchema = z.object({ before: z.iso.datetime().optional() }).strict();
const countSchema = z.object({ count: z.number().int() });
const markedSchema = z.object({ marked: z.number().int() });

@Controller("api/v1/notifications")
@InternalRoute()
export class NotificationsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #notifications() {
    return servicesOf(this.context).notifications;
  }

  @Get()
  @SessionRoute()
  @ApiRoute({
    summary: "List own notifications",
    tags: [TAG],
    query: listQuery,
    response: {
      description: "Notifications the caller may still see.",
      schema: pageSchema(notificationSchema, "Notifications, most recently changed first."),
    },
  })
  async list(@Req() request: FastifyRequest, @Query() query: z.output<typeof listQuery>) {
    const after = decodeCursor(query.cursor, cursorSchema) as NotificationCursor | undefined;
    const page = await this.#notifications.list(sessionOf(request).accountId, {
      after,
      limit: query.limit,
      unreadOnly: query.unread === "true",
    });
    return { items: page.items, nextCursor: page.next ? encodeCursor(page.next) : null };
  }

  @Get("unread-count")
  @SessionRoute()
  @ApiRoute({
    summary: "Count unread notifications",
    tags: [TAG],
    response: { description: "Unread notifications the caller may still see.", schema: countSchema },
  })
  async unreadCount(@Req() request: FastifyRequest) {
    return { count: await this.#notifications.unreadCount(sessionOf(request).accountId) };
  }

  @Post("read-all")
  @SessionRoute()
  @ApiRoute({
    summary: "Mark all notifications as read",
    tags: [TAG],
    status: 200,
    body: readAllSchema,
    response: { description: "Number of notifications marked as read.", schema: markedSchema },
  })
  async readAll(@Req() request: FastifyRequest, @Body() body: z.output<typeof readAllSchema>) {
    const before = body.before ? new Date(body.before) : undefined;
    return { marked: await this.#notifications.markAllRead(sessionOf(request).accountId, before) };
  }

  @Post(":notificationId/read")
  @SessionRoute()
  @ApiRoute({ summary: "Mark a notification as read", tags: [TAG], params: idParams })
  async read(@Param("notificationId") id: string, @Req() request: FastifyRequest) {
    if (!(await this.#notifications.markRead(sessionOf(request).accountId, id))) throw notFound();
  }

  @Get("stream")
  @SessionRoute()
  @ApiRoute({
    summary: "Follow notification changes",
    tags: [TAG],
    raw: {
      contentTypes: ["text/event-stream"],
      description:
        "Server-sent events. The event `notifications` carries the unread count at the start and after every change. The event `settings` names a setting whose value for the caller may have changed, with its level and, for an organization, the organization ID; reload the setting.",
      example:
        'event: notifications\ndata: {"unreadCount":2}\n\nevent: settings\ndata: {"key":"branding.accentColor","level":"instance","organizationId":null}\n\n',
    },
  })
  async stream(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    const hub = this.context.notificationHub;
    if (!hub) throw notFound();
    const services = servicesOf(this.context);
    const session = sessionOf(request);
    const logger = this.context.logger;
    let closed = false;
    let queue = Promise.resolve();
    const raw = reply.raw;
    const send = () => {
      queue = queue
        .then(async () => {
          if (closed) return;
          const unreadCount = await services.notifications.unreadCount(session.accountId);
          if (!closed) raw.write(`event: notifications\ndata: ${JSON.stringify({ unreadCount })}\n\n`);
        })
        .catch((error: unknown) => logger.warn({ err: error }, "Sending a notification event failed"));
    };
    const sendSetting = (signal: SettingChangeSignal) => {
      queue = queue
        .then(async () => {
          if (closed || !(await this.context.settings?.affects(session.accountId, signal))) return;
          const data = {
            key: signal.key,
            level: signal.level,
            organizationId: signal.level === "organization" ? signal.id : null,
          };
          if (!closed) raw.write(`event: settings\ndata: ${JSON.stringify(data)}\n\n`);
        })
        .catch((error: unknown) => logger.warn({ err: error }, "Sending a settings event failed"));
    };
    const unsubscribe = await hub.subscribe(session.accountId, send);
    const unsubscribeSettings = await hub.subscribeSettings(sendSetting);
    const heartbeat = setInterval(() => {
      services.sessions.isActive(session.id).then(
        (active) => {
          if (!active) close();
          else if (!closed) raw.write(": heartbeat\n\n");
        },
        (error: unknown) =>
          logger.warn({ err: error }, "Checking the session of a notification stream failed"),
      );
    }, HEARTBEAT_MS);
    heartbeat.unref();
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      unsubscribeSettings();
      raw.end();
    };
    reply.hijack();
    raw.writeHead(200, {
      "x-request-id": request.id,
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    });
    raw.write(": connected\n\n");
    request.raw.on("close", close);
    send();
  }
}
