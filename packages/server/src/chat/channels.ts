import { randomBytes } from "node:crypto";
import { slugify } from "@pagehall/editor-schema";
import {
  type ChatChannelKind,
  type ChatChannelState,
  type ChatEvent,
  type ChatFailureReason,
  organizationChatEvents,
  type SpaceChatEvent,
  spaceChatEvents,
  uuidv7,
} from "@pagehall/shared";
import { and, eq, isNull, sql } from "drizzle-orm";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { Encryption } from "../crypto/envelope.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import type { Logger } from "../logging/logger.js";
import type { NotificationService } from "../notifications/service.js";
import {
  checkAddress,
  OutboundError,
  type OutboundPolicy,
  parseOutboundUrl,
  sendOutbound,
} from "../outbound/guarded-request.js";
import { languageSetting } from "../settings/builtin.js";
import type { SettingsService } from "../settings/service.js";
import { actorIdOf } from "../spaces/common.js";
import {
  type ChatFailure,
  type ChatMessage,
  type ChatTarget,
  chatRequest,
  classifyError,
  classifyResponse,
  type MatrixTarget,
  matrixInputSchema,
  parseRoomAddress,
  roomDirectoryRequest,
  targetSchemaOf,
} from "./formats.js";
import { chatChannels, chatDeliveries } from "./schema.js";
import { chatTexts } from "./texts.js";

export const CHAT_DELIVERIES_CHANNEL = "pagehall_chat_deliveries";
export const PAGE_CHANGES_COMBINE_MINUTES = 60;
export const DECISION_SETTLE_MINUTES = 5;
const MAX_CHANNELS = 20;
const DELIVERY_RETENTION_DAYS = 14;
const DECISION_TEXT_LIMIT = 1000;
const ANNOUNCEMENT_PREVIEW_LIMIT = 300;
const MAX_ACTORS = 20;

export type ChatScope = { kind: "space"; spaceId: string } | { kind: "organization"; organizationId: string };

export interface ChatChannelInput {
  kind: ChatChannelKind;
  name: string;
  events: readonly string[];
  target: unknown;
}

export interface ChatChannelChange {
  name?: string | undefined;
  events?: readonly string[] | undefined;
  target?: unknown;
  newSecret?: boolean | undefined;
}

export interface ChatChannel {
  id: string;
  kind: ChatChannelKind;
  name: string;
  events: string[];
  state: ChatChannelState;
  failure: { reason: ChatFailureReason; status: number | null; code: string | null; at: Date } | null;
  lastAttemptAt: Date | null;
  lastDeliveredAt: Date | null;
  createdAt: Date;
}

export interface ChatChannelSaved {
  channel: ChatChannel;
  signingSecret: string | null;
}

export type ChatTestResult =
  | { delivered: true }
  | { delivered: false; failure: Omit<ChatFailure, "permanent"> };

export type ChatChannelErrorCode =
  | "channelNotFound"
  | "invalidChannel"
  | "invalidAddress"
  | "blockedAddress"
  | "insecureAddress"
  | "confidentialSpace"
  | "tooManyChannels";

export type ChatAddressField = "target.url" | "target.homeserver" | "target.roomId" | "target.accessToken";

export type ChatAddressProblem =
  | "notUrl"
  | "unresolvable"
  | "roomAddress"
  | "roomNotFound"
  | "unauthorized"
  | "unreachable";

export class ChatChannelError extends Error {
  override name = "ChatChannelError";
  readonly code: ChatChannelErrorCode;
  readonly field: ChatAddressField | null;
  readonly problem: ChatAddressProblem | null;

  constructor(
    code: ChatChannelErrorCode,
    message: string,
    at: { field: ChatAddressField; problem?: ChatAddressProblem } | null = null,
  ) {
    super(message);
    this.code = code;
    this.field = at?.field ?? null;
    this.problem = at?.problem ?? null;
  }
}

export interface ChatRecipients {
  space(executor: Executor, spaceId: string): Promise<string[]>;
  organization(executor: Executor, organizationId: string): Promise<string[]>;
}

type ChannelRow = {
  id: string;
  organization_id: string;
  space_id: string | null;
  kind: ChatChannelKind;
  name: string;
  events: string[];
  target: Buffer;
  signing_secret: Buffer | null;
  state: ChatChannelState;
  failure_reason: ChatFailureReason | null;
  failure_status: number | null;
  failure_code: string | null;
  failed_at: Date | string | null;
  last_attempt_at: Date | string | null;
  last_delivered_at: Date | string | null;
  created_at: Date | string;
};

function date(value: Date | string | null): Date | null {
  return value === null ? null : new Date(value);
}

function toChannel(row: ChannelRow): ChatChannel {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    events: row.events,
    state: row.state,
    failure:
      row.state === "failing" && row.failure_reason
        ? {
            reason: row.failure_reason,
            status: row.failure_status,
            code: row.failure_code,
            at: date(row.failed_at) ?? new Date(row.created_at),
          }
        : null,
    lastAttemptAt: date(row.last_attempt_at),
    lastDeliveredAt: date(row.last_delivered_at),
    createdAt: new Date(row.created_at),
  };
}

function targetContext(id: string): string {
  return `chat_channels.target:${id}`;
}

function secretContext(id: string): string {
  return `chat_channels.signing_secret:${id}`;
}

function clip(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

export function shareableItemCondition(item: ReturnType<typeof sql>, space: ReturnType<typeof sql>) {
  return sql`${item}.reader_visible and ${item}.trash_entry_id is null and ${item}.archived_root_id is null
    and ${space}.deleted_at is null and ${space}.archived_at is null and not ${space}.quarantined
    and not ${space}.confidential and ${space}.personal_of is null
    and not exists (select 1 from page_restrictions r
      where r.kind = 'view' and (r.item_id = ${item}.id or r.item_id = any(${item}.path)))`;
}

type ShareableItem = {
  id: string;
  title: string;
  kind: string;
  space_id: string;
  space_key: string;
  space_name: string;
  organization_id: string;
};

export class ChatChannelService {
  readonly #database: Database;
  readonly #encryption: Encryption;
  readonly #settings: SettingsService;
  readonly #notifications: NotificationService;
  readonly #audit: AuditLog;
  readonly #recipients: ChatRecipients;
  readonly #policy: OutboundPolicy;
  readonly #logger: Logger;
  readonly #clock: () => Date;

  constructor(options: {
    database: Database;
    encryption: Encryption;
    settings: SettingsService;
    notifications: NotificationService;
    audit: AuditLog;
    recipients: ChatRecipients;
    policy: OutboundPolicy;
    logger: Logger;
    clock?: () => Date;
  }) {
    this.#database = options.database;
    this.#encryption = options.encryption;
    this.#settings = options.settings;
    this.#notifications = options.notifications;
    this.#audit = options.audit;
    this.#recipients = options.recipients;
    this.#policy = options.policy;
    this.#logger = options.logger;
    this.#clock = options.clock ?? (() => new Date());
  }

  async #scopeOf(
    executor: Executor,
    scope: ChatScope,
  ): Promise<{ organizationId: string; spaceId: string | null; confidential: boolean }> {
    if (scope.kind === "organization") {
      return { organizationId: scope.organizationId, spaceId: null, confidential: false };
    }
    const result = await executor.execute<{ organization_id: string | null; confidential: boolean }>(sql`
      select organization_id, confidential or personal_of is not null as confidential
      from spaces where id = ${scope.spaceId}`);
    const row = result.rows[0];
    if (!row?.organization_id)
      throw new ChatChannelError("channelNotFound", "The space has no chat channels");
    return { organizationId: row.organization_id, spaceId: scope.spaceId, confidential: row.confidential };
  }

  #scopeCondition(scope: ChatScope) {
    return scope.kind === "space"
      ? sql`c.space_id = ${scope.spaceId}`
      : sql`c.organization_id = ${scope.organizationId} and c.space_id is null`;
  }

  #events(scope: ChatScope, events: readonly string[]): string[] {
    const allowed: readonly string[] = scope.kind === "space" ? spaceChatEvents : organizationChatEvents;
    const unique = [...new Set(events)];
    if (unique.length === 0 || unique.some((event) => !allowed.includes(event))) {
      throw new ChatChannelError("invalidChannel", "Choose at least one of the offered events");
    }
    return allowed.filter((event) => unique.includes(event));
  }

  #name(name: string): string {
    const cleaned = name.trim().replace(/\s+/g, " ");
    if (cleaned.length < 1 || cleaned.length > 80) {
      throw new ChatChannelError("invalidChannel", "The name needs 1 to 80 characters");
    }
    return cleaned;
  }

  async #target(kind: ChatChannelKind, value: unknown): Promise<ChatTarget> {
    const parsed = (kind === "matrix" ? matrixInputSchema : targetSchemaOf(kind)).safeParse(value);
    if (!parsed.success)
      throw new ChatChannelError("invalidChannel", "The connection details are incomplete");
    const target = parsed.data;
    const address = kind === "matrix" ? (target as MatrixTarget).homeserver : (target as { url: string }).url;
    const field = kind === "matrix" ? "target.homeserver" : "target.url";
    try {
      const url = parseOutboundUrl(address);
      const host = url.hostname.replace(/^\[|\]$/g, "");
      const addresses = /^[\d.]+$|:/.test(host)
        ? [{ address: host }]
        : await this.#policy.resolve(host).catch(() => {
            throw new OutboundError("unresolvable", "The host name could not be resolved");
          });
      if (addresses.length === 0) throw new OutboundError("unresolvable", "The host name has no address");
      for (const entry of addresses) checkAddress(this.#policy, entry.address, url.protocol === "https:");
    } catch (error) {
      if (error instanceof OutboundError && error.reason === "blockedAddress") {
        throw new ChatChannelError("blockedAddress", error.message, { field });
      }
      if (error instanceof OutboundError && error.reason === "insecureAddress") {
        throw new ChatChannelError("insecureAddress", error.message, { field });
      }
      throw new ChatChannelError(
        "invalidAddress",
        error instanceof Error ? error.message : "Invalid address",
        {
          field,
          problem:
            error instanceof OutboundError && error.reason === "unresolvable" ? "unresolvable" : "notUrl",
        },
      );
    }
    return kind === "matrix" ? this.#room(target as MatrixTarget) : target;
  }

  async #room(target: MatrixTarget): Promise<MatrixTarget> {
    const room = parseRoomAddress(target.roomId);
    if (!room) {
      throw new ChatChannelError("invalidAddress", "The room address is not valid", {
        field: "target.roomId",
        problem: "roomAddress",
      });
    }
    if ("roomId" in room) return { ...target, roomId: room.roomId };
    let response: Awaited<ReturnType<typeof sendOutbound>>;
    try {
      response = await sendOutbound(
        this.#policy,
        roomDirectoryRequest(target.homeserver, room.alias, target.accessToken),
      );
    } catch (error) {
      if (error instanceof OutboundError && error.reason === "blockedAddress") {
        throw new ChatChannelError("blockedAddress", error.message, { field: "target.homeserver" });
      }
      throw new ChatChannelError("invalidAddress", "The homeserver could not be reached", {
        field: "target.homeserver",
        problem: "unreachable",
      });
    }
    if (response.status === 401 || response.status === 403) {
      throw new ChatChannelError("invalidAddress", "The homeserver did not accept the access token", {
        field: "target.accessToken",
        problem: "unauthorized",
      });
    }
    let roomId: unknown = null;
    try {
      roomId = (JSON.parse(response.body) as { room_id?: unknown }).room_id;
    } catch {
      roomId = null;
    }
    if (response.status !== 200 || typeof roomId !== "string" || !/^![^:\s]+:\S+$/.test(roomId)) {
      throw new ChatChannelError("invalidAddress", "The homeserver does not know this room", {
        field: "target.roomId",
        problem: "roomNotFound",
      });
    }
    return { ...target, roomId };
  }

  async list(scope: ChatScope): Promise<ChatChannel[]> {
    const result = await this.#database.execute<ChannelRow>(sql`
      select c.* from chat_channels c where ${this.#scopeCondition(scope)} order by c.created_at, c.id`);
    return result.rows.map(toChannel);
  }

  async #row(executor: Executor, scope: ChatScope, id: string, lock = false): Promise<ChannelRow> {
    const result = await executor.execute<ChannelRow>(sql`
      select c.* from chat_channels c where c.id = ${id} and ${this.#scopeCondition(scope)}
      ${lock ? sql`for update` : sql``}`);
    const row = result.rows[0];
    if (!row) throw new ChatChannelError("channelNotFound", "The chat channel does not exist");
    return row;
  }

  #auditScope(organizationId: string) {
    return { type: "organization" as const, id: organizationId };
  }

  async create(actor: Principal, scope: ChatScope, input: ChatChannelInput): Promise<ChatChannelSaved> {
    const name = this.#name(input.name);
    const events = this.#events(scope, input.events);
    const target = await this.#target(input.kind, input.target);
    return this.#database.transaction(async (tx) => {
      const owner = await this.#scopeOf(tx, scope);
      if (owner.confidential) {
        throw new ChatChannelError(
          "confidentialSpace",
          "Confidential and personal spaces cannot post to chat channels",
        );
      }
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`chat:${owner.organizationId}`}, 0))`,
      );
      const count = await tx.execute<{ count: number }>(sql`
        select count(*)::int as count from chat_channels c where ${this.#scopeCondition(scope)}`);
      if ((count.rows[0]?.count ?? 0) >= MAX_CHANNELS) {
        throw new ChatChannelError("tooManyChannels", `A space can post to at most ${MAX_CHANNELS} channels`);
      }
      const id = uuidv7();
      const signingSecret = input.kind === "webhook" ? randomBytes(32).toString("base64url") : null;
      await tx.insert(chatChannels).values({
        id,
        organizationId: owner.organizationId,
        spaceId: owner.spaceId,
        kind: input.kind,
        name,
        events,
        target: this.#encryption.encrypt(JSON.stringify(target), targetContext(id)),
        signingSecret: signingSecret ? this.#encryption.encrypt(signingSecret, secretContext(id)) : null,
        createdBy: actorIdOf(actor),
      });
      await this.#audit.record(tx, {
        name: "chatChannel.connected",
        actor,
        targetId: id,
        fields: { spaceId: owner.spaceId, kind: input.kind, name, events },
        scope: this.#auditScope(owner.organizationId),
      });
      return { channel: toChannel(await this.#row(tx, scope, id)), signingSecret };
    });
  }

  async update(
    actor: Principal,
    scope: ChatScope,
    id: string,
    change: ChatChannelChange,
  ): Promise<ChatChannelSaved> {
    const name = change.name === undefined ? undefined : this.#name(change.name);
    const events = change.events === undefined ? undefined : this.#events(scope, change.events);
    return this.#database.transaction(async (tx) => {
      const row = await this.#row(tx, scope, id, true);
      const target = change.target === undefined ? undefined : await this.#target(row.kind, change.target);
      const signingSecret =
        change.newSecret && row.kind === "webhook" ? randomBytes(32).toString("base64url") : null;
      const resets = target !== undefined || signingSecret !== null;
      await tx
        .update(chatChannels)
        .set({
          ...(name !== undefined ? { name } : {}),
          ...(events !== undefined ? { events } : {}),
          ...(target !== undefined
            ? { target: this.#encryption.encrypt(JSON.stringify(target), targetContext(id)) }
            : {}),
          ...(signingSecret
            ? { signingSecret: this.#encryption.encrypt(signingSecret, secretContext(id)) }
            : {}),
          ...(resets
            ? {
                state: "working" as const,
                failureReason: null,
                failureStatus: null,
                failureCode: null,
                failedAt: null,
                failureAnnounced: false,
              }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(chatChannels.id, id));
      await this.#audit.record(tx, {
        name: "chatChannel.changed",
        actor,
        targetId: id,
        fields: {
          spaceId: row.space_id,
          kind: row.kind,
          name: name ?? row.name,
          events: events ?? row.events,
          addressChanged: target !== undefined,
          signingKeyReplaced: signingSecret !== null,
        },
        scope: this.#auditScope(row.organization_id),
      });
      return { channel: toChannel(await this.#row(tx, scope, id)), signingSecret };
    });
  }

  async remove(actor: Principal, scope: ChatScope, id: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const row = await this.#row(tx, scope, id, true);
      await tx.delete(chatChannels).where(eq(chatChannels.id, id));
      await this.#audit.record(tx, {
        name: "chatChannel.removed",
        actor,
        targetId: id,
        fields: { spaceId: row.space_id, kind: row.kind, name: row.name },
        scope: this.#auditScope(row.organization_id),
      });
    });
  }

  async #language(organizationId: string): Promise<"en" | "de"> {
    return this.#settings.get(languageSetting, { organization: organizationId });
  }

  async #link(path: string): Promise<string | null> {
    const base = await this.#settings.get(instanceUrlSetting, {});
    return base ? new URL(path, base.endsWith("/") ? base : `${base}/`).toString() : null;
  }

  async #testMessage(
    organizationId: string,
    spaceId: string | null,
    channelName: string,
  ): Promise<ChatMessage> {
    const language = await this.#language(organizationId);
    const names = await this.#database.execute<{ space_name: string | null; organization_name: string }>(sql`
      select s.name as space_name, o.name as organization_name from organizations o
      left join spaces s on s.id = ${spaceId} where o.id = ${organizationId}`);
    const spaceName = names.rows[0]?.space_name ?? "";
    const organizationName = names.rows[0]?.organization_name ?? "";
    const texts = chatTexts("test", language, {
      spaceName,
      organizationName,
      actors: [],
      count: 1,
      status: null,
      channelName,
    });
    const url = await this.#link("/");
    return {
      event: "test",
      heading: texts.heading,
      title: spaceName || organizationName,
      detail: texts.detail,
      link: url ? { url, label: texts.linkLabel } : null,
      occurredAt: this.#clock(),
      space: null,
      organizationId,
      item: null,
      actor: null,
    };
  }

  async #send(
    id: string,
    kind: ChatChannelKind,
    target: ChatTarget,
    signingSecret: string | null,
    message: ChatMessage,
  ): Promise<ChatFailure | null> {
    try {
      const response = await sendOutbound(
        this.#policy,
        chatRequest({ id, kind, target, signingSecret, message, now: this.#clock() }),
      );
      return classifyResponse(kind, response);
    } catch (error) {
      return classifyError(error);
    }
  }

  async test(scope: ChatScope, input: ChatChannelInput): Promise<ChatTestResult> {
    const name = this.#name(input.name);
    const target = await this.#target(input.kind, input.target);
    const owner = await this.#scopeOf(this.#database, scope);
    if (owner.confidential) {
      throw new ChatChannelError(
        "confidentialSpace",
        "Confidential and personal spaces cannot post to chat channels",
      );
    }
    const message = await this.#testMessage(owner.organizationId, owner.spaceId, name);
    const failure = await this.#send(uuidv7(), input.kind, target, null, message);
    if (!failure) return { delivered: true };
    const { permanent: _permanent, ...rest } = failure;
    return { delivered: false, failure: rest };
  }

  async testSaved(scope: ChatScope, id: string): Promise<ChatTestResult> {
    const row = await this.#row(this.#database, scope, id);
    const owner = await this.#scopeOf(this.#database, scope);
    if (owner.confidential) {
      throw new ChatChannelError(
        "confidentialSpace",
        "Confidential and personal spaces cannot post to chat channels",
      );
    }
    const target = targetSchemaOf(row.kind).parse(
      JSON.parse(this.#encryption.decryptString(row.target, targetContext(id))),
    );
    const secret = row.signing_secret
      ? this.#encryption.decryptString(row.signing_secret, secretContext(id))
      : null;
    const message = await this.#testMessage(row.organization_id, row.space_id, row.name);
    const failure = await this.#send(uuidv7(), row.kind, target, secret, message);
    if (!failure) {
      await this.#database
        .update(chatChannels)
        .set({
          state: "working",
          failureReason: null,
          failureStatus: null,
          failureCode: null,
          failedAt: null,
          failureAnnounced: false,
          lastAttemptAt: new Date(),
          lastDeliveredAt: new Date(),
        })
        .where(eq(chatChannels.id, id));
      return { delivered: true };
    }
    const { permanent: _permanent, ...rest } = failure;
    return { delivered: false, failure: rest };
  }

  async #shareable(executor: Executor, itemId: string): Promise<ShareableItem | null> {
    const result = await executor.execute<ShareableItem>(sql`
      select t.id, t.title, t.kind, s.id as space_id, s.key as space_key, s.name as space_name,
        s.organization_id
      from tree_items t join spaces s on s.id = t.space_id
      where t.id = ${itemId} and ${shareableItemCondition(sql`t`, sql`s`)}`);
    return result.rows[0] ?? null;
  }

  async #queue(
    tx: Transaction,
    spaceId: string,
    event: SpaceChatEvent,
    entry: {
      subjectId: string;
      data: Record<string, unknown>;
      combineKey?: string;
      notBefore?: Date;
      actorId?: string | null;
    },
  ): Promise<void> {
    const channels = await tx.execute<{ id: string }>(sql`
      select c.id from chat_channels c where c.space_id = ${spaceId} and ${event} = any(c.events)
        and c.state = 'working'`);
    if (channels.rows.length === 0) return;
    const actorIds = entry.actorId ? [entry.actorId] : [];
    const data = JSON.stringify({ ...entry.data, actorIds });
    const notBefore = entry.notBefore ?? this.#clock();
    for (const channel of channels.rows) {
      await tx.execute(sql`
        insert into chat_deliveries (id, channel_id, event, subject_id, data, combine_key, not_before)
        values (${uuidv7()}, ${channel.id}, ${event}, ${entry.subjectId}, ${data}::jsonb,
          ${entry.combineKey ?? null}, ${notBefore})
        on conflict (channel_id, combine_key) where state = 'pending' and combine_key is not null
        do update set count = chat_deliveries.count + 1, updated_at = now(),
          data = jsonb_set(excluded.data, '{actorIds}', (
            select coalesce(jsonb_agg(a order by first), '[]'::jsonb) from (
              select a, min(n) as first from jsonb_array_elements_text(
                coalesce(chat_deliveries.data->'actorIds', '[]'::jsonb) || coalesce(excluded.data->'actorIds', '[]'::jsonb)
              ) with ordinality as e(a, n) group by a) actors))`);
    }
    await tx.execute(sql`select pg_notify(${CHAT_DELIVERIES_CHANNEL}, '')`);
  }

  async contentEvent(
    tx: Transaction,
    event: Exclude<SpaceChatEvent, "decisionRecorded" | "commentCreated">,
    itemId: string,
    input: { actorId: string | null; data?: Record<string, unknown> },
  ): Promise<void> {
    const item = await this.#shareable(tx, itemId);
    if (!item) return;
    await this.#queue(tx, item.space_id, event, {
      subjectId: itemId,
      data: input.data ?? {},
      actorId: input.actorId,
      ...(event === "pageChanged"
        ? {
            combineKey: `pageChanged:${itemId}`,
            notBefore: new Date(this.#clock().getTime() + PAGE_CHANGES_COMBINE_MINUTES * 60_000),
          }
        : {}),
    });
  }

  async versionCreated(
    tx: Transaction,
    itemId: string,
    version: number,
    actorId: string | null,
  ): Promise<void> {
    const facts = await tx.execute<{ kind: string; reason: string; first: boolean }>(sql`
      select t.kind, v.reason, not exists (
        select 1 from page_versions p where p.item_id = t.id and p.number < v.number) as first
      from tree_items t join page_versions v on v.item_id = t.id and v.number = ${version}
      where t.id = ${itemId}`);
    const row = facts.rows[0];
    if (!row || row.reason === "imported" || row.reason === "importedNotApplied") return;
    if (row.kind === "page") {
      await this.contentEvent(tx, row.first ? "pagePublished" : "pageChanged", itemId, { actorId });
    } else if (row.kind === "blogPost" && row.first) {
      await this.contentEvent(tx, "blogPostPublished", itemId, { actorId });
    }
  }

  async commented(tx: Transaction, itemId: string, commentId: string, actorId: string | null): Promise<void> {
    const item = await this.#shareable(tx, itemId);
    if (!item) return;
    await this.#queue(tx, item.space_id, "commentCreated", {
      subjectId: commentId,
      data: { itemId },
      actorId,
    });
  }

  async decisionsRecorded(tx: Transaction, itemId: string, decisionIds: readonly string[]): Promise<void> {
    if (decisionIds.length === 0) return;
    const item = await this.#shareable(tx, itemId);
    if (!item) return;
    for (const decisionId of decisionIds) {
      await this.#queue(tx, item.space_id, "decisionRecorded", {
        subjectId: decisionId,
        data: { itemId },
        combineKey: `decisionRecorded:${decisionId}`,
        notBefore: new Date(this.#clock().getTime() + DECISION_SETTLE_MINUTES * 60_000),
      });
    }
  }

  async announcementChanged(
    tx: Transaction,
    organizationId: string,
    announcement: { id: string; version: string; startsAt: Date },
  ): Promise<void> {
    const channels = await tx.execute<{ id: string }>(sql`
      select c.id from chat_channels c where c.organization_id = ${organizationId} and c.space_id is null
        and 'announcementPublished' = any(c.events) and c.state = 'working'`);
    if (channels.rows.length === 0) return;
    for (const channel of channels.rows) {
      await tx.execute(sql`
        update chat_deliveries set state = 'skipped', updated_at = now()
        where channel_id = ${channel.id} and combine_key = ${`announcement:${announcement.id}`}
          and state = 'pending'`);
      await tx.insert(chatDeliveries).values({
        channelId: channel.id,
        event: "announcementPublished",
        subjectId: announcement.id,
        data: { version: announcement.version },
        combineKey: `announcement:${announcement.id}`,
        notBefore: announcement.startsAt,
      });
    }
    await tx.execute(sql`select pg_notify(${CHAT_DELIVERIES_CHANNEL}, '')`);
  }

  async queuePending(enqueue: (deliveryId: string, startAfter: Date) => Promise<void>): Promise<number> {
    const rows = await this.#database
      .select({ id: chatDeliveries.id, notBefore: chatDeliveries.notBefore })
      .from(chatDeliveries)
      .where(and(eq(chatDeliveries.state, "pending"), isNull(chatDeliveries.queuedAt)))
      .orderBy(chatDeliveries.createdAt)
      .limit(500);
    for (const row of rows) {
      await enqueue(row.id, row.notBefore);
      await this.#database
        .update(chatDeliveries)
        .set({ queuedAt: new Date() })
        .where(eq(chatDeliveries.id, row.id));
    }
    return rows.length;
  }

  async #message(
    executor: Executor,
    channel: ChannelRow,
    delivery: {
      id: string;
      event: string;
      subject_id: string | null;
      data: Record<string, unknown>;
      count: number;
    },
  ): Promise<ChatMessage | null> {
    const event = delivery.event as ChatEvent;
    const language = await this.#language(channel.organization_id);
    const actorIds = Array.isArray(delivery.data.actorIds)
      ? (delivery.data.actorIds as unknown[]).filter((id): id is string => typeof id === "string")
      : [];
    const actors =
      actorIds.length > 0
        ? (
            await executor.execute<{ name: string }>(sql`
              select a.name from unnest(${sql.param(actorIds.slice(0, MAX_ACTORS))}::uuid[]) with ordinality as u(id, n)
              join accounts a on a.id = u.id order by u.n`)
          ).rows.map((row) => row.name)
        : [];
    if (event === "announcementPublished") {
      const result = await executor.execute<{
        text: string;
        link_url: string | null;
        link_label: string | null;
        organization_name: string;
      }>(sql`
        select a.text, a.link_url, a.link_label, o.name as organization_name from announcements a
        join organizations o on o.id = a.organization_id
        where a.id = ${delivery.subject_id} and a.organization_id = ${channel.organization_id}
          and a.version = ${String(delivery.data.version ?? "")}::uuid and a.ends_at > now()`);
      const row = result.rows[0];
      if (!row) return null;
      const texts = chatTexts(event, language, {
        spaceName: "",
        organizationName: row.organization_name,
        actors,
        count: 1,
        status: null,
        channelName: channel.name,
      });
      return {
        event,
        heading: texts.heading,
        title: clip(row.text, ANNOUNCEMENT_PREVIEW_LIMIT),
        detail: null,
        link: row.link_url ? { url: row.link_url, label: row.link_label ?? texts.linkLabel } : null,
        occurredAt: this.#clock(),
        space: null,
        organizationId: channel.organization_id,
        item: null,
        actor: null,
      };
    }
    const itemId =
      event === "commentCreated" || event === "decisionRecorded"
        ? String(delivery.data.itemId ?? "")
        : (delivery.subject_id ?? "");
    const item = await this.#shareable(executor, itemId);
    if (!item || item.space_id !== channel.space_id) return null;
    let detailOverride: string | null = null;
    if (event === "commentCreated") {
      const comment = await executor.execute(sql`
        select 1 from comments c left join comments root on root.id = c.parent_id
        where c.id = ${delivery.subject_id} and c.item_id = ${item.id} and c.deleted_at is null
          and not coalesce(root.quote is not null and not root.quote_public, false)
          and not (c.quote is not null and not c.quote_public)`);
      if (comment.rows.length === 0) return null;
    }
    if (event === "decisionRecorded") {
      const decision = await executor.execute<{ text: string }>(sql`
        select text from decisions where id = ${delivery.subject_id} and item_id = ${item.id} and published`);
      const text = decision.rows[0]?.text?.trim();
      if (!text) return null;
      detailOverride = clip(text, DECISION_TEXT_LIMIT);
    }
    const texts = chatTexts(event, language, {
      spaceName: item.space_name,
      organizationName: "",
      actors,
      count: delivery.count,
      status:
        event === "pageStatusChanged"
          ? {
              builtIn: typeof delivery.data.statusBuiltIn === "string" ? delivery.data.statusBuiltIn : null,
              name: typeof delivery.data.statusName === "string" ? delivery.data.statusName : null,
            }
          : null,
      channelName: channel.name,
    });
    const section = item.kind === "blogPost" ? "blog" : "pages";
    const url = await this.#link(
      `spaces/${encodeURIComponent(item.space_key)}/${section}/${item.id}/${slugify(item.title)}`,
    );
    return {
      event,
      heading: texts.heading,
      title: item.title,
      detail: detailOverride ?? texts.detail,
      link: url ? { url, label: texts.linkLabel } : null,
      occurredAt: this.#clock(),
      space: { id: item.space_id, key: item.space_key, name: item.space_name },
      organizationId: channel.organization_id,
      item: { id: item.id, kind: item.kind },
      actor: actors[0] ?? null,
    };
  }

  async deliver(
    deliveryId: string,
    lastAttempt: boolean,
  ): Promise<"delivered" | "skipped" | "failed" | "retry"> {
    const loaded = await this.#database.execute<
      ChannelRow & {
        delivery_id: string;
        event: string;
        subject_id: string | null;
        data: Record<string, unknown>;
        count: number;
        delivery_state: string;
        not_before: Date | string;
        confidential: boolean | null;
      }
    >(sql`
      select c.*, d.id as delivery_id, d.event, d.subject_id, d.data, d.count, d.state as delivery_state,
        d.not_before, s.confidential or s.personal_of is not null as confidential
      from chat_deliveries d join chat_channels c on c.id = d.channel_id
      left join spaces s on s.id = c.space_id
      where d.id = ${deliveryId}`);
    const row = loaded.rows[0];
    if (row?.delivery_state !== "pending") return "skipped";
    if (new Date(row.not_before).getTime() > this.#clock().getTime() + 1000) return "retry";
    const finish = async (state: "delivered" | "skipped" | "failed") => {
      await this.#database
        .update(chatDeliveries)
        .set({ state, updatedAt: new Date(), attempts: sql`${chatDeliveries.attempts} + 1` })
        .where(and(eq(chatDeliveries.id, deliveryId), eq(chatDeliveries.state, "pending")));
      return state;
    };
    if (row.state === "failing" || row.confidential) return finish("skipped");
    const message = await this.#message(this.#database, row, {
      id: row.delivery_id,
      event: row.event,
      subject_id: row.subject_id,
      data: row.data,
      count: row.count,
    });
    if (!message) return finish("skipped");
    const target = targetSchemaOf(row.kind).parse(
      JSON.parse(this.#encryption.decryptString(row.target, targetContext(row.id))),
    );
    const secret = row.signing_secret
      ? this.#encryption.decryptString(row.signing_secret, secretContext(row.id))
      : null;
    const failure = await this.#send(deliveryId, row.kind, target, secret, message);
    await this.#database
      .update(chatChannels)
      .set({ lastAttemptAt: new Date() })
      .where(eq(chatChannels.id, row.id));
    if (!failure) {
      await this.#database
        .update(chatChannels)
        .set({ lastDeliveredAt: new Date() })
        .where(eq(chatChannels.id, row.id));
      return finish("delivered");
    }
    if (!failure.permanent && !lastAttempt) {
      await this.#database
        .update(chatDeliveries)
        .set({ attempts: sql`${chatDeliveries.attempts} + 1`, updatedAt: new Date() })
        .where(eq(chatDeliveries.id, deliveryId));
      return "retry";
    }
    await this.#markFailing(row, failure);
    return finish("failed");
  }

  async #markFailing(channel: ChannelRow, failure: ChatFailure): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const previous = await tx.execute<{ failure_announced: boolean }>(
        sql`select failure_announced from chat_channels where id = ${channel.id} for update`,
      );
      await tx.execute(sql`
        update chat_channels set state = 'failing', failure_reason = ${failure.reason},
          failure_status = ${failure.status}, failure_code = ${failure.code}, failed_at = now(),
          failure_announced = true, updated_at = now()
        where id = ${channel.id}`);
      const announce = previous.rows[0]?.failure_announced === false;
      if (!announce) return;
      const space = channel.space_id
        ? (await tx.execute<{ key: string }>(sql`select key from spaces where id = ${channel.space_id}`))
            .rows[0]
        : undefined;
      const recipients = channel.space_id
        ? await this.#recipients.space(tx, channel.space_id)
        : await this.#recipients.organization(tx, channel.organization_id);
      await this.#notifications.notify(tx, {
        type: "chatChannel.failing",
        recipients,
        organizationId: channel.organization_id,
        targetId: channel.id,
        params: {
          channelName: channel.name,
          kind: channel.kind,
          reason: failure.reason,
          spaceId: channel.space_id,
          spaceKey: space?.key ?? null,
          organizationId: channel.organization_id,
        },
      });
    });
    this.#logger.warn(
      { channelId: channel.id, reason: failure.reason, status: failure.status },
      "A chat channel stopped accepting messages",
    );
  }

  async removeOldDeliveries(): Promise<number> {
    const removed = await this.#database.execute(sql`
      delete from chat_deliveries where state <> 'pending'
        and updated_at < now() - make_interval(days => ${DELIVERY_RETENTION_DAYS})`);
    return removed.rowCount ?? 0;
  }
}
