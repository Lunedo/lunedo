import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { accountPrincipal, type Principal } from "../accounts/principal.js";
import { accounts } from "../accounts/schema.js";
import { accountScopeChain } from "../accounts/scope.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import type { MailService } from "../mail/mail-service.js";
import type { SettingsService } from "../settings/service.js";
import type { NotificationRegistry, NotificationTypeDefinition } from "./registry.js";
import { notifications } from "./schema.js";
import { notificationRetentionSetting } from "./types.js";

export const NOTIFICATIONS_CHANNEL = "pagehall_notifications";

export const COMBINE_WINDOW_MINUTES = 15;

const SCAN_BATCH = 100;
const SCAN_LIMIT = 1000;
const UNREAD_LIMIT = 1000;

export interface NotifyInput {
  type: string;
  recipients: readonly string[];
  organizationId: string | null;
  targetId: string | null;
  actor?: Principal | null;
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
  params: unknown;
  count: number;
  createdAt: Date;
  updatedAt: Date;
  readAt: Date | null;
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

  constructor(options: {
    database: Database;
    settings: SettingsService;
    mail: MailService;
    authorization: AuthorizationService;
    registry: NotificationRegistry;
  }) {
    this.#database = options.database;
    this.#settings = options.settings;
    this.#mail = options.mail;
    this.#authorization = options.authorization;
    this.#registry = options.registry;
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
    const params = definition.params.parse(input.params);
    const groupKey = `${input.type}:${input.targetId ?? ""}`;
    const actor = input.actor?.type === "account" ? input.actor : null;
    const smtp = await this.#mail.smtpConfiguration(tx);
    const mailIds: string[] = [];
    let reached = 0;
    for (const recipientId of new Set(input.recipients)) {
      const [account] = await tx
        .select({ email: accounts.email, state: accounts.state })
        .from(accounts)
        .where(eq(accounts.id, recipientId));
      if (account?.state !== "active") continue;
      const chain = input.organizationId
        ? { organization: input.organizationId, user: recipientId }
        : { ...(await accountScopeChain(tx, recipientId)), user: recipientId };
      const preference = definition.setting
        ? await this.#settings.get(definition.setting, chain, { executor: tx })
        : { inApp: true, email: false };
      let combined = false;
      if (preference.inApp) {
        combined = await this.#store(tx, recipientId, groupKey, definition, input, actor, params);
      }
      if (preference.email && !combined && account.email && smtp && definition.mail) {
        const locale = {
          language: await this.#mail.languageOf(recipientId, tx),
          timeZone: await this.#mail.timeZoneOf(recipientId, tx),
          dateFormat: await this.#mail.dateFormatOf(recipientId, tx),
        };
        const mail = definition.mail(params, locale);
        mailIds.push(
          await this.#mail.queue(tx, {
            to: account.email,
            template: mail.template,
            language: locale.language,
            params: mail.params,
            organizationId: input.organizationId,
            notification: true,
          }),
        );
      }
      if (preference.inApp || preference.email) reached += 1;
    }
    return { mailIds, recipients: reached };
  }

  async #store(
    tx: Transaction,
    recipientId: string,
    groupKey: string,
    definition: NotificationTypeDefinition,
    input: NotifyInput,
    actor: { type: "account"; id: string } | null,
    params: unknown,
  ): Promise<boolean> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${recipientId}:${groupKey}`}, 0))`);
    const [open] = await tx
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, recipientId),
          eq(notifications.groupKey, groupKey),
          isNull(notifications.readAt),
          sql`${notifications.updatedAt} > now() - make_interval(mins => ${COMBINE_WINDOW_MINUTES})`,
        ),
      )
      .orderBy(desc(notifications.updatedAt))
      .limit(1)
      .for("update");
    if (open) {
      await tx
        .update(notifications)
        .set({
          count: sql`${notifications.count} + 1`,
          params,
          actorType: actor?.type ?? null,
          actorId: actor?.id ?? null,
          updatedAt: sql`now()`,
        })
        .where(eq(notifications.id, open.id));
    } else {
      await tx.insert(notifications).values({
        recipientId,
        organizationId: input.organizationId,
        type: input.type,
        targetType: definition.targetType,
        targetId: input.targetId,
        actorType: actor?.type ?? null,
        actorId: actor?.id ?? null,
        params,
        groupKey,
      });
    }
    await this.#announce(tx, recipientId);
    return open !== undefined;
  }

  async #announce(executor: Executor, recipientId: string): Promise<void> {
    await executor.execute(sql`select pg_notify(${NOTIFICATIONS_CHANNEL}, ${recipientId})`);
  }

  async dispatch(mailIds: readonly string[]): Promise<void> {
    await this.#mail.dispatch(mailIds);
  }

  #visibility(recipientId: string) {
    const cache = new Map<string, Promise<boolean>>();
    const principal = accountPrincipal(recipientId);
    return (row: ListRow): Promise<boolean> => {
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
                executor: this.#database,
                can: async (action, resource) =>
                  (await this.#authorization.explain(principal, action, resource)).allowed,
              })
            : Promise.resolve(false);
        cache.set(key, decision);
      }
      return decision;
    };
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
    const visible = this.#visibility(recipientId);
    const items: NotificationItem[] = [];
    let cursor = request.after;
    let scanned = 0;
    for (;;) {
      const rows: ListRow[] = await this.#select()
        .where(
          and(
            eq(notifications.recipientId, recipientId),
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

  async unreadCount(recipientId: string): Promise<number> {
    const visible = this.#visibility(recipientId);
    const rows: ListRow[] = await this.#select()
      .where(and(eq(notifications.recipientId, recipientId), isNull(notifications.readAt)))
      .orderBy(desc(notifications.updatedAt))
      .limit(UNREAD_LIMIT);
    let count = 0;
    for (const row of rows) if (await visible(row)) count += 1;
    return count;
  }

  async markRead(recipientId: string, id: string): Promise<boolean> {
    return this.#database.transaction(async (tx) => {
      const [row] = await tx
        .select({ readAt: notifications.readAt })
        .from(notifications)
        .where(and(eq(notifications.id, id), eq(notifications.recipientId, recipientId)));
      if (!row) return false;
      if (row.readAt) return true;
      await tx
        .update(notifications)
        .set({ readAt: sql`now()` })
        .where(and(eq(notifications.id, id), isNull(notifications.readAt)));
      await this.#announce(tx, recipientId);
      return true;
    });
  }

  async markAllRead(recipientId: string, before?: Date): Promise<number> {
    return this.#database.transaction(async (tx) => {
      const updated = await tx
        .update(notifications)
        .set({ readAt: sql`now()` })
        .where(
          and(
            eq(notifications.recipientId, recipientId),
            isNull(notifications.readAt),
            before ? lte(notifications.updatedAt, before) : undefined,
          ),
        )
        .returning({ id: notifications.id });
      if (updated.length > 0) await this.#announce(tx, recipientId);
      return updated.length;
    });
  }

  async applyRetention(): Promise<number> {
    const days = await this.#settings.get(notificationRetentionSetting, {});
    const deleted = await this.#database
      .delete(notifications)
      .where(sql`${notifications.updatedAt} < now() - make_interval(days => ${days})`)
      .returning({ id: notifications.id });
    return deleted.length;
  }
}
