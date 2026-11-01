import { commentText, type DocumentJson, extractMentions } from "@lunedo/editor-schema";
import { type NotificationEvent, notificationEventOf, UNREAD_COUNT_CAP } from "@lunedo/shared";
import { and, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import { accounts } from "../accounts/schema.js";
import { accountScopeChain } from "../accounts/scope.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import type { MailService } from "../mail/mail-service.js";
import { hasPushDevice, queuePush } from "../push/outbox.js";
import { timeZoneSetting } from "../settings/builtin.js";
import type { SettingsService } from "../settings/service.js";
import { PeopleService } from "../spaces/people.js";
import { mailWording } from "./mail-texts.js";
import type { NotificationRegistry, NotificationSubject, NotificationTypeDefinition } from "./registry.js";
import { notifications } from "./schema.js";
import { browserPushSetting, notificationEventSettings, notificationRetentionSetting } from "./types.js";
import { isOperationsEvent, type UnsubscribeService } from "./unsubscribe.js";
import { effectiveWatches } from "./watches.js";

export const NOTIFICATIONS_CHANNEL = "lunedo_notifications";

export const COMBINE_WINDOW_MINUTES = 30;
export const COMBINE_MAX_HOURS = 24;
export const ACTIONABLE_MAIL_DELAY_MINUTES = 2;
const MAX_ACTORS = 50;

const SCAN_BATCH = 100;
const SCAN_LIMIT = 1000;
const UNREAD_LIMIT = 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface GroupSpace {
  id: string;
  key: string;
  name: string;
  [key: string]: unknown;
}
const MARK_BATCH = 500;

export interface NotifyInput {
  type: string;
  recipients: readonly string[];
  organizationId: string | null;
  targetId: string | null;
  actor?: Principal | null;
  contributors?: readonly string[];
  params: unknown;
}

export interface NotifyResult {
  mailIds: string[];
  recipients: number;
}

export interface UnreadCount {
  count: number;
  capped: boolean;
}

export interface NotificationItem {
  id: string;
  type: string;
  organizationId: string | null;
  target: { type: string; id: string | null; number: number | null };
  actor: { type: string; id: string | null; name: string | null } | null;
  actorCount: number;
  params: unknown;
  count: number;
  createdAt: Date;
  updatedAt: Date;
  readAt: Date | null;
  preview?: string | null;
  group?: NotificationGroup | null;
}

export interface NotificationGroupMember {
  id: string;
  itemId: string | null;
  number: number | null;
  itemTitle: string;
  actor: { id: string | null; name: string | null } | null;
  updatedAt: Date;
  readAt: Date | null;
}

export interface NotificationGroup {
  spaceId: string;
  spaceKey: string;
  spaceName: string;
  day: string;
  actors: { id: string; name: string }[];
  actorCount: number;
  members: NotificationGroupMember[];
}

export interface VisibilityEntry {
  type: string;
  organizationId: string | null;
  targetId: string | null;
  params: unknown;
}

export type NotificationCursor = [updatedAt: string, id: string];

export interface NotificationPage {
  items: NotificationItem[];
  next: NotificationCursor | null;
}

const itemTargetId = sql`(case when ${notifications.targetType} = 'item'
  and ${notifications.targetId} ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  then ${notifications.targetId}::uuid end)`;

const listColumns = {
  id: notifications.id,
  type: notifications.type,
  organizationId: notifications.organizationId,
  targetType: notifications.targetType,
  targetId: notifications.targetId,
  targetNumber: sql<string | null>`(select t.number::text from tree_items t where t.id = ${itemTargetId})`,
  actorType: notifications.actorType,
  actorId: notifications.actorId,
  actorName: accounts.name,
  actorCount: sql<number>`cardinality(${notifications.actorIds})`,
  params: notifications.params,
  count: notifications.count,
  createdAt: notifications.createdAt,
  updatedAt: notifications.updatedAt,
  updatedAtText: sql<string>`${notifications.updatedAt}::text`,
  readAt: notifications.readAt,
};

export const GROUPED_TYPE = "content.changed";
const GROUP_LIMIT = 100;
const PREVIEW_LENGTH = 160;

function localDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function shortText(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1).trimEnd()}…` : flat;
}

export const notificationKinds = ["mentions", "watched", "requests"] as const;
export type NotificationKind = (typeof notificationKinds)[number];
export const notificationKindTypes: Record<NotificationKind, readonly string[]> = {
  mentions: ["content.mentioned"],
  watched: ["comment.created", "content.changed", "page.statusChanged", "ownership.transferred"],
  requests: ["access.requested"],
};

type ListRow = {
  id: string;
  type: string;
  organizationId: string | null;
  targetType: string;
  targetId: string | null;
  targetNumber: string | null;
  actorType: string | null;
  actorId: string | null;
  actorName: string | null;
  actorCount: number;
  params: unknown;
  count: number;
  createdAt: Date;
  updatedAt: Date;
  updatedAtText: string;
  readAt: Date | null;
};

function toItem(row: ListRow): NotificationItem {
  return {
    id: row.id,
    type: row.type,
    organizationId: row.organizationId,
    target: {
      type: row.targetType,
      id: row.targetId,
      number: row.targetNumber === null ? null : Number(row.targetNumber),
    },
    actor: row.actorType ? { type: row.actorType, id: row.actorId, name: row.actorName } : null,
    actorCount: Number(row.actorCount),
    params: row.params,
    count: row.count,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    readAt: row.readAt,
  };
}

export class NotificationService {
  readonly #database: Database;
  readonly #settings: SettingsService;
  readonly #mail: MailService;
  readonly #authorization: AuthorizationService;
  readonly #registry: NotificationRegistry;
  readonly #unsubscribe: UnsubscribeService;
  readonly #people: PeopleService;

  constructor(options: {
    database: Database;
    settings: SettingsService;
    mail: MailService;
    authorization: AuthorizationService;
    registry: NotificationRegistry;
    unsubscribe: UnsubscribeService;
  }) {
    this.#people = new PeopleService({ database: options.database, authorization: options.authorization });
    this.#database = options.database;
    this.#settings = options.settings;
    this.#mail = options.mail;
    this.#authorization = options.authorization;
    this.#registry = options.registry;
    this.#unsubscribe = options.unsubscribe;
  }

  get registry(): NotificationRegistry {
    return this.#registry;
  }

  #definition(type: string): NotificationTypeDefinition {
    const definition = this.#registry.get(type);
    if (!definition) throw new Error(`Unknown notification type ${type}`);
    return definition;
  }

  async notify(tx: Transaction, input: NotifyInput): Promise<NotifyResult> {
    const definition = this.#definition(input.type);
    const event = notificationEventOf(input.type);
    const settings = event ? notificationEventSettings.get(event.id) : undefined;
    if (!event || !settings) throw new Error(`Notification type ${input.type} belongs to no event`);
    const params = definition.params.parse(input.params);
    const combineKey = definition.combineKey?.(params) ?? null;
    const groupKey = `${input.type}:${input.targetId ?? ""}${combineKey ? `:${combineKey}` : ""}`;
    const actor = input.actor?.type === "account" ? input.actor : null;
    const actorIds = [...new Set([...(actor ? [actor.id] : []), ...(input.contributors ?? [])])];
    const ownAction = (recipientId: string) =>
      event.group === "content" && actorIds.length > 0 && actorIds.every((id) => id === recipientId);
    const candidates = [...new Set(input.recipients)].filter((id) => !ownAction(id));
    const muted = await this.#muted(tx, definition, event, input, params, candidates);
    const mailMethod = await this.#mail.configuredMethod(tx);
    const pushEnabled = await this.#settings.get(browserPushSetting, {}, { executor: tx });
    const mailIds: string[] = [];
    let reached = 0;
    for (const recipientId of candidates) {
      if (muted.has(recipientId)) continue;
      const [account] = await tx
        .select({ email: accounts.email, state: accounts.state })
        .from(accounts)
        .where(eq(accounts.id, recipientId));
      if (account?.state !== "active") continue;
      const chain = input.organizationId
        ? { organization: input.organizationId, user: recipientId }
        : { ...(await accountScopeChain(tx, recipientId)), user: recipientId };
      const inApp = await this.#settings.get(settings.inApp, chain, { executor: tx });
      const email = await this.#settings.get(settings.email, chain, { executor: tx });
      const mailable = email !== "off" && account.email !== null && mailMethod !== null;
      const direct =
        mailable &&
        email === "immediately" &&
        event.group === "administration" &&
        definition.mail !== undefined;
      const deferred = mailable && !direct ? (email === "digest" ? "digest" : "immediate") : null;
      let combined = false;
      if (inApp || deferred) {
        combined = await this.#store(tx, recipientId, groupKey, definition, input, actor, actorIds, params, {
          inApp,
          email: deferred,
        });
      }
      if (direct && !combined && account.email && definition.mail) {
        const locale = {
          language: await this.#mail.languageOf(recipientId, tx),
          timeZone: await this.#mail.timeZoneOf(recipientId, tx),
          dateFormat: await this.#mail.dateFormatOf(recipientId, tx),
        };
        const mail = definition.mail(params, locale);
        const links = await this.#unsubscribe.links(recipientId, { kind: "event", event: event.id }, tx);
        mailIds.push(
          await this.#mail.queue(tx, {
            to: account.email,
            template: mail.template,
            language: locale.language,
            params: mail.params,
            organizationId: input.organizationId,
            notification: true,
            unsubscribe: links ? { label: mailWording[locale.language].unsubscribeEvent, ...links } : null,
            security: event.security && !isOperationsEvent(event.id),
            operations: isOperationsEvent(event.id),
          }),
        );
      }
      const push = pushEnabled && (await this.#settings.get(settings.push, chain, { executor: tx }));
      if (push && !combined && (await hasPushDevice(tx, recipientId))) {
        await queuePush(tx, {
          recipientId,
          organizationId: input.organizationId,
          type: input.type,
          targetId: input.targetId,
          actorId: actor?.id ?? actorIds[0] ?? null,
          actorCount: actorIds.length,
          params,
        });
      }
      if (inApp || email !== "off" || push) reached += 1;
    }
    return { mailIds, recipients: reached };
  }

  async #subject(
    tx: Transaction,
    definition: NotificationTypeDefinition,
    input: NotifyInput,
    params: unknown,
  ): Promise<NotificationSubject | null> {
    if (definition.subject) return definition.subject({ targetId: input.targetId, params, executor: tx });
    if (definition.targetType === "item" && input.targetId) return { spaceId: null, itemId: input.targetId };
    return null;
  }

  async #muted(
    tx: Transaction,
    definition: NotificationTypeDefinition,
    event: NotificationEvent,
    input: NotifyInput,
    params: unknown,
    recipients: readonly string[],
  ): Promise<Set<string>> {
    if (recipients.length === 0) return new Set();
    const subject = await this.#subject(tx, definition, input, params);
    if (!subject) return new Set();
    const states = await effectiveWatches(tx, subject, recipients);
    const muted = new Set<string>();
    for (const [accountId, watch] of states) {
      if (watch.state === "muted" && !(event.keptWhenMuted && watch.keepActionable)) muted.add(accountId);
    }
    return muted;
  }

  async #store(
    tx: Transaction,
    recipientId: string,
    groupKey: string,
    definition: NotificationTypeDefinition,
    input: NotifyInput,
    actor: { type: "account"; id: string } | null,
    actorIds: readonly string[],
    params: unknown,
    channels: { inApp: boolean; email: "immediate" | "digest" | null },
  ): Promise<boolean> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${recipientId}:${groupKey}`}, 0))`);
    const [open] = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, recipientId),
          eq(notifications.groupKey, groupKey),
          eq(notifications.inApp, channels.inApp),
          isNull(notifications.readAt),
          sql`${notifications.updatedAt} > now() - make_interval(mins => ${COMBINE_WINDOW_MINUTES})`,
          sql`${notifications.createdAt} > now() - make_interval(hours => ${COMBINE_MAX_HOURS})`,
        ),
      )
      .orderBy(desc(notifications.updatedAt))
      .limit(1)
      .for("update");
    const latest = actor?.id ?? actorIds[0] ?? null;
    if (open) {
      await tx
        .update(notifications)
        .set({
          count: sql`${notifications.count} + 1`,
          params,
          actorType: latest ? "account" : null,
          actorId: latest,
          actorIds: sql`(select coalesce(array_agg(a.id order by a.first), '{}'::uuid[]) from (
            select id, min(position) as first
            from unnest(${notifications.actorIds} || ${sql.param([...actorIds])}::uuid[]) with ordinality as u(id, position)
            group by id order by first limit ${MAX_ACTORS}) a)`,
          updatedAt: sql`now()`,
          ...(channels.email
            ? {
                emailStatus: channels.email,
                emailPendingSince: sql`case when ${notifications.emailStatus} in ('immediate', 'digest')
                  then ${notifications.emailPendingSince} else now() end`,
              }
            : {}),
        })
        .where(eq(notifications.id, open.id));
    } else {
      await tx.insert(notifications).values({
        recipientId,
        organizationId: input.organizationId,
        type: input.type,
        targetType: definition.targetType,
        targetId: input.targetId,
        actorType: latest ? "account" : null,
        actorId: latest,
        actorIds: actorIds.slice(0, MAX_ACTORS),
        params,
        groupKey,
        inApp: channels.inApp,
        emailStatus: channels.email,
        emailPendingSince: channels.email ? sql`now()` : null,
      });
    }
    if (channels.inApp) await this.#announce(tx, recipientId);
    return open !== undefined;
  }

  async #announce(executor: Executor, recipientId: string): Promise<void> {
    await executor.execute(sql`select pg_notify(${NOTIFICATIONS_CHANNEL}, ${recipientId})`);
  }

  async dispatch(mailIds: readonly string[]): Promise<void> {
    await this.#mail.dispatch(mailIds);
  }

  visibility(recipientId: string, executor: Executor = this.#database) {
    const cache = new Map<string, Promise<boolean>>();
    const decide = this.#authorization.batch(
      accountPrincipal(recipientId),
      executor === this.#database ? {} : { executor, fresh: true },
    );
    const can = async (action: string, resource: { type: string; id?: string }): Promise<boolean> =>
      (await decide(action, resource)).allowed;
    return (row: VisibilityEntry): Promise<boolean> => {
      const key = JSON.stringify([row.type, row.organizationId, row.targetId, row.params]);
      let decision = cache.get(key);
      if (!decision) {
        const definition = this.#registry.get(row.type);
        const parsed = definition?.params.safeParse(row.params);
        decision =
          definition && parsed?.success
            ? definition.visible({
                recipientId,
                organizationId: row.organizationId,
                targetId: row.targetId,
                params: parsed.data,
                executor,
                can,
              })
            : Promise.resolve(false);
        cache.set(key, decision);
      }
      return decision;
    };
  }

  async visibleTo(recipientId: string, entry: VisibilityEntry): Promise<boolean> {
    return this.visibility(recipientId)(entry);
  }

  #select() {
    return this.#database
      .select(listColumns)
      .from(notifications)
      .leftJoin(accounts, eq(accounts.id, notifications.actorId));
  }

  async list(
    recipientId: string,
    request: {
      after?: NotificationCursor | undefined;
      limit: number;
      unreadOnly?: boolean;
      kind?: NotificationKind | undefined;
      spaceId?: string | undefined;
      grouped?: boolean | undefined;
    },
  ): Promise<NotificationPage> {
    const visible = this.visibility(recipientId);
    const items: NotificationItem[] = [];
    const previews = new Map<NotificationItem, ListRow>();
    const page = async (next: NotificationCursor | null): Promise<NotificationPage> => {
      const decide = this.#authorization.batch(accountPrincipal(recipientId), { fresh: true });
      await Promise.all(
        [...previews].map(async ([item, row]) => {
          item.preview = await this.#preview(recipientId, row, decide);
        }),
      );
      return { items, next };
    };
    const timeZone = request.grouped ? await this.#timeZone(recipientId) : null;
    const groups = new Map<string, { representative: string | null; group: NotificationGroup | null }>();
    let cursor = request.after;
    let scanned = 0;
    for (;;) {
      const rows: ListRow[] = await this.#select()
        .where(
          and(
            eq(notifications.recipientId, recipientId),
            eq(notifications.inApp, true),
            request.unreadOnly ? isNull(notifications.readAt) : undefined,
            request.kind ? inArray(notifications.type, [...notificationKindTypes[request.kind]]) : undefined,
            request.spaceId
              ? sql`((${notifications.targetType} = 'item' and exists (select 1 from tree_items t
                    where t.id = ${itemTargetId} and t.space_id = ${request.spaceId}))
                  or (${notifications.targetType} = 'accessRequest' and exists (select 1 from access_requests r
                    where r.id::text = ${notifications.targetId} and r.space_id = ${request.spaceId})))`
              : undefined,
            cursor
              ? sql`(${notifications.updatedAt}, ${notifications.id}) < (${cursor[0]}::timestamptz, ${cursor[1]}::uuid)`
              : undefined,
          ),
        )
        .orderBy(desc(notifications.updatedAt), desc(notifications.id))
        .limit(SCAN_BATCH);
      const shown = await Promise.all(rows.map(visible));
      const spaces = timeZone ? await this.#spacesOf(rows) : new Map<string, GroupSpace>();
      for (const [index, row] of rows.entries()) {
        cursor = [row.updatedAtText, row.id];
        if (!shown[index]) continue;
        if (timeZone && row.type === GROUPED_TYPE && row.targetType === "item" && row.targetId) {
          const grouping = await this.#groupOf(
            recipientId,
            row,
            spaces.get(row.targetId),
            timeZone,
            request.unreadOnly ?? false,
            visible,
            groups,
          );
          if (grouping.representative !== null && grouping.representative !== row.id) continue;
          if (grouping.group) {
            items.push({ ...toItem(row), preview: null, group: grouping.group });
            if (items.length === request.limit) return page(cursor);
            continue;
          }
        }
        const item: NotificationItem = { ...toItem(row), preview: null, group: null };
        items.push(item);
        previews.set(item, row);
        if (items.length === request.limit) return page(cursor);
      }
      scanned += rows.length;
      if (rows.length < SCAN_BATCH) return page(null);
      if (scanned >= SCAN_LIMIT) return page(cursor ?? null);
    }
  }

  async #timeZone(recipientId: string): Promise<string> {
    return this.#settings.get(timeZoneSetting, {
      ...(await accountScopeChain(this.#database, recipientId)),
      user: recipientId,
    });
  }

  async #spacesOf(rows: ListRow[]): Promise<Map<string, GroupSpace>> {
    const targets = rows.flatMap((row) =>
      row.type === GROUPED_TYPE && row.targetType === "item" && row.targetId && UUID.test(row.targetId)
        ? [row.targetId.toLowerCase()]
        : [],
    );
    if (targets.length === 0) return new Map();
    const found = await this.#database.execute<GroupSpace & { item_id: string }>(sql`
      select t.id as item_id, s.id, s.key, s.name from tree_items t join spaces s on s.id = t.space_id
      where t.id = any(${sql.param([...new Set(targets)])}::uuid[])`);
    const byItem = new Map(
      found.rows.map((row) => [row.item_id, { id: row.id, key: row.key, name: row.name }]),
    );
    const spaces = new Map<string, GroupSpace>();
    for (const row of rows) {
      const space = row.targetId ? byItem.get(row.targetId.toLowerCase()) : undefined;
      if (row.targetId && space) spaces.set(row.targetId, space);
    }
    return spaces;
  }

  async #groupOf(
    recipientId: string,
    row: ListRow,
    target: GroupSpace | undefined,
    timeZone: string,
    unreadOnly: boolean,
    visible: (row: ListRow) => Promise<boolean>,
    cache: Map<string, { representative: string | null; group: NotificationGroup | null }>,
  ): Promise<{ representative: string | null; group: NotificationGroup | null }> {
    if (!target) return { representative: null, group: null };
    const day = localDay(row.updatedAt, timeZone);
    const key = `${target.id}:${day}`;
    const known = cache.get(key);
    if (known) return known;
    const rows: ListRow[] = await this.#select()
      .where(
        and(
          eq(notifications.recipientId, recipientId),
          eq(notifications.inApp, true),
          eq(notifications.type, GROUPED_TYPE),
          eq(notifications.targetType, "item"),
          unreadOnly ? isNull(notifications.readAt) : undefined,
          sql`(${notifications.updatedAt} at time zone ${timeZone})::date = ${day}::date`,
          sql`exists (select 1 from tree_items t where t.id = ${itemTargetId}
            and t.space_id = ${target.id})`,
        ),
      )
      .orderBy(desc(notifications.updatedAt), desc(notifications.id))
      .limit(GROUP_LIMIT);
    const shown = await Promise.all(rows.map(visible));
    const members = rows.filter((_, index) => shown[index]);
    const first = members[0];
    if (!first || members.length < 2) {
      const single = { representative: null, group: null };
      cache.set(key, single);
      return single;
    }
    const actors = new Map<string, string>();
    for (const member of members) {
      if (member.actorId && member.actorName && !actors.has(member.actorId)) {
        actors.set(member.actorId, member.actorName);
      }
    }
    const result = {
      representative: first.id,
      group: {
        spaceId: target.id,
        spaceKey: target.key,
        spaceName: target.name,
        day,
        actors: [...actors].slice(0, 3).map(([id, name]) => ({ id, name })),
        actorCount: actors.size,
        members: members.map((member) => ({
          id: member.id,
          itemId: member.targetId,
          number: member.targetNumber === null ? null : Number(member.targetNumber),
          itemTitle: String((member.params as Record<string, unknown> | null)?.itemTitle ?? ""),
          actor: member.actorId || member.actorName ? { id: member.actorId, name: member.actorName } : null,
          updatedAt: member.updatedAt,
          readAt: member.readAt,
        })),
      },
    };
    cache.set(key, result);
    return result;
  }

  async #preview(
    recipientId: string,
    row: ListRow,
    decide: (action: string, resource: { type: string; id: string }) => Promise<{ allowed: boolean }>,
  ): Promise<string | null> {
    const params = (row.params ?? {}) as Record<string, unknown>;
    if (row.type === "task.assigned" && typeof params.taskText === "string")
      return shortText(params.taskText);
    if (row.type === "access.requested" && typeof params.message === "string" && params.message.trim()) {
      return shortText(params.message);
    }
    const commentId = typeof params.commentId === "string" ? params.commentId : null;
    if (!commentId || (row.type !== "comment.created" && row.type !== "content.mentioned")) return null;
    if (!(await decide("comment.view", { type: "comment", id: commentId })).allowed) return null;
    const comment = await this.#database.execute<{ body: DocumentJson | null }>(
      sql`select body from comments where id = ${commentId} and deleted_at is null`,
    );
    const body = comment.rows[0]?.body;
    if (!body) return null;
    const plain = await this.commentText(recipientId, body);
    return plain.trim() ? shortText(plain) : null;
  }

  async commentText(recipientId: string, body: DocumentJson): Promise<string> {
    const names = await this.#people.visiblePeople(accountPrincipal(recipientId), extractMentions(body));
    return commentText(body, (id) => names.get(id)?.name ?? null);
  }

  async get(recipientId: string, id: string): Promise<NotificationItem | null> {
    const [row]: ListRow[] = await this.#select().where(
      and(
        eq(notifications.id, id),
        eq(notifications.recipientId, recipientId),
        eq(notifications.inApp, true),
      ),
    );
    if (!row || !(await this.visibility(recipientId)(row))) return null;
    return toItem(row);
  }

  async unreadCount(recipientId: string, kind?: NotificationKind): Promise<UnreadCount> {
    const visible = this.visibility(recipientId);
    const groups = await this.#database
      .select({
        type: notifications.type,
        organizationId: notifications.organizationId,
        targetId: notifications.targetId,
        params: notifications.params,
        count: sql<number>`count(*)::int`,
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, recipientId),
          eq(notifications.inApp, true),
          isNull(notifications.readAt),
          kind ? inArray(notifications.type, [...notificationKindTypes[kind]]) : undefined,
        ),
      )
      .groupBy(notifications.type, notifications.organizationId, notifications.targetId, notifications.params)
      .orderBy(sql`max(${notifications.updatedAt}) desc`)
      .limit(UNREAD_LIMIT);
    let count = 0;
    for (let start = 0; start < groups.length && count <= UNREAD_COUNT_CAP; start += UNREAD_COUNT_CAP) {
      const chunk = groups.slice(start, start + UNREAD_COUNT_CAP);
      const shown = await Promise.all(chunk.map(visible));
      for (const [index, group] of chunk.entries()) if (shown[index]) count += group.count;
    }
    return { count: Math.min(count, UNREAD_COUNT_CAP), capped: count > UNREAD_COUNT_CAP };
  }

  async markRead(recipientId: string, id: string): Promise<boolean> {
    const item = await this.get(recipientId, id);
    if (!item) return false;
    if (item.readAt) return true;
    await this.#database.transaction(async (tx) => {
      const updated = await tx
        .update(notifications)
        .set({ readAt: sql`now()` })
        .where(and(eq(notifications.id, id), isNull(notifications.readAt)))
        .returning({ id: notifications.id });
      if (updated.length > 0) await this.#announce(tx, recipientId);
    });
    return true;
  }

  async markUnread(recipientId: string, id: string): Promise<boolean> {
    const item = await this.get(recipientId, id);
    if (!item) return false;
    if (!item.readAt) return true;
    await this.#database.transaction(async (tx) => {
      const updated = await tx
        .update(notifications)
        .set({ readAt: null })
        .where(and(eq(notifications.id, id), eq(notifications.recipientId, recipientId)))
        .returning({ id: notifications.id });
      if (updated.length > 0) await this.#announce(tx, recipientId);
    });
    return true;
  }

  async markAllRead(recipientId: string, before?: Date): Promise<number> {
    const visible = this.visibility(recipientId);
    let cursor: NotificationCursor | undefined;
    let marked = 0;
    for (;;) {
      const rows: ListRow[] = await this.#select()
        .where(
          and(
            eq(notifications.recipientId, recipientId),
            eq(notifications.inApp, true),
            isNull(notifications.readAt),
            before ? lte(notifications.updatedAt, before) : undefined,
            cursor
              ? sql`(${notifications.updatedAt}, ${notifications.id}) < (${cursor[0]}::timestamptz, ${cursor[1]}::uuid)`
              : undefined,
          ),
        )
        .orderBy(desc(notifications.updatedAt), desc(notifications.id))
        .limit(MARK_BATCH);
      const shown = await Promise.all(rows.map(visible));
      const ids = rows.filter((_, index) => shown[index]).map((row) => row.id);
      const last = rows.at(-1);
      if (last) cursor = [last.updatedAtText, last.id];
      if (ids.length > 0) {
        const updated = await this.#database
          .update(notifications)
          .set({ readAt: sql`now()` })
          .where(and(inArray(notifications.id, ids), isNull(notifications.readAt)))
          .returning({ id: notifications.id });
        marked += updated.length;
      }
      if (rows.length < MARK_BATCH) break;
    }
    if (marked > 0) await this.#announce(this.#database, recipientId);
    return marked;
  }

  async applyRetention(): Promise<number> {
    const organizations = await this.#database
      .selectDistinct({ id: notifications.organizationId })
      .from(notifications);
    let deleted = 0;
    for (const { id } of organizations) {
      const days = await this.#settings.get(notificationRetentionSetting, id ? { organization: id } : {});
      const removed = await this.#database
        .delete(notifications)
        .where(
          and(
            id ? eq(notifications.organizationId, id) : isNull(notifications.organizationId),
            sql`${notifications.updatedAt} < now() - make_interval(days => ${days})`,
          ),
        )
        .returning({ id: notifications.id });
      deleted += removed.length;
    }
    return deleted;
  }
}
