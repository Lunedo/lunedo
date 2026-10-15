import { type NotificationEvent, notificationEventOf } from "@pagehall/shared";
import { and, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import { accounts } from "../accounts/schema.js";
import { accountScopeChain } from "../accounts/scope.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import type { MailService } from "../mail/mail-service.js";
import { hasPushDevice, queuePush } from "../push/outbox.js";
import type { SettingsService } from "../settings/service.js";
import { mailWording } from "./mail-texts.js";
import type { NotificationRegistry, NotificationSubject, NotificationTypeDefinition } from "./registry.js";
import { notifications } from "./schema.js";
import { browserPushSetting, notificationEventSettings, notificationRetentionSetting } from "./types.js";
import type { UnsubscribeService } from "./unsubscribe.js";
import { effectiveWatches } from "./watches.js";

export const NOTIFICATIONS_CHANNEL = "pagehall_notifications";

export const COMBINE_WINDOW_MINUTES = 30;
export const COMBINE_MAX_HOURS = 24;
export const ACTIONABLE_MAIL_DELAY_MINUTES = 2;
const MAX_ACTORS = 50;

const SCAN_BATCH = 100;
const SCAN_LIMIT = 1000;
const UNREAD_LIMIT = 1000;
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

export interface NotificationItem {
  id: string;
  type: string;
  organizationId: string | null;
  target: { type: string; id: string | null };
  actor: { type: string; id: string | null; name: string | null } | null;
  actorCount: number;
  params: unknown;
  count: number;
  createdAt: Date;
  updatedAt: Date;
  readAt: Date | null;
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

const listColumns = {
  id: notifications.id,
  type: notifications.type,
  organizationId: notifications.organizationId,
  targetType: notifications.targetType,
  targetId: notifications.targetId,
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

type ListRow = {
  id: string;
  type: string;
  organizationId: string | null;
  targetType: string;
  targetId: string | null;
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
    target: { type: row.targetType, id: row.targetId },
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

  constructor(options: {
    database: Database;
    settings: SettingsService;
    mail: MailService;
    authorization: AuthorizationService;
    registry: NotificationRegistry;
    unsubscribe: UnsubscribeService;
  }) {
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
    const groupKey = `${input.type}:${input.targetId ?? ""}`;
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
            security: event.security,
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
    const principal = accountPrincipal(recipientId);
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
                can: async (action, resource) =>
                  (
                    await this.#authorization.explain(
                      principal,
                      action,
                      resource,
                      executor === this.#database ? undefined : { executor, fresh: true },
                    )
                  ).allowed,
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
    request: { after?: NotificationCursor | undefined; limit: number; unreadOnly?: boolean },
  ): Promise<NotificationPage> {
    const visible = this.visibility(recipientId);
    const items: NotificationItem[] = [];
    let cursor = request.after;
    let scanned = 0;
    for (;;) {
      const rows: ListRow[] = await this.#select()
        .where(
          and(
            eq(notifications.recipientId, recipientId),
            eq(notifications.inApp, true),
            request.unreadOnly ? isNull(notifications.readAt) : undefined,
            cursor
              ? sql`(${notifications.updatedAt}, ${notifications.id}) < (${cursor[0]}::timestamptz, ${cursor[1]}::uuid)`
              : undefined,
          ),
        )
        .orderBy(desc(notifications.updatedAt), desc(notifications.id))
        .limit(SCAN_BATCH);
      for (const row of rows) {
        cursor = [row.updatedAtText, row.id];
        if (!(await visible(row))) continue;
        items.push(toItem(row));
        if (items.length === request.limit) return { items, next: cursor };
      }
      scanned += rows.length;
      if (rows.length < SCAN_BATCH) return { items, next: null };
      if (scanned >= SCAN_LIMIT) return { items, next: cursor ?? null };
    }
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

  async unreadCount(recipientId: string): Promise<number> {
    const visible = this.visibility(recipientId);
    const rows: ListRow[] = await this.#select()
      .where(
        and(
          eq(notifications.recipientId, recipientId),
          eq(notifications.inApp, true),
          isNull(notifications.readAt),
        ),
      )
      .orderBy(desc(notifications.updatedAt))
      .limit(UNREAD_LIMIT);
    let count = 0;
    for (const row of rows) if (await visible(row)) count += 1;
    return count;
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
      const ids: string[] = [];
      for (const row of rows) {
        cursor = [row.updatedAtText, row.id];
        if (await visible(row)) ids.push(row.id);
      }
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
