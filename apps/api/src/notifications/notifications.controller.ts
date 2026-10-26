import {
  type AnnouncementChangeSignal,
  type AuditChangeSignal,
  accountPrincipal,
  currentRequestContext,
  type ImportChangeSignal,
  type NotificationCursor,
  notificationKinds,
  type RequestContext,
  runWithRequestContext,
  type SettingChangeSignal,
  type SpaceChangeSignal,
  type SyncRunSignal,
  type UnsubscribeState,
} from "@lunedo/server";
import { idSchema, UNREAD_COUNT_CAP } from "@lunedo/shared";
import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { InternalRoute, PublicRoute, SessionRoute } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { decodeCursor, encodeCursor, pageQuery, pageSchema } from "../http/pagination.js";
import { notFound, ProblemException } from "../http/problems.js";
import { sessionOf } from "../http/request.js";
import { SpaceSignals } from "./space-signals.js";

const TAG = "Notifications";

const INSTANCE_VIEWERS: Partial<Record<AuditChangeSignal["target"], InstanceAction>> = {
  account: "instance.accounts.view",
  invitation: "instance.accounts.view",
  organization: "instance.organizations.view",
  role: "instance.roles.view",
  roleAssignment: "instance.roles.view",
  identityProvider: "instance.signIn.view",
  mappingRule: "instance.signIn.view",
};

const INSTANCE_VIEWERS_OF_ORGANIZATION_OBJECTS: Partial<Record<AuditChangeSignal["target"], InstanceAction>> =
  {
    account: "instance.accounts.view",
    organization: "instance.organizations.view",
    identityProvider: "instance.signIn.view",
    mappingRule: "instance.signIn.view",
  };

const ORGANIZATION_VIEWERS: Partial<Record<AuditChangeSignal["target"], OrganizationAction>> = {
  account: "organization.members.view",
  invitation: "organization.members.view",
  group: "organization.groups.view",
  role: "organization.roles.view",
  roleAssignment: "organization.roles.view",
  apiToken: "organization.integrations.view",
};

type InstanceAction =
  | "instance.accounts.view"
  | "instance.organizations.view"
  | "instance.roles.view"
  | "instance.signIn.view"
  | "instance.audit.view";
type OrganizationAction =
  | "organization.members.view"
  | "organization.groups.view"
  | "organization.roles.view"
  | "organization.integrations.view"
  | "organization.audit.view";

export const HEARTBEAT_MS = 25_000;
export const SPACE_DECISION_MS = 10_000;

const cursorSchema = z.tuple([
  z
    .string()
    .max(64)
    .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/),
  idSchema,
]);

const listQuery = z
  .object({
    ...pageQuery,
    unread: z.enum(["true", "false"]).optional(),
    kind: z
      .enum(notificationKinds)
      .optional()
      .describe(
        "Only `mentions`, notifications about `watched` content, or access `requests` to decide. Leave it out for all.",
      ),
    spaceId: idSchema
      .optional()
      .describe("Only notifications about content or access requests of this space."),
    grouped: z
      .enum(["true", "false"])
      .optional()
      .describe(
        "`true` combines changes to several items of one space on one day into one entry with its members.",
      ),
  })
  .strict();

const notificationSchema = z.object({
  id: idSchema,
  type: z.string(),
  organizationId: idSchema.nullable(),
  target: z.object({ type: z.string(), id: z.string().nullable() }),
  actor: z.object({ type: z.string(), id: idSchema.nullable(), name: z.string().nullable() }).nullable(),
  actorCount: z
    .number()
    .int()
    .describe("Number of different people whose actions are combined in this notification."),
  params: z.json(),
  count: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
  preview: z
    .string()
    .nullable()
    .optional()
    .describe("One line of the comment, task or request text, when the caller may still read it."),
  group: z
    .object({
      spaceId: idSchema,
      spaceKey: z.string(),
      spaceName: z.string(),
      day: z.string().describe("The day in the time zone of the caller, as YYYY-MM-DD."),
      actors: z
        .array(z.object({ id: idSchema, name: z.string() }))
        .describe("Up to three people who made changes."),
      actorCount: z.number().int().describe("Number of different people who made changes."),
      members: z
        .array(
          z.object({
            id: idSchema,
            itemId: z.string().nullable(),
            itemTitle: z.string(),
            actor: z.object({ id: idSchema.nullable(), name: z.string().nullable() }).nullable(),
            updatedAt: z.iso.datetime(),
            readAt: z.iso.datetime().nullable(),
          }),
        )
        .describe("The combined notifications, most recent first."),
    })
    .nullable()
    .optional()
    .describe("For a combined entry: the space, the day and the notifications it combines."),
});

const readManySchema = z
  .object({ ids: z.array(idSchema).min(1).max(100).describe("Notifications to mark as read.") })
  .strict();

const idParams = z.object({ notificationId: idSchema }).strict();
const unsubscribeParams = z
  .object({ token: z.string().max(200).describe("The signed token from the link in the e-mail.") })
  .strict();
const oneClickSchema = z
  .object({
    "List-Unsubscribe": z
      .string()
      .max(100)
      .optional()
      .describe("`One-Click`, as mail programs send it for one-click unsubscribe (RFC 8058)."),
  })
  .optional();
const unsubscribeSchema = z
  .object({
    scope: z
      .enum(["event", "digest"])
      .describe("Whether the link turns off e-mail for one event or the daily summary."),
    event: z
      .string()
      .nullable()
      .describe("The event whose e-mails the link turns off, null for the summary."),
    off: z.boolean().describe("Whether these e-mails are turned off now."),
  })
  .describe("What an unsubscribe link turns off.");

function unsubscribeView(state: UnsubscribeState) {
  return {
    scope: state.scope.kind,
    event: state.scope.kind === "event" ? state.scope.event : null,
    off: state.off,
  };
}
const readAllSchema = z.object({ before: z.iso.datetime().optional() }).strict();
const countSchema = z.object({
  count: z.number().int().min(0).max(UNREAD_COUNT_CAP).describe(`Counts up to ${UNREAD_COUNT_CAP}.`),
  capped: z
    .boolean()
    .describe(
      `True when there are more than ${UNREAD_COUNT_CAP} unread notifications; \`count\` is then ${UNREAD_COUNT_CAP}.`,
    ),
});
const countQuery = z
  .object({
    kind: z.enum(notificationKinds).optional().describe("Count only notifications of this kind."),
  })
  .strict();
const markedSchema = z.object({ marked: z.number().int() });

@Controller("api/v1/notifications")
@InternalRoute()
export class NotificationsController {
  #spaceSignals: SpaceSignals | undefined;

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
      kind: query.kind,
      spaceId: query.spaceId,
      grouped: query.grouped === "true",
    });
    return { items: page.items, nextCursor: page.next ? encodeCursor(page.next) : null };
  }

  @Get("unread-count")
  @SessionRoute()
  @ApiRoute({
    summary: "Count unread notifications",
    tags: [TAG],
    query: countQuery,
    response: { description: "Unread notifications the caller may still see.", schema: countSchema },
  })
  async unreadCount(@Req() request: FastifyRequest, @Query() query: z.output<typeof countQuery>) {
    return await this.#notifications.unreadCount(sessionOf(request).accountId, query.kind);
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

  @Post("read")
  @SessionRoute()
  @ApiRoute({
    summary: "Mark several notifications as read",
    description: "Notifications that do not exist or that the caller may no longer see are skipped.",
    tags: [TAG],
    status: 200,
    body: readManySchema,
    response: { description: "Number of notifications marked as read.", schema: markedSchema },
  })
  async readMany(@Req() request: FastifyRequest, @Body() body: z.output<typeof readManySchema>) {
    const accountId = sessionOf(request).accountId;
    let marked = 0;
    for (const id of body.ids) if (await this.#notifications.markRead(accountId, id)) marked += 1;
    return { marked };
  }

  @Get("unsubscribe/:token")
  @PublicRoute()
  @ApiRoute({
    summary: "Show what an unsubscribe link turns off",
    description: "Works without signing in. The token comes from the link in a notification e-mail.",
    tags: [TAG],
    params: unsubscribeParams,
    response: { description: "The e-mails the link turns off.", schema: unsubscribeSchema },
    errors: ["invalidToken"],
  })
  async describeUnsubscribe(@Param("token") token: string) {
    const state = await servicesOf(this.context).unsubscribe.describe(token);
    if (!state) throw new ProblemException("invalidToken", "The unsubscribe link is not valid");
    return unsubscribeView(state);
  }

  @Post("unsubscribe/:token")
  @PublicRoute()
  @ApiRoute({
    summary: "Turn off e-mails with an unsubscribe link",
    description:
      "Works without signing in and is the target of the `List-Unsubscribe` header, so mail programs can unsubscribe with one click. It turns off e-mail for the event of the link, or the daily summary, for the person the link was sent to and changes nothing else.",
    tags: [TAG],
    status: 200,
    params: unsubscribeParams,
    body: oneClickSchema,
    response: { description: "The e-mails the link turned off.", schema: unsubscribeSchema },
    errors: ["invalidToken", "settingLocked"],
  })
  async unsubscribe(@Param("token") token: string) {
    const result = await servicesOf(this.context).unsubscribe.apply(token);
    if (!result) throw new ProblemException("invalidToken", "The unsubscribe link is not valid");
    if (!result.applied) {
      throw new ProblemException(
        "settingLocked",
        "Your organization requires these e-mails. Ask an administrator of your organization to change it.",
      );
    }
    return unsubscribeView(result.state);
  }

  @Get(":notificationId")
  @SessionRoute()
  @ApiRoute({
    summary: "Get a notification",
    description: "Notifications the caller can no longer see answer like unknown ones.",
    tags: [TAG],
    params: idParams,
    response: { description: "The notification.", schema: notificationSchema },
  })
  async get(@Param("notificationId") id: string, @Req() request: FastifyRequest) {
    const item = await this.#notifications.get(sessionOf(request).accountId, id);
    if (!item) throw notFound();
    return item;
  }

  @Post(":notificationId/read")
  @SessionRoute()
  @ApiRoute({ summary: "Mark a notification as read", tags: [TAG], params: idParams })
  async read(@Param("notificationId") id: string, @Req() request: FastifyRequest) {
    if (!(await this.#notifications.markRead(sessionOf(request).accountId, id))) throw notFound();
  }

  @Post(":notificationId/unread")
  @SessionRoute()
  @ApiRoute({ summary: "Mark a notification as unread", tags: [TAG], params: idParams })
  async unread(@Param("notificationId") id: string, @Req() request: FastifyRequest) {
    if (!(await this.#notifications.markUnread(sessionOf(request).accountId, id))) throw notFound();
  }

  @Get("stream")
  @SessionRoute()
  @ApiRoute({
    summary: "Follow notification changes",
    tags: [TAG],
    raw: {
      contentTypes: ["text/event-stream"],
      description:
        "Server-sent events. The event `notifications` carries the unread count (`unreadCount`, at most 100, with `unreadCapped` true when there are more) at the start and after every change. The event `settings` names a setting whose value for the caller may have changed, with its level and, for an organization, the organization ID; reload the setting. The event `syncRuns` names a run of a provider's sync log that started, changed or ended, sent only to callers who may view sign-in providers; reload the sync log. The event `changes` names the kind of object that changed in the instance or in an organization, as recorded in the audit log, sent only to callers who may view such objects there or the audit log of that level; reload lists that show such objects. The event `spaces` names a space whose settings, access, page tree or page content changed, or where someone opened or left a page in the editor, with the kind of change and the affected item, sent only to callers who can read the space; reload what shows it. The event `imports` names an import whose state or progress changed, with its organization, sent only to callers who can see the import; reload it. The event `announcements` says that the announcement of the instance or of one of the caller's organizations changed; reload the announcements. The event `maintenance` says that maintenance mode was switched on or off or its message changed; reload `GET /api/v1/maintenance`.",
      example:
        'event: notifications\ndata: {"unreadCount":2,"unreadCapped":false}\n\nevent: settings\ndata: {"key":"branding.accentColor","level":"instance","organizationId":null}\n\nevent: syncRuns\ndata: {"providerId":"01929b1e-0000-7000-8000-000000000001","runId":"01929b1e-0000-7000-8000-000000000002"}\n\nevent: changes\ndata: {"scope":"organization","organizationId":"01929b1e-0000-7000-8000-000000000003","target":"group"}\n\n',
    },
  })
  async stream(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    const hub = this.context.notificationHub;
    if (!hub) throw notFound();
    const services = servicesOf(this.context);
    this.#spaceSignals ??= new SpaceSignals(hub, (accountIds, spaceId) =>
      services.authorization.spaceAudience(accountIds, spaceId),
    );
    const spaceSignals = this.#spaceSignals;
    const session = sessionOf(request);
    const logger = this.context.logger;
    const streamContext = currentRequestContext();
    if (streamContext) streamContext.cache = undefined;
    const taskContext: RequestContext = { ...(streamContext ?? { requestId: request.id }) };
    let closed = false;
    let queue = Promise.resolve();
    const enqueue = (task: () => Promise<void>, failure: string) => {
      queue = queue
        .then(() => runWithRequestContext({ ...taskContext, cache: new Map() }, task))
        .catch((error: unknown) => logger.warn({ err: error }, failure));
    };
    const raw = reply.raw;
    const send = () => {
      enqueue(async () => {
        if (closed) return;
        const unread = await services.notifications.unreadCount(session.accountId);
        if (!closed)
          raw.write(
            `event: notifications\ndata: ${JSON.stringify({ unreadCount: unread.count, unreadCapped: unread.capped })}\n\n`,
          );
      }, "Sending a notification event failed");
    };
    const sendSetting = (signal: SettingChangeSignal) => {
      enqueue(async () => {
        if (closed || !(await this.context.settings?.affects(session.accountId, signal))) return;
        const data = {
          key: signal.key,
          level: signal.level,
          organizationId: signal.level === "organization" ? signal.id : null,
        };
        if (!closed) raw.write(`event: settings\ndata: ${JSON.stringify(data)}\n\n`);
      }, "Sending a settings event failed");
    };
    const sendSyncRun = (signal: SyncRunSignal) => {
      enqueue(async () => {
        if (closed) return;
        const decision = await services.authorization.explain(
          accountPrincipal(session.accountId),
          "instance.signIn.view",
          { type: "instance" },
        );
        if (!decision.allowed || closed) return;
        raw.write(`event: syncRuns
data: ${JSON.stringify(signal)}

`);
      }, "Sending a sync run event failed");
    };
    const pendingChanges = new Set<string>();
    const mayFollow = async (signal: AuditChangeSignal): Promise<boolean> => {
      const principal = accountPrincipal(session.accountId);
      const allowed = async (
        action: InstanceAction | OrganizationAction,
        level: "instance" | "organization",
      ) => {
        const resource =
          level === "organization" && signal.organizationId
            ? { type: "organization", id: signal.organizationId }
            : { type: "instance" };
        return (await services.authorization.explain(principal, action, resource)).allowed;
      };
      if (signal.scope === "organization") {
        if (!signal.organizationId) return false;
        const viewer = ORGANIZATION_VIEWERS[signal.target];
        const across = INSTANCE_VIEWERS_OF_ORGANIZATION_OBJECTS[signal.target];
        return (
          (viewer !== undefined && (await allowed(viewer, "organization"))) ||
          (await allowed("organization.audit.view", "organization")) ||
          (across !== undefined && (await allowed(across, "instance")))
        );
      }
      const instanceViewer = INSTANCE_VIEWERS[signal.target];
      return (
        (instanceViewer !== undefined && (await allowed(instanceViewer, "instance"))) ||
        (await allowed("instance.audit.view", "instance"))
      );
    };
    const spaceDecisions = new Map<string, { allowed: boolean; at: number }>();
    const sendChange = (signal: AuditChangeSignal) => {
      spaceDecisions.clear();
      const { accountId: _accountId, ...shown } = signal;
      const data = JSON.stringify(shown);
      if (pendingChanges.has(data)) return;
      pendingChanges.add(data);
      enqueue(async () => {
        pendingChanges.delete(data);
        if (closed || !(await mayFollow(signal)) || closed) return;
        raw.write(`event: changes\ndata: ${data}\n\n`);
      }, "Sending a change event failed");
    };
    const pendingSpaces = new Set<string>();
    const sendSpace = (signal: SpaceChangeSignal) => {
      const data = JSON.stringify(signal);
      if (pendingSpaces.has(data)) return;
      pendingSpaces.add(data);
      enqueue(async () => {
        pendingSpaces.delete(data);
        if (closed || !(await spaceSignals.reaches(signal.spaceId, session.accountId))) return;
        if (signal.kind === "access") spaceDecisions.delete(`space.edit:${signal.spaceId}`);
        const mayInSpace = async (action: "space.view" | "space.edit"): Promise<boolean> => {
          const cacheKey = `${action}:${signal.spaceId}`;
          const cached = spaceDecisions.get(cacheKey);
          if (cached && signal.kind !== "access" && Date.now() - cached.at < SPACE_DECISION_MS) {
            return cached.allowed;
          }
          const allowed = (
            await services.authorization.explain(accountPrincipal(session.accountId), action, {
              type: "space",
              id: signal.spaceId,
            })
          ).allowed;
          spaceDecisions.set(cacheKey, { allowed, at: Date.now() });
          return allowed;
        };
        const mayOnItem = async (action: "item.view" | "item.edit", itemId: string): Promise<boolean> =>
          (
            await services.authorization.explain(accountPrincipal(session.accountId), action, {
              type: "item",
              id: itemId,
            })
          ).allowed;
        const spaceVisible = await mayInSpace("space.view");
        let forwarded = signal;
        if (signal.itemId) {
          if (!(await mayOnItem("item.view", signal.itemId))) {
            if (!spaceVisible || signal.kind === "page" || signal.kind === "draft") return;
            forwarded = { ...signal, itemId: null };
          } else if (
            signal.kind === "draft" &&
            !(await mayInSpace("space.edit")) &&
            !(await mayOnItem("item.edit", signal.itemId))
          ) {
            return;
          }
        } else if (!spaceVisible || (signal.kind === "draft" && !(await mayInSpace("space.edit")))) {
          return;
        }
        if (!closed) raw.write(`event: spaces\ndata: ${JSON.stringify(forwarded)}\n\n`);
      }, "Sending a space event failed");
    };
    const pendingImports = new Set<string>();
    const sendImport = (signal: ImportChangeSignal) => {
      if (pendingImports.has(signal.importId)) return;
      pendingImports.add(signal.importId);
      enqueue(async () => {
        pendingImports.delete(signal.importId);
        if (closed) return;
        const principal = accountPrincipal(session.accountId);
        const resource = { type: "import", id: signal.importId };
        const allowed =
          (await services.authorization.explain(principal, "import.view", resource)).allowed ||
          (await services.authorization.explain(principal, "import.takeOver", resource)).allowed;
        if (!allowed || closed) return;
        raw.write(`event: imports
data: ${JSON.stringify(signal)}

`);
      }, "Sending an import event failed");
    };
    const pendingAnnouncements = new Set<string>();
    const sendAnnouncement = (signal: AnnouncementChangeSignal) => {
      const data = JSON.stringify(signal);
      if (pendingAnnouncements.has(data)) return;
      pendingAnnouncements.add(data);
      enqueue(async () => {
        pendingAnnouncements.delete(data);
        if (closed) return;
        if (signal.organizationId) {
          const decision = await services.authorization.explain(
            accountPrincipal(session.accountId),
            "organization.view",
            { type: "organization", id: signal.organizationId },
          );
          if (!decision.allowed || closed) return;
        }
        raw.write(`event: announcements
data: ${data}

`);
      }, "Sending an announcement event failed");
    };
    const unsubscribe = await hub.subscribe(session.accountId, send);
    const unsubscribeSettings = await hub.subscribeSettings(sendSetting);
    const unsubscribeSyncRuns = await hub.subscribeSyncRuns(sendSyncRun);
    const unsubscribeChanges = await hub.subscribeChanges(sendChange);
    const unsubscribeSpaces = await spaceSignals.join(session.accountId, sendSpace);
    const unsubscribeImports = await hub.subscribeImports(sendImport);
    const unsubscribeAnnouncements = await hub.subscribeAnnouncements(sendAnnouncement);
    const unsubscribeMaintenance = await hub.subscribeMaintenance(() => {
      if (!closed) raw.write("event: maintenance\ndata: {}\n\n");
    });
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
      unsubscribeSyncRuns();
      unsubscribeChanges();
      unsubscribeSpaces();
      unsubscribeImports();
      unsubscribeAnnouncements();
      unsubscribeMaintenance();
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
