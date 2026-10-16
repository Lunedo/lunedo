import { createHash } from "node:crypto";
import { slugify } from "@pagehall/editor-schema";
import { notificationEventOf, uuidv7 } from "@pagehall/shared";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { instanceUrlSetting } from "../accounts/instance-settings.js";
import { accounts } from "../accounts/schema.js";
import { accountScopeChain } from "../accounts/scope.js";
import { sessions } from "../auth/schema.js";
import type { SessionService } from "../auth/sessions.js";
import type { Encryption } from "../crypto/envelope.js";
import type { Database } from "../database/database.js";
import type { NotificationListener } from "../database/notifications.js";
import { defineJob, type JobQueue } from "../jobs/job-queue.js";
import type { Logger } from "../logging/logger.js";
import type { MailService } from "../mail/mail-service.js";
import { instanceSecrets } from "../mail/schema.js";
import type { NotificationService } from "../notifications/service.js";
import { browserPushSetting, notificationEventSettings } from "../notifications/types.js";
import {
  OutboundError,
  type OutboundPolicy,
  parseOutboundUrl,
  sendOutbound,
} from "../outbound/guarded-request.js";
import type { SettingsService } from "../settings/service.js";
import { PUSH_OUTBOX_CHANNEL } from "./outbox.js";
import { pushOutbox, pushSubscriptions } from "./schema.js";
import { pushText } from "./texts.js";
import {
  encryptPushPayload,
  generateVapidKeys,
  type PushKeys,
  parsePushKeys,
  type VapidKeys,
  vapidAuthorization,
} from "./web-push.js";

const VAPID_KEYS = "push.vapidKeys";
const MAX_DEVICES = 20;
const PUSH_TTL_SECONDS = 24 * 60 * 60;
const DISPATCH_DELAY_MS = 100;
const TEXT_LIMIT = 300;
const ABANDONED_MINUTES = 60;

export const PUSH_WATCHDOG_SCHEDULE = "*/10 * * * *";

export const pushDeliveryJob = defineJob({
  name: "push.deliver",
  payload: z.object({ entryId: z.uuid() }),
  retryLimit: 4,
  retryDelaySeconds: 30,
  retryBackoff: true,
  expireInSeconds: 2 * 60,
});

export const pushDispatchJob = defineJob({
  name: "push.dispatch",
  payload: z.object({}),
  retryLimit: 5,
  retryDelaySeconds: 5,
  retryBackoff: true,
});

const vapidKeysSchema = z.object({ publicKey: z.string(), privateKey: z.string() });
const storedSubscription = z.object({ endpoint: z.string(), p256dh: z.string(), auth: z.string() });

export interface PushSubscriptionInput {
  endpoint: string;
  keys: PushKeys;
}

export interface PushDevice {
  id: string;
  browser: string | null;
  operatingSystem: string | null;
  createdAt: Date;
  lastDeliveredAt: Date | null;
  current: boolean;
}

export interface PushStatus {
  enabled: boolean;
  publicKey: string | null;
}

export class PushSubscriptionError extends Error {
  override name = "PushSubscriptionError";
  readonly code: "invalidSubscription" | "pushDisabled" | "tooManyDevices";

  constructor(code: PushSubscriptionError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export type PushResult = "delivered" | "gone" | "rejected" | "retry";

function endpointHash(endpoint: string): Buffer {
  return createHash("sha256").update(endpoint, "utf8").digest();
}

function subscriptionContext(id: string): string {
  return `push_subscriptions.subscription:${id}`;
}

function secretContext(name: string): string {
  return `instance_secrets.value:${name}`;
}

function clip(value: string): string {
  return value.length > TEXT_LIMIT ? `${value.slice(0, TEXT_LIMIT - 1)}…` : value;
}

export function pushLink(type: string, targetId: string | null, params: Record<string, unknown>): string {
  const spaceKey = typeof params.spaceKey === "string" ? params.spaceKey : "";
  const title = typeof params.itemTitle === "string" ? params.itemTitle : "";
  if ((type === "access.requested" || type === "access.requestDecided") && targetId) {
    return `/access-requests/${targetId}`;
  }
  if (targetId && spaceKey && typeof params.itemKind === "string") {
    const section =
      params.itemKind === "blogPost" ? "blog" : params.itemKind === "whiteboard" ? "whiteboards" : "pages";
    return `/spaces/${encodeURIComponent(spaceKey)}/${section}/${targetId}/${slugify(title)}`;
  }
  return "/";
}

export class PushService {
  readonly #database: Database;
  readonly #encryption: Encryption;
  readonly #settings: SettingsService;
  readonly #notifications: NotificationService;
  readonly #mail: MailService;
  readonly #sessions: SessionService;
  readonly #policy: OutboundPolicy;
  readonly #logger: Logger;

  constructor(options: {
    database: Database;
    encryption: Encryption;
    settings: SettingsService;
    notifications: NotificationService;
    mail: MailService;
    sessions: SessionService;
    policy: OutboundPolicy;
    logger: Logger;
  }) {
    this.#database = options.database;
    this.#encryption = options.encryption;
    this.#settings = options.settings;
    this.#notifications = options.notifications;
    this.#mail = options.mail;
    this.#sessions = options.sessions;
    this.#policy = options.policy;
    this.#logger = options.logger;
  }

  async enabled(): Promise<boolean> {
    return this.#settings.get(browserPushSetting, {});
  }

  async status(): Promise<PushStatus> {
    if (!(await this.enabled())) return { enabled: false, publicKey: null };
    return { enabled: true, publicKey: (await this.#keys()).publicKey };
  }

  async #keys(): Promise<VapidKeys> {
    const read = async (executor: Pick<Database, "select">) => {
      const [row] = await executor
        .select({ value: instanceSecrets.value })
        .from(instanceSecrets)
        .where(eq(instanceSecrets.name, VAPID_KEYS));
      return row
        ? vapidKeysSchema.parse(
            JSON.parse(this.#encryption.decryptString(row.value, secretContext(VAPID_KEYS))),
          )
        : null;
    };
    const existing = await read(this.#database);
    if (existing) return existing;
    return this.#database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${VAPID_KEYS}, 0))`);
      const created = await read(tx);
      if (created) return created;
      const keys = generateVapidKeys();
      await tx.insert(instanceSecrets).values({
        name: VAPID_KEYS,
        value: this.#encryption.encrypt(JSON.stringify(keys), secretContext(VAPID_KEYS)),
      });
      return keys;
    });
  }

  async subscribe(accountId: string, sessionId: string, input: PushSubscriptionInput): Promise<PushDevice> {
    if (!(await this.enabled())) {
      throw new PushSubscriptionError("pushDisabled", "Browser push is turned off for this instance");
    }
    let endpoint: URL;
    try {
      endpoint = parseOutboundUrl(input.endpoint);
      parsePushKeys(input.keys);
    } catch {
      throw new PushSubscriptionError("invalidSubscription", "The browser sent an invalid push subscription");
    }
    if (endpoint.protocol !== "https:" || input.endpoint.length > 2000) {
      throw new PushSubscriptionError("invalidSubscription", "The push service address needs HTTPS");
    }
    const hash = endpointHash(input.endpoint);
    return this.#database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`push:${accountId}`}, 0))`);
      const [session] = await tx
        .select({ browser: sessions.browser, operatingSystem: sessions.operatingSystem })
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.accountId, accountId)));
      if (!session) throw new PushSubscriptionError("invalidSubscription", "The session has ended");
      await tx.delete(pushSubscriptions).where(eq(pushSubscriptions.endpointHash, hash));
      const count = await tx.$count(pushSubscriptions, eq(pushSubscriptions.accountId, accountId));
      if (count >= MAX_DEVICES) {
        throw new PushSubscriptionError("tooManyDevices", "Remove a device before adding another one");
      }
      const id = uuidv7();
      const [row] = await tx
        .insert(pushSubscriptions)
        .values({
          id,
          accountId,
          sessionId,
          endpointHash: hash,
          subscription: this.#encryption.encrypt(
            JSON.stringify({ endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth }),
            subscriptionContext(id),
          ),
          browser: session.browser,
          operatingSystem: session.operatingSystem,
        })
        .returning({ id: pushSubscriptions.id, createdAt: pushSubscriptions.createdAt });
      if (!row) throw new Error("The subscription was not stored");
      return {
        id: row.id,
        browser: session.browser,
        operatingSystem: session.operatingSystem,
        createdAt: row.createdAt,
        lastDeliveredAt: null,
        current: true,
      };
    });
  }

  async devices(accountId: string, currentSessionId: string | null): Promise<PushDevice[]> {
    const rows = await this.#database
      .select({
        id: pushSubscriptions.id,
        sessionId: pushSubscriptions.sessionId,
        browser: pushSubscriptions.browser,
        operatingSystem: pushSubscriptions.operatingSystem,
        createdAt: pushSubscriptions.createdAt,
        lastDeliveredAt: pushSubscriptions.lastDeliveredAt,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.accountId, accountId))
      .orderBy(pushSubscriptions.createdAt);
    return rows.map(({ sessionId, ...row }) => ({ ...row, current: sessionId === currentSessionId }));
  }

  async remove(accountId: string, id: string): Promise<boolean> {
    const removed = await this.#database
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.id, id), eq(pushSubscriptions.accountId, accountId)))
      .returning({ id: pushSubscriptions.id });
    return removed.length > 0;
  }

  async removeSession(accountId: string, sessionId: string): Promise<number> {
    const removed = await this.#database
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.accountId, accountId), eq(pushSubscriptions.sessionId, sessionId)))
      .returning({ id: pushSubscriptions.id });
    return removed.length;
  }

  async queuePending(enqueue: (entryId: string) => Promise<void>): Promise<number> {
    const rows = await this.#database
      .select({ id: pushOutbox.id })
      .from(pushOutbox)
      .where(isNull(pushOutbox.queuedAt))
      .orderBy(pushOutbox.createdAt)
      .limit(500);
    for (const row of rows) {
      await enqueue(row.id);
      await this.#database.update(pushOutbox).set({ queuedAt: new Date() }).where(eq(pushOutbox.id, row.id));
    }
    return rows.length;
  }

  async drop(entryId: string): Promise<void> {
    await this.#database.delete(pushOutbox).where(eq(pushOutbox.id, entryId));
  }

  async dropAbandoned(): Promise<number> {
    const dropped = await this.#database
      .delete(pushOutbox)
      .where(lt(pushOutbox.queuedAt, sql`now() - make_interval(mins => ${ABANDONED_MINUTES})`))
      .returning({ id: pushOutbox.id });
    return dropped.length;
  }

  async message(entryId: string): Promise<{ recipientId: string; message: PushMessage } | null> {
    const [entry] = await this.#database
      .select({
        recipientId: pushOutbox.recipientId,
        organizationId: pushOutbox.organizationId,
        type: pushOutbox.type,
        targetId: pushOutbox.targetId,
        actorId: pushOutbox.actorId,
        actorCount: pushOutbox.actorCount,
        params: pushOutbox.params,
        state: accounts.state,
      })
      .from(pushOutbox)
      .innerJoin(accounts, eq(accounts.id, pushOutbox.recipientId))
      .where(eq(pushOutbox.id, entryId));
    if (entry?.state !== "active" || !(await this.enabled())) return null;
    const event = notificationEventOf(entry.type);
    const preference = event ? notificationEventSettings.get(event.id) : undefined;
    if (!preference) return null;
    const chain = entry.organizationId
      ? { organization: entry.organizationId, user: entry.recipientId }
      : { ...(await accountScopeChain(this.#database, entry.recipientId)), user: entry.recipientId };
    if (!(await this.#settings.get(preference.push, chain))) return null;
    if (!(await this.#notifications.visibleTo(entry.recipientId, entry))) return null;
    const [actor] = entry.actorId
      ? await this.#database
          .select({ name: accounts.name })
          .from(accounts)
          .where(eq(accounts.id, entry.actorId))
      : [];
    const params = (entry.params ?? {}) as Record<string, unknown>;
    const language = await this.#mail.languageOf(entry.recipientId);
    const text = pushText(entry.type, language, {
      params,
      actor: actor?.name ?? null,
      actorCount: entry.actorCount,
    });
    return {
      recipientId: entry.recipientId,
      message: {
        title: clip(text.title),
        body: clip(text.body),
        url: pushLink(entry.type, entry.targetId, params),
        tag: `${entry.type}:${entry.targetId ?? entryId}`,
      },
    };
  }

  async deliver(entryId: string, lastAttempt: boolean): Promise<void> {
    const built = await this.message(entryId);
    if (!built) {
      await this.#database.delete(pushOutbox).where(eq(pushOutbox.id, entryId));
      return;
    }
    const rows = await this.#database
      .select({
        id: pushSubscriptions.id,
        sessionId: pushSubscriptions.sessionId,
        subscription: pushSubscriptions.subscription,
      })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.accountId, built.recipientId));
    const keys = await this.#keys();
    const subject = (await this.#settings.get(instanceUrlSetting, {})) || "mailto:noreply@localhost";
    let retry = false;
    for (const row of rows) {
      if (!(await this.#sessions.isActive(row.sessionId))) {
        await this.#database.delete(pushSubscriptions).where(eq(pushSubscriptions.id, row.id));
        continue;
      }
      const stored = storedSubscription.parse(
        JSON.parse(this.#encryption.decryptString(row.subscription, subscriptionContext(row.id))),
      );
      const result = await this.send(stored, built.message, keys, subject);
      if (result === "delivered") {
        await this.#database
          .update(pushSubscriptions)
          .set({ lastDeliveredAt: new Date() })
          .where(eq(pushSubscriptions.id, row.id));
      } else if (result === "gone") {
        await this.#database.delete(pushSubscriptions).where(eq(pushSubscriptions.id, row.id));
      } else if (result === "retry") {
        retry = true;
      }
    }
    if (retry && !lastAttempt) throw new Error("A push service did not accept the message yet");
    await this.#database.delete(pushOutbox).where(eq(pushOutbox.id, entryId));
  }

  async send(
    subscription: { endpoint: string; p256dh: string; auth: string },
    message: PushMessage,
    keys: VapidKeys,
    subject: string,
  ): Promise<PushResult> {
    let body: Buffer;
    try {
      body = encryptPushPayload(Buffer.from(JSON.stringify(message), "utf8"), subscription);
    } catch {
      return "gone";
    }
    const endpoint = new URL(subscription.endpoint);
    try {
      const response = await sendOutbound(this.#policy, {
        url: subscription.endpoint,
        method: "POST",
        headers: {
          authorization: await vapidAuthorization(endpoint, keys, subject),
          "content-encoding": "aes128gcm",
          "content-type": "application/octet-stream",
          ttl: String(PUSH_TTL_SECONDS),
          urgency: "normal",
        },
        body,
        maxRedirects: 0,
      });
      if (response.status >= 200 && response.status < 300) return "delivered";
      if (response.status === 404 || response.status === 410) return "gone";
      if (response.status === 429 || response.status >= 500) return "retry";
      this.#logger.warn({ status: response.status, host: endpoint.host }, "A push service refused a message");
      return "rejected";
    } catch (error) {
      if (error instanceof OutboundError && error.reason !== "timeout" && error.reason !== "network") {
        this.#logger.warn(
          { reason: error.reason, host: endpoint.host },
          "A push service address is not allowed",
        );
        return "rejected";
      }
      return "retry";
    }
  }
}

export async function startPushDelivery(options: {
  jobs: JobQueue;
  listener: NotificationListener;
  push: PushService;
  logger: Logger;
}): Promise<void> {
  const { jobs, listener, push, logger } = options;
  await jobs.work(pushDeliveryJob, async (job) => {
    const lastAttempt = job.retryCount >= pushDeliveryJob.retryLimit;
    try {
      await push.deliver(job.payload.entryId, lastAttempt);
    } catch (error) {
      if (!lastAttempt) throw error;
      await push.drop(job.payload.entryId);
      logger.warn({ err: error }, "A browser push message was dropped after its last attempt");
    }
  });
  await jobs.work(pushDispatchJob, async () => {
    await push.dropAbandoned();
    await push.queuePending(async (entryId) => {
      await jobs.enqueue(pushDeliveryJob, { entryId }, { idempotencyKey: entryId });
    });
  });
  let timer: NodeJS.Timeout | undefined;
  const request = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      jobs.enqueue(pushDispatchJob, {}).catch((error: unknown) => {
        logger.warn({ err: error }, "Could not queue browser push messages");
      });
    }, DISPATCH_DELAY_MS);
    timer.unref();
  };
  await listener.listen(PUSH_OUTBOX_CHANNEL, request);
  listener.onReconnect(request);
  await jobs.enqueue(pushDispatchJob, {});
  await jobs.schedule(pushDispatchJob, PUSH_WATCHDOG_SCHEDULE, {}, { key: "watchdog" });
}
