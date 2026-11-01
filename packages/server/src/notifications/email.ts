import type { DocumentJson } from "@lunedo/editor-schema";
import { type DateFormat, formatDate, notificationEventOf, notificationEvents } from "@lunedo/shared";
import { sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { instanceNameSetting, instanceUrlSetting } from "../accounts/instance-settings.js";
import { accountPrincipal } from "../accounts/principal.js";
import { accountScopeChain } from "../accounts/scope.js";
import type { AuthorizationService } from "../authorization/service.js";
import type { Database, Transaction } from "../database/database.js";
import { defineJob } from "../jobs/job-queue.js";
import type { MailService } from "../mail/mail-service.js";
import {
  type Content,
  type Language,
  type MailEntry,
  type MailSection,
  renderContent,
  templateSubject,
  unsubscribeHeaders,
} from "../mail/templates.js";
import type { MailMessage } from "../mail/transport.js";
import { timeZoneSetting } from "../settings/builtin.js";
import type { ScopeChain, SettingsService } from "../settings/service.js";
import { spaceDisplayName } from "../spaces/display-name.js";
import { contentLine, excerptOf, type LineContext, mailWording } from "./mail-texts.js";
import type { NotificationRegistry, NotificationSubject } from "./registry.js";
import {
  ACTIONABLE_MAIL_DELAY_MINUTES,
  COMBINE_MAX_HOURS,
  COMBINE_WINDOW_MINUTES,
  type NotificationService,
} from "./service.js";
import { digestEnabledSetting, digestTimeSetting, notificationEventSettings } from "./types.js";
import {
  isOperationsEvent,
  isSecurityEvent,
  type UnsubscribeScope,
  type UnsubscribeService,
} from "./unsubscribe.js";

export const notificationEmailJob = defineJob({
  name: "notifications.send-emails",
  duringMaintenance: "run",
  payload: z.object({}),
  retryLimit: 1,
  expireInSeconds: 10 * 60,
});

export const NOTIFICATION_EMAIL_SCHEDULE = "* * * * *";

const BATCH = 50;
const ACTIONABLE_TYPES = notificationEvents.flatMap((event) => (event.keptWhenMuted ? [...event.types] : []));
const DIGEST_LIMIT = 200;
const EXCERPT_LENGTH = 200;
const SUBJECT_LENGTH = 150;

interface PendingRow extends Record<string, unknown> {
  id: string;
  recipient_id: string;
  organization_id: string | null;
  type: string;
  target_type: string;
  target_id: string | null;
  actor_name: string | null;
  actor_count: number;
  actor_id: string | null;
  params: unknown;
  count: number;
  read_at: Date | string | null;
  updated_at: Date | string;
}

interface Recipient {
  id: string;
  email: string;
  chain: ScopeChain;
  language: Language;
  timeZone: string;
  dateFormat: DateFormat;
}

interface Prepared {
  row: PendingRow;
  entry: MailEntry;
  subject: NotificationSubject | null;
  updatedAt: number;
}

type Outcome =
  | { kind: "entry"; prepared: Prepared }
  | { kind: "skip" }
  | { kind: "move"; to: "immediate" | "digest" };

function pendingSelect(where: ReturnType<typeof sql>) {
  return sql`
    select n.id, n.recipient_id, n.organization_id, n.type, n.target_type, n.target_id, n.actor_id,
      a.name as actor_name, cardinality(n.actor_ids) as actor_count, n.params, n.count, n.read_at, n.updated_at
    from notifications n left join accounts a on a.id = n.actor_id
    where ${where}`;
}

export function latestDigestAt(now: Date, time: string, timeZone: string): Date {
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  const zoned = Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(timeZone);
  const at = (date: Temporal.PlainDate) =>
    date.toZonedDateTime({ timeZone, plainTime: new Temporal.PlainTime(hour, minute) }).epochMilliseconds;
  const today = at(zoned.toPlainDate());
  return new Date(today <= now.getTime() ? today : at(zoned.toPlainDate().subtract({ days: 1 })));
}

function dateTimeOf(instant: string, recipient: Recipient): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return instant;
  const time = new Intl.DateTimeFormat(recipient.language, {
    timeZone: recipient.timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${formatDate(date, recipient.dateFormat, recipient.timeZone, recipient.language)} ${time}`;
}

export class NotificationMailer {
  readonly #database: Database;
  readonly #settings: SettingsService;
  readonly #mail: MailService;
  readonly #notifications: NotificationService;
  readonly #registry: NotificationRegistry;
  readonly #authorization: AuthorizationService;
  readonly #unsubscribe: UnsubscribeService;
  readonly #clock: () => Date;

  constructor(options: {
    database: Database;
    settings: SettingsService;
    mail: MailService;
    notifications: NotificationService;
    authorization: AuthorizationService;
    unsubscribe: UnsubscribeService;
    clock?: () => Date;
  }) {
    this.#database = options.database;
    this.#settings = options.settings;
    this.#mail = options.mail;
    this.#notifications = options.notifications;
    this.#registry = options.notifications.registry;
    this.#authorization = options.authorization;
    this.#unsubscribe = options.unsubscribe;
    this.#clock = options.clock ?? (() => new Date());
  }

  async sendDue(now = this.#clock()): Promise<{ immediate: number; digests: number }> {
    let immediate = 0;
    for (;;) {
      const batch = await this.#immediateBatch(now);
      immediate += batch.mailIds.length;
      await this.#mail.dispatch(batch.mailIds);
      if (batch.rows < BATCH) break;
    }
    let digests = 0;
    const candidates = await this.#database.execute<{ recipient_id: string; since: Date | string }>(sql`
      select recipient_id, min(email_pending_since) as since from notifications
      where email_status = 'digest' group by recipient_id order by recipient_id`);
    for (const candidate of candidates.rows) {
      const mailId = await this.#digest(candidate.recipient_id, new Date(candidate.since), now);
      if (!mailId) continue;
      await this.#mail.dispatch([mailId]);
      digests += 1;
    }
    return { immediate, digests };
  }

  async #immediateBatch(now: Date): Promise<{ rows: number; mailIds: string[] }> {
    return this.#database.transaction(async (tx) => {
      const settled = sql`n.email_status = 'immediate'
        and ((n.type = any(${sql.param(ACTIONABLE_TYPES)}::text[])
            and n.email_pending_since <= ${now.toISOString()}::timestamptz - make_interval(mins => ${ACTIONABLE_MAIL_DELAY_MINUTES}))
          or n.updated_at <= ${now.toISOString()}::timestamptz - make_interval(mins => ${COMBINE_WINDOW_MINUTES})
          or n.created_at <= ${now.toISOString()}::timestamptz - make_interval(hours => ${COMBINE_MAX_HOURS}))`;
      const rows = await tx.execute<PendingRow>(
        sql`${pendingSelect(settled)} order by n.email_pending_since, n.id limit ${BATCH} for update of n skip locked`,
      );
      const mailIds: string[] = [];
      const recipients = new Map<string, Promise<Recipient | null>>();
      for (const row of rows.rows) {
        let recipient = recipients.get(row.recipient_id);
        if (!recipient) {
          recipient = this.#recipient(tx, row.recipient_id);
          recipients.set(row.recipient_id, recipient);
        }
        const outcome = await this.#prepare(tx, row, await recipient, "immediate");
        if (outcome.kind !== "entry") {
          await this.#mark(tx, [row.id], outcome.kind === "skip" ? "skipped" : outcome.to);
          continue;
        }
        const resolved = await recipient;
        if (!resolved) continue;
        mailIds.push(await this.#queueSingle(tx, resolved, outcome.prepared));
        await this.#mark(tx, [row.id], "sent");
      }
      return { rows: rows.rows.length, mailIds };
    });
  }

  async #digest(recipientId: string, since: Date, now: Date): Promise<string | null> {
    const chain = { ...(await accountScopeChain(this.#database, recipientId)), user: recipientId };
    const time = await this.#settings.get(digestTimeSetting, chain);
    const timeZone = await this.#settings.get(timeZoneSetting, chain);
    const due = latestDigestAt(now, time, timeZone);
    if (since >= due) return null;
    return this.#database.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`notification-digest:${recipientId}`}, 0))`,
      );
      const rows = await tx.execute<PendingRow>(
        sql`${pendingSelect(sql`n.recipient_id = ${recipientId} and n.email_status = 'digest'
          and n.email_pending_since < ${due.toISOString()}::timestamptz`)}
          order by n.updated_at desc, n.id desc limit ${DIGEST_LIMIT} for update of n`,
      );
      if (rows.rows.length === 0) return null;
      const recipient = await this.#recipient(tx, recipientId);
      const enabled = await this.#settings.get(digestEnabledSetting, chain, { executor: tx });
      const prepared: Prepared[] = [];
      const skipped: string[] = [];
      const moved: string[] = [];
      for (const row of rows.rows) {
        const outcome = enabled
          ? await this.#prepare(tx, row, recipient, "digest")
          : { kind: "skip" as const };
        if (outcome.kind === "entry") prepared.push(outcome.prepared);
        else if (outcome.kind === "move") moved.push(row.id);
        else skipped.push(row.id);
      }
      await this.#mark(tx, skipped, "skipped");
      await this.#mark(tx, moved, "immediate");
      if (prepared.length === 0 || !recipient) return null;
      const mailId = await this.#queueDigest(tx, recipient, prepared);
      await this.#mark(
        tx,
        prepared.map((entry) => entry.row.id),
        "sent",
      );
      return mailId;
    });
  }

  async #mark(tx: Transaction, ids: readonly string[], status: "sent" | "skipped" | "digest" | "immediate") {
    if (ids.length === 0) return;
    await tx.execute(sql`
      update notifications set email_status = ${status}::notification_email_status,
        email_pending_since = case when ${status}::text in ('digest', 'immediate') then email_pending_since end
      where id = any(${sql.param([...ids])}::uuid[])`);
  }

  async #recipient(tx: Transaction, accountId: string): Promise<Recipient | null> {
    const account = await tx.execute<{ email: string | null; state: string }>(
      sql`select email, state from accounts where id = ${accountId}`,
    );
    const row = account.rows[0];
    if (!row?.email || row.state !== "active") return null;
    if (!(await this.#mail.configuredMethod(tx))) return null;
    return {
      id: accountId,
      email: row.email,
      chain: { ...(await accountScopeChain(tx, accountId)), user: accountId },
      language: await this.#mail.languageOf(accountId, tx),
      timeZone: await this.#mail.timeZoneOf(accountId, tx),
      dateFormat: await this.#mail.dateFormatOf(accountId, tx),
    };
  }

  async #prepare(
    tx: Transaction,
    row: PendingRow,
    recipient: Recipient | null,
    mode: "immediate" | "digest",
  ): Promise<Outcome> {
    if (!recipient || row.read_at !== null) return { kind: "skip" };
    const event = notificationEventOf(row.type);
    const settings = event ? notificationEventSettings.get(event.id) : undefined;
    const definition = this.#registry.get(row.type);
    if (!event || !settings || !definition) return { kind: "skip" };
    if (row.organization_id) {
      const member = await tx.execute(sql`
        select 1 from memberships where organization_id = ${row.organization_id} and account_id = ${recipient.id}
          and (expires_at is null or expires_at > now())`);
      if (member.rows.length === 0) return { kind: "skip" };
    }
    const chain = row.organization_id
      ? { organization: row.organization_id, user: recipient.id }
      : recipient.chain;
    const preference = await this.#settings.get(settings.email, chain, { executor: tx });
    if (preference === "off") return { kind: "skip" };
    if (mode === "immediate" && preference === "digest") return { kind: "move", to: "digest" };
    if (mode === "digest" && preference === "immediately") return { kind: "move", to: "immediate" };
    const visible = this.#notifications.visibility(recipient.id, tx);
    const target = {
      type: row.type,
      organizationId: row.organization_id,
      targetId: row.target_id,
      params: row.params,
    };
    if (!(await visible(target))) return { kind: "skip" };
    const parsed = definition.params.safeParse(row.params);
    if (!parsed.success) return { kind: "skip" };
    const subject = definition.subject
      ? await definition.subject({ targetId: row.target_id, params: parsed.data, executor: tx })
      : definition.targetType === "item" && row.target_id
        ? { spaceId: null, itemId: row.target_id }
        : null;
    const params = { ...(parsed.data as Record<string, unknown>) };
    if (definition.targetType === "item" && row.target_id) {
      const title = await tx.execute<{ title: string }>(
        sql`select title from tree_items where id = ${row.target_id}`,
      );
      if (title.rows[0]) params.itemTitle = title.rows[0].title;
    }
    const instanceName = await this.#settings.get(instanceNameSetting, {}, { executor: tx });
    const text = this.#line(row, params, recipient, parsed.data, instanceName);
    if (!text) return { kind: "skip" };
    const url = await this.#settings.get(instanceUrlSetting, {}, { executor: tx });
    const count = Number(row.count);
    return {
      kind: "entry",
      prepared: {
        row,
        subject,
        updatedAt: new Date(row.updated_at).getTime(),
        entry: {
          text,
          excerpt: await this.#excerpt(tx, row, params, recipient),
          meta: count > 1 ? mailWording[recipient.language].changes(count) : null,
          url: url ? `${url}/notifications/${row.id}` : null,
        },
      },
    };
  }

  #line(
    row: PendingRow,
    params: Record<string, unknown>,
    recipient: Recipient,
    parsed: unknown,
    instanceName: string,
  ): string | null {
    const context: LineContext = {
      actor: row.actor_name,
      actorCount: Number(row.actor_count),
      count: Number(row.count),
      own: params.ownerId === recipient.id,
      date: (instant) =>
        formatDate(new Date(instant), recipient.dateFormat, recipient.timeZone, recipient.language),
      dateTime: (instant) => dateTimeOf(instant, recipient),
    };
    const content = contentLine(recipient.language, row.type, params, context);
    if (content) return content;
    const definition = this.#registry.get(row.type);
    if (!definition?.mail) return null;
    const mail = definition.mail(parsed, recipient);
    return templateSubject(mail.template, recipient.language, { ...mail.params, instanceName } as never);
  }

  async #excerpt(
    tx: Transaction,
    row: PendingRow,
    params: Record<string, unknown>,
    recipient: Recipient,
  ): Promise<string | null> {
    if (row.type === "task.assigned" && typeof params.taskText === "string") {
      return excerptOf(params.taskText, EXCERPT_LENGTH);
    }
    if (row.type === "access.requested" && typeof params.message === "string" && params.message.trim()) {
      return excerptOf(params.message, EXCERPT_LENGTH);
    }
    const commentId = typeof params.commentId === "string" ? params.commentId : null;
    if (!commentId || (row.type !== "comment.created" && row.type !== "content.mentioned")) return null;
    const allowed = await this.#authorization.explain(
      accountPrincipal(recipient.id),
      "comment.view",
      { type: "comment", id: commentId },
      { executor: tx, fresh: true },
    );
    if (!allowed.allowed) return null;
    const comment = await tx.execute<{ body: DocumentJson | null }>(
      sql`select body from comments where id = ${commentId} and deleted_at is null`,
    );
    const body = comment.rows[0]?.body;
    if (!body) return null;
    const plain = await this.#notifications.commentText(recipient.id, body);
    return plain.trim() ? excerptOf(plain, EXCERPT_LENGTH) : null;
  }

  async #render(
    tx: Transaction,
    recipient: Recipient,
    content: Content,
    organizationId: string | null,
    scope: UnsubscribeScope,
  ): Promise<MailMessage> {
    const wording = mailWording[recipient.language];
    const links = await this.#unsubscribe.links(recipient.id, scope, tx);
    const branding = await this.#mail.branding(tx, { organizationId, notification: true });
    const instanceName = await this.#settings.get(instanceNameSetting, {}, { executor: tx });
    const message = renderContent(recipient.language, content, instanceName, recipient.email, {
      ...branding,
      unsubscribe: links
        ? {
            label: scope.kind === "digest" ? wording.unsubscribeDigest : wording.unsubscribeEvent,
            url: links.page,
          }
        : null,
      security: scope.kind === "event" && isSecurityEvent(scope.event) && !isOperationsEvent(scope.event),
      operations: scope.kind === "event" && isOperationsEvent(scope.event),
    });
    return links ? { ...message, headers: unsubscribeHeaders(links.oneClick) } : message;
  }

  async #queueSingle(tx: Transaction, recipient: Recipient, prepared: Prepared): Promise<string> {
    const wording = mailWording[recipient.language];
    const event = notificationEventOf(prepared.row.type);
    const { entry } = prepared;
    const content: Content = {
      subject: excerptOf(entry.text, SUBJECT_LENGTH),
      paragraphs: [
        entry.text,
        ...(entry.excerpt ? [entry.excerpt] : []),
        ...(entry.meta ? [entry.meta] : []),
      ],
      ...(entry.url ? { action: { label: wording.open, url: entry.url } } : {}),
    };
    const message = await this.#render(tx, recipient, content, prepared.row.organization_id, {
      kind: "event",
      event: event?.id ?? "",
    });
    return this.#mail.queueMessage(tx, "notification", message);
  }

  async #queueDigest(tx: Transaction, recipient: Recipient, prepared: Prepared[]): Promise<string> {
    const wording = mailWording[recipient.language];
    const itemIds = [
      ...new Set(prepared.flatMap((entry) => (entry.subject?.itemId ? [entry.subject.itemId] : []))),
    ];
    const items = await tx.execute<{ id: string; space_id: string }>(
      sql`select id, space_id from tree_items where id = any(${sql.param(itemIds)}::uuid[])`,
    );
    const spaceOfItem = new Map(items.rows.map((row) => [row.id, row.space_id]));
    const spaceOf = (entry: Prepared) =>
      (entry.subject?.itemId ? spaceOfItem.get(entry.subject.itemId) : undefined) ??
      entry.subject?.spaceId ??
      null;
    const spaceIds = [...new Set(prepared.flatMap((entry) => spaceOf(entry) ?? []))];
    const spaces = await tx.execute<{ id: string; name: string }>(
      sql`select s.id, ${spaceDisplayName(sql`s`)} as name from spaces s where s.id = any(${sql.param(spaceIds)}::uuid[])`,
    );
    const spaceNames = new Map(spaces.rows.map((row) => [row.id, row.name]));
    const newestOfItem = new Map<string, number>();
    for (const entry of prepared) {
      const key = entry.subject?.itemId ?? entry.row.id;
      newestOfItem.set(key, Math.max(newestOfItem.get(key) ?? 0, entry.updatedAt));
    }
    const groups = new Map<string, { heading: string; newest: number; entries: Prepared[] }>();
    for (const entry of prepared) {
      const spaceId = spaceOf(entry);
      const key = spaceId ?? "";
      const group = groups.get(key) ?? {
        heading: (spaceId ? spaceNames.get(spaceId) : undefined) ?? wording.otherSection,
        newest: 0,
        entries: [],
      };
      group.newest = Math.max(group.newest, entry.updatedAt);
      group.entries.push(entry);
      groups.set(key, group);
    }
    const itemKey = (entry: Prepared) => entry.subject?.itemId ?? entry.row.id;
    const sections: MailSection[] = [...groups.entries()]
      .sort(([keyA, a], [keyB, b]) => (keyA === "" ? 1 : keyB === "" ? -1 : b.newest - a.newest))
      .map(([, group]) => ({
        heading: group.heading,
        entries: group.entries
          .sort(
            (a, b) =>
              (newestOfItem.get(itemKey(b)) ?? 0) - (newestOfItem.get(itemKey(a)) ?? 0) ||
              itemKey(a).localeCompare(itemKey(b)) ||
              b.updatedAt - a.updatedAt,
          )
          .map((entry) => entry.entry),
      }));
    const instanceName = await this.#settings.get(instanceNameSetting, {}, { executor: tx });
    const content: Content = {
      subject: wording.digestSubject(instanceName, prepared.length),
      paragraphs: [wording.digestIntro(prepared.length)],
      sections,
    };
    const message = await this.#render(tx, recipient, content, null, { kind: "digest" });
    return this.#mail.queueMessage(tx, "notificationDigest", message);
  }
}
