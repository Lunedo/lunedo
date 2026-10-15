import { emailSchema, uuidv7 } from "@pagehall/shared";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { instanceNameSetting, instanceUrlSetting } from "../accounts/instance-settings.js";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import { instanceAdministratorIds } from "../auth/emergency-recipients.js";
import { ChatChannelError, type ChatChannelService, type ChatTestResult } from "../chat/channels.js";
import type { ChatMessage } from "../chat/formats.js";
import type { Encryption } from "../crypto/envelope.js";
import type { Database, Transaction } from "../database/database.js";
import type { FileStore } from "../files/store.js";
import type { JobQueue } from "../jobs/job-queue.js";
import type { Logger } from "../logging/logger.js";
import type { MailService } from "../mail/mail-service.js";
import { instanceSecrets } from "../mail/schema.js";
import { storageCleared, storageReached, storageTest } from "../mail/storage-texts.js";
import type { Language } from "../mail/templates.js";
import type { NotificationService } from "../notifications/service.js";
import { languageSetting } from "../settings/builtin.js";
import type { SettingsService } from "../settings/service.js";
import { LARGE_WRITE_REFUSED, StorageFullError, StorageSettingsError, UPLOAD_REFUSED } from "./errors.js";
import { formatBytes, formatPercent } from "./format.js";
import {
  MAX_OPERATIONS_ADDRESSES,
  type StorageReminder,
  storageCriticalPercentSetting,
  storageLargeWritesPercentSetting,
  storageOperationsEmailsSetting,
  storageReminderSetting,
  storageS3LimitSetting,
  storageWarningPercentSetting,
} from "./settings.js";
import type { StorageUsage } from "./usage.js";

export type StorageLevel = 0 | 1 | 2 | 3;

export const CLEAR_MARGIN_POINTS = 5;
export const MIN_CHECK_INTERVAL_MS = 30_000;
const TEAMS_SECRET = "storage.operationsTeamsWebhook";
const DAY_MS = 24 * 60 * 60 * 1000;

export interface StorageThresholds {
  warning: number;
  largeWrites: number;
  critical: number;
}

export interface StorageReading {
  store: "local" | "s3";
  usedBytes: number;
  totalBytes: number;
  percent: number;
}

export interface StorageStatus {
  store: "local" | "s3";
  measured: boolean;
  inactiveReason: "noLimit" | null;
  usedBytes: number | null;
  totalBytes: number | null;
  percent: number | null;
  level: StorageLevel;
  thresholds: StorageThresholds;
  s3LimitBytes: number | null;
  reminder: StorageReminder;
  operationsEmails: string[];
  teamsWebhook: { configured: boolean; host: string | null };
  checkedAt: Date | null;
}

export interface StorageConfigurationInput {
  thresholds?: Partial<StorageThresholds> | undefined;
  s3LimitBytes?: number | null | undefined;
  reminder?: StorageReminder | undefined;
  operationsEmails?: readonly string[] | undefined;
  teamsWebhook?: string | null | undefined;
}

export type StorageChange = "raised" | "cleared" | "reminder";

export interface StorageCheckResult {
  skipped: boolean;
  reading: StorageReading | null;
  level: StorageLevel;
  change: StorageChange | null;
}

type StateRow = {
  active_level: number;
  reached_level: number;
  notified_at: Date | string | null;
  checked_at: Date | string | null;
};

interface Announcement {
  change: StorageChange;
  level: StorageLevel;
  previous: StorageLevel;
  reading: StorageReading;
}

export function levelOf(percent: number, thresholds: StorageThresholds): StorageLevel {
  if (percent >= thresholds.critical) return 3;
  if (percent >= thresholds.largeWrites) return 2;
  if (percent >= thresholds.warning) return 1;
  return 0;
}

function thresholdOf(level: 1 | 2 | 3, thresholds: StorageThresholds): number {
  return level === 3 ? thresholds.critical : level === 2 ? thresholds.largeWrites : thresholds.warning;
}

function holdLevel(percent: number, thresholds: StorageThresholds): StorageLevel {
  for (const level of [3, 2, 1] as const) {
    if (percent >= thresholdOf(level, thresholds) - CLEAR_MARGIN_POINTS) return level;
  }
  return 0;
}

export function reminderDue(reminder: StorageReminder, since: Date, now: Date): boolean {
  if (reminder === "off") return false;
  if (reminder === "daily") return now.getTime() - since.getTime() >= DAY_MS;
  if (reminder === "weekly") return now.getTime() - since.getTime() >= 7 * DAY_MS;
  const next = new Date(since);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return now.getTime() >= next.getTime();
}

function secretContext(): string {
  return `instance_secrets.value:${TEAMS_SECRET}`;
}

export class StorageService {
  readonly #database: Database;
  readonly #store: FileStore;
  readonly #usage: StorageUsage;
  readonly #settings: SettingsService;
  readonly #notifications: NotificationService;
  readonly #mail: MailService;
  readonly #chat: ChatChannelService;
  readonly #encryption: Encryption;
  readonly #audit: AuditLog;
  readonly #logger: Logger;
  readonly #clock: () => Date;

  constructor(options: {
    database: Database;
    store: FileStore;
    usage: StorageUsage;
    settings: SettingsService;
    notifications: NotificationService;
    mail: MailService;
    chat: ChatChannelService;
    encryption: Encryption;
    audit: AuditLog;
    jobs?: JobQueue | undefined;
    logger: Logger;
    clock?: () => Date;
  }) {
    this.#database = options.database;
    this.#store = options.store;
    this.#usage = options.usage;
    this.#settings = options.settings;
    this.#notifications = options.notifications;
    this.#mail = options.mail;
    this.#chat = options.chat;
    this.#encryption = options.encryption;
    this.#audit = options.audit;
    this.#logger = options.logger;
    this.#clock = options.clock ?? (() => new Date());
  }

  async thresholds(): Promise<StorageThresholds> {
    return {
      warning: await this.#settings.get(storageWarningPercentSetting, {}),
      largeWrites: await this.#settings.get(storageLargeWritesPercentSetting, {}),
      critical: await this.#settings.get(storageCriticalPercentSetting, {}),
    };
  }

  async reading(): Promise<StorageReading | null> {
    const capacity = await this.#store.capacity();
    if (capacity) {
      if (capacity.total <= 0) return null;
      const used = Math.max(0, capacity.total - capacity.free);
      return {
        store: "local",
        usedBytes: used,
        totalBytes: capacity.total,
        percent: (used / capacity.total) * 100,
      };
    }
    const limit = await this.#settings.get(storageS3LimitSetting, {});
    if (limit === null) return null;
    const used = await this.#usage.total();
    return { store: "s3", usedBytes: used, totalBytes: limit, percent: (used / limit) * 100 };
  }

  async requireUpload(): Promise<void> {
    const reading = await this.reading();
    if (!reading) return;
    if (reading.percent >= (await this.thresholds()).critical)
      throw new StorageFullError("upload", UPLOAD_REFUSED);
  }

  async requireLargeWrite(additionalBytes = 0): Promise<void> {
    const reading = await this.reading();
    if (!reading) return;
    const projected = ((reading.usedBytes + additionalBytes) / reading.totalBytes) * 100;
    if (projected >= (await this.thresholds()).largeWrites) {
      throw new StorageFullError("largeWrite", LARGE_WRITE_REFUSED);
    }
  }

  async requireBuildRoom(writtenBytes = 0): Promise<void> {
    const reading = await this.reading();
    if (!reading) return;
    const extra = reading.store === "s3" ? writtenBytes : 0;
    const percent = ((reading.usedBytes + extra) / reading.totalBytes) * 100;
    if (percent >= (await this.thresholds()).critical)
      throw new StorageFullError("largeWrite", LARGE_WRITE_REFUSED);
  }

  async #state(executor: Pick<Database, "execute">): Promise<StateRow> {
    const result = await executor.execute<StateRow>(sql`
      select active_level, reached_level, notified_at, checked_at from storage_state where singleton`);
    const row = result.rows[0];
    if (!row) throw new Error("The storage state is missing");
    return row;
  }

  async status(): Promise<StorageStatus> {
    const reading = await this.reading();
    await this.#database.execute(
      sql`insert into storage_state (singleton) values (true) on conflict do nothing`,
    );
    const state = await this.#state(this.#database);
    const limit = await this.#settings.get(storageS3LimitSetting, {});
    const secret = await this.#teamsWebhook(this.#database);
    return {
      store: reading?.store ?? this.#store.kind,
      measured: reading !== null,
      inactiveReason: reading === null && this.#store.kind === "s3" ? "noLimit" : null,
      usedBytes: reading?.usedBytes ?? null,
      totalBytes: reading?.totalBytes ?? null,
      percent: reading?.percent ?? null,
      level: state.active_level as StorageLevel,
      thresholds: await this.thresholds(),
      s3LimitBytes: limit,
      reminder: await this.#settings.get(storageReminderSetting, {}),
      operationsEmails: await this.#settings.get(storageOperationsEmailsSetting, {}),
      teamsWebhook: { configured: secret !== null, host: secret ? new URL(secret).hostname : null },
      checkedAt: state.checked_at ? new Date(state.checked_at) : null,
    };
  }

  async activeLevel(): Promise<StorageLevel> {
    const result = await this.#database.execute<{ active_level: number }>(
      sql`select active_level from storage_state where singleton`,
    );
    return (result.rows[0]?.active_level ?? 0) as StorageLevel;
  }

  async reconcile(): Promise<number | null> {
    if (this.#store.kind !== "s3") return null;
    return this.#usage.reconcile(this.#store, this.#clock());
  }

  async check(): Promise<StorageCheckResult> {
    const now = this.#clock();
    if (this.#store.kind === "s3" && (await this.#usage.reconciledAt()) === null) await this.reconcile();
    const reading = await this.reading();
    const thresholds = await this.thresholds();
    const reminder = await this.#settings.get(storageReminderSetting, {});
    let announcement: Announcement | null = null;
    let skipped = false;
    let level: StorageLevel = 0;
    const mailIds: string[] = [];
    await this.#database.transaction(async (tx) => {
      await tx.execute(sql`insert into storage_state (singleton) values (true) on conflict do nothing`);
      const locked = await tx.execute<StateRow>(sql`
        select active_level, reached_level, notified_at, checked_at from storage_state
        where singleton for update`);
      const state = locked.rows[0];
      if (!state) throw new Error("The storage state is missing");
      const previous = state.active_level as StorageLevel;
      level = previous;
      if (state.checked_at && now.getTime() - new Date(state.checked_at).getTime() < MIN_CHECK_INTERVAL_MS) {
        skipped = true;
        return;
      }
      if (!reading) {
        await tx.execute(sql`
          update storage_state set active_level = 0, reached_level = 0, notified_at = null,
            checked_at = ${now}, updated_at = now() where singleton`);
        level = 0;
        return;
      }
      const reached = levelOf(reading.percent, thresholds);
      const sustained = Math.min(reached, state.reached_level) as StorageLevel;
      let active = previous;
      let notifiedAt = state.notified_at ? new Date(state.notified_at) : null;
      if (sustained > previous) {
        active = sustained;
        announcement = { change: "raised", level: active, previous, reading };
      } else {
        const held = holdLevel(reading.percent, thresholds);
        if (held < previous) {
          active = held;
          announcement = { change: "cleared", level: active, previous, reading };
        } else if (previous > 0 && notifiedAt && reminderDue(reminder, notifiedAt, now)) {
          announcement = { change: "reminder", level: previous, previous, reading };
        }
      }
      if (announcement) notifiedAt = active === 0 ? null : now;
      level = active;
      await tx.execute(sql`
        update storage_state set active_level = ${active}, reached_level = ${reached},
          notified_at = ${notifiedAt}, checked_at = ${now}, updated_at = now() where singleton`);
      if (announcement) mailIds.push(...(await this.#announce(tx, announcement)));
    });
    const sent = announcement as Announcement | null;
    if (sent) {
      await this.#notifications.dispatch(mailIds);
      await this.#postTeams(sent);
    }
    return { skipped, reading, level, change: sent?.change ?? null };
  }

  async #language(tx: Transaction): Promise<Language> {
    return this.#settings.get(languageSetting, {}, { executor: tx });
  }

  async #link(tx: Transaction): Promise<string | null> {
    const base = await this.#settings.get(instanceUrlSetting, {}, { executor: tx });
    return base ? `${base.replace(/\/+$/, "")}/settings/instance/storage` : null;
  }

  async #announce(tx: Transaction, announcement: Announcement): Promise<string[]> {
    const { reading } = announcement;
    const ids: string[] = [];
    const recipients = await instanceAdministratorIds(tx);
    const reached = announcement.change !== "cleared";
    const result = reached
      ? await this.#notifications.notify(tx, {
          type: "storage.levelReached",
          recipients,
          organizationId: null,
          targetId: uuidv7(),
          params: {
            level: announcement.level,
            percent: reading.percent,
            usedBytes: reading.usedBytes,
            totalBytes: reading.totalBytes,
            store: reading.store,
            reminder: announcement.change === "reminder",
          },
        })
      : await this.#notifications.notify(tx, {
          type: "storage.levelCleared",
          recipients,
          organizationId: null,
          targetId: uuidv7(),
          params: { level: announcement.level, percent: reading.percent, store: reading.store },
        });
    ids.push(...result.mailIds);
    const addresses = await this.#settings.get(storageOperationsEmailsSetting, {}, { executor: tx });
    if (addresses.length === 0) return ids;
    const language = await this.#language(tx);
    const link = await this.#link(tx);
    for (const address of addresses) {
      ids.push(
        reached
          ? await this.#mail.queue(tx, {
              to: address,
              template: "storageLevelReached",
              language,
              operations: true,
              params: {
                level: announcement.level as 1 | 2 | 3,
                percent: formatPercent(reading.percent),
                used: formatBytes(reading.usedBytes),
                total: formatBytes(reading.totalBytes),
                store: reading.store,
                reminder: announcement.change === "reminder",
                link,
              },
            })
          : await this.#mail.queue(tx, {
              to: address,
              template: "storageLevelCleared",
              language,
              operations: true,
              params: {
                level: announcement.level as 0 | 1 | 2,
                percent: formatPercent(reading.percent),
                store: reading.store,
                link,
              },
            }),
      );
    }
    return ids;
  }

  async #teamsWebhook(executor: Pick<Database, "select">): Promise<string | null> {
    const [row] = await executor
      .select({ value: instanceSecrets.value })
      .from(instanceSecrets)
      .where(eq(instanceSecrets.name, TEAMS_SECRET));
    return row ? this.#encryption.decryptString(row.value, secretContext()) : null;
  }

  async #teamsMessage(announcement: Announcement | null): Promise<ChatMessage> {
    const instanceName = await this.#settings.get(instanceNameSetting, {});
    const language = await this.#settings.get(languageSetting, {});
    const base = await this.#settings.get(instanceUrlSetting, {});
    const link = base ? `${base.replace(/\/+$/, "")}/settings/instance/storage` : null;
    const content = announcement
      ? announcement.change === "cleared"
        ? storageCleared(language, {
            instanceName,
            level: announcement.level as 0 | 1 | 2,
            percent: formatPercent(announcement.reading.percent),
            store: announcement.reading.store,
            link,
          })
        : storageReached(language, {
            instanceName,
            level: announcement.level as 1 | 2 | 3,
            percent: formatPercent(announcement.reading.percent),
            used: formatBytes(announcement.reading.usedBytes),
            total: formatBytes(announcement.reading.totalBytes),
            store: announcement.reading.store,
            reminder: announcement.change === "reminder",
            link,
          })
      : storageTest(language, { instanceName, link });
    return {
      event: "storage",
      heading: instanceName,
      title: content.subject,
      detail: content.paragraphs.join("\n"),
      link: content.action ? { url: content.action.url, label: content.action.label } : null,
      occurredAt: this.#clock(),
      space: null,
      organizationId: null,
      item: null,
      actor: null,
    };
  }

  async #postTeams(announcement: Announcement | null): Promise<ChatTestResult | null> {
    const url = await this.#teamsWebhook(this.#database);
    if (!url) return null;
    try {
      const result = await this.#chat.postWebhook("teams", url, await this.#teamsMessage(announcement));
      if (!result.delivered) {
        this.#logger.warn(
          { reason: result.failure.reason, status: result.failure.status },
          "Posting the storage warning to Teams failed",
        );
      }
      return result;
    } catch (error) {
      this.#logger.warn({ err: error }, "Posting the storage warning to Teams failed");
      return null;
    }
  }

  async sendTest(): Promise<{ addresses: number; teams: ChatTestResult | null }> {
    const addresses = await this.#settings.get(storageOperationsEmailsSetting, {});
    const mailIds: string[] = [];
    if (addresses.length > 0) {
      await this.#database.transaction(async (tx) => {
        const language = await this.#language(tx);
        const link = await this.#link(tx);
        for (const address of addresses) {
          mailIds.push(
            await this.#mail.queue(tx, {
              to: address,
              template: "storageTest",
              language,
              operations: true,
              params: { link },
            }),
          );
        }
      });
      await this.#notifications.dispatch(mailIds);
    }
    return { addresses: addresses.length, teams: await this.#postTeams(null) };
  }

  async configure(actor: Principal, input: StorageConfigurationInput): Promise<StorageStatus> {
    const current = await this.thresholds();
    const next: StorageThresholds = {
      warning: input.thresholds?.warning ?? current.warning,
      largeWrites: input.thresholds?.largeWrites ?? current.largeWrites,
      critical: input.thresholds?.critical ?? current.critical,
    };
    const parsed = z
      .object({
        warning: z.number().int().min(1).max(100),
        largeWrites: z.number().int().min(1).max(100),
        critical: z.number().int().min(1).max(100),
      })
      .safeParse(next);
    if (!parsed.success || !(next.warning < next.largeWrites && next.largeWrites < next.critical)) {
      throw new StorageSettingsError(
        "invalidThresholds",
        "The warning level must be below the level that blocks large writes, which must be below the critical level. Use whole percentages from 1 to 100.",
        ["thresholds"],
      );
    }
    if (input.s3LimitBytes !== undefined && input.s3LimitBytes !== null) {
      if (!Number.isSafeInteger(input.s3LimitBytes) || input.s3LimitBytes < 1) {
        throw new StorageSettingsError("invalidS3Limit", "The storage limit must be a positive size.", [
          "s3LimitBytes",
        ]);
      }
    }
    let addresses: string[] | undefined;
    if (input.operationsEmails !== undefined) {
      addresses = [...new Set(input.operationsEmails.map((address) => address.trim().toLowerCase()))];
      const valid =
        addresses.length <= MAX_OPERATIONS_ADDRESSES &&
        addresses.every((a) => emailSchema.safeParse(a).success);
      if (!valid) {
        throw new StorageSettingsError(
          "invalidContacts",
          `Enter up to ${MAX_OPERATIONS_ADDRESSES} valid e-mail addresses, one per line.`,
          ["operationsEmails"],
        );
      }
    }
    let webhook: string | null | undefined;
    if (typeof input.teamsWebhook === "string") {
      try {
        webhook = await this.#chat.checkWebhookAddress("teams", input.teamsWebhook.trim());
      } catch (error) {
        if (error instanceof ChatChannelError) {
          throw new StorageSettingsError("invalidTeamsWebhook", error.message, ["teamsWebhook"]);
        }
        throw error;
      }
    } else if (input.teamsWebhook === null) {
      webhook = null;
    }
    await this.#database.transaction(async (tx) => {
      if (input.thresholds) {
        await this.#settings.set(storageWarningPercentSetting, {}, "instance", next.warning, { tx });
        await this.#settings.set(storageLargeWritesPercentSetting, {}, "instance", next.largeWrites, { tx });
        await this.#settings.set(storageCriticalPercentSetting, {}, "instance", next.critical, { tx });
      }
      if (input.s3LimitBytes !== undefined) {
        await this.#settings.set(storageS3LimitSetting, {}, "instance", input.s3LimitBytes, { tx });
      }
      if (input.reminder !== undefined) {
        await this.#settings.set(storageReminderSetting, {}, "instance", input.reminder, { tx });
      }
      if (addresses !== undefined) {
        await this.#settings.set(storageOperationsEmailsSetting, {}, "instance", addresses, { tx });
      }
      if (webhook !== undefined) {
        if (webhook === null) {
          await tx.delete(instanceSecrets).where(eq(instanceSecrets.name, TEAMS_SECRET));
        } else {
          const value = this.#encryption.encrypt(webhook, secretContext());
          await tx
            .insert(instanceSecrets)
            .values({ name: TEAMS_SECRET, value })
            .onConflictDoUpdate({ target: instanceSecrets.name, set: { value, updatedAt: new Date() } });
        }
      }
      if (addresses !== undefined || webhook !== undefined) {
        await this.#audit.record(tx, {
          name: "storage.contactsChanged",
          actor,
          targetId: null,
          fields: {
            addresses: (
              addresses ?? (await this.#settings.get(storageOperationsEmailsSetting, {}, { executor: tx }))
            ).length,
            teamsWebhook: webhook === undefined ? "unchanged" : webhook === null ? "removed" : "set",
          },
        });
      }
    });
    return this.status();
  }
}
