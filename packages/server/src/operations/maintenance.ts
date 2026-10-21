import { sql } from "drizzle-orm";
import type { Principal } from "../accounts/principal.js";
import type { AuditLog } from "../audit/audit-log.js";
import type { Database, Executor } from "../database/database.js";
import type { NotificationListener } from "../database/notifications.js";

export const MAINTENANCE_CHANNEL = "pagehall_maintenance";
export const MAINTENANCE_MESSAGE_MAX_LENGTH = 500;
const MINUTE_MS = 60_000;

export interface MaintenanceStatus {
  enabled: boolean;
  message: string;
  blockSignIn: boolean;
  startedAt: Date | null;
  changedAt: Date | null;
  changedBy: string | null;
}

export interface MaintenanceInput {
  enabled: boolean;
  message?: string | undefined;
  blockSignIn?: boolean | undefined;
}

export const MAINTENANCE_OFF: MaintenanceStatus = {
  enabled: false,
  message: "",
  blockSignIn: false,
  startedAt: null,
  changedAt: null,
  changedBy: null,
};

export class MaintenanceInputError extends Error {
  override name = "MaintenanceInputError";
}

export class MaintenanceModeError extends Error {
  override name = "MaintenanceModeError";

  constructor(readonly status: MaintenanceStatus) {
    super("The instance is in maintenance mode and does not accept changes");
  }
}

export class SignInBlockedError extends Error {
  override name = "SignInBlockedError";

  constructor(readonly status: MaintenanceStatus) {
    super("Signing in is paused during maintenance for everyone except instance administrators");
  }
}

type Row = {
  enabled: boolean;
  message: string;
  block_sign_in: boolean;
  started_at: Date | string | null;
  changed_at: Date | string | null;
  changed_by: string | null;
};

function statusOf(row: Row | undefined): MaintenanceStatus {
  if (!row) return MAINTENANCE_OFF;
  return {
    enabled: row.enabled,
    message: row.message,
    blockSignIn: row.enabled && row.block_sign_in,
    startedAt: row.started_at ? new Date(row.started_at) : null,
    changedAt: row.changed_at ? new Date(row.changed_at) : null,
    changedBy: row.changed_by,
  };
}

export function normalizeMaintenanceMessage(value: string | undefined): string {
  const message = (value ?? "").replace(/\s+/g, " ").trim();
  if (message.length > MAINTENANCE_MESSAGE_MAX_LENGTH) {
    throw new MaintenanceInputError(
      `The message has ${message.length} characters; shorten it to at most ${MAINTENANCE_MESSAGE_MAX_LENGTH}`,
    );
  }
  return message;
}

export class MaintenanceService {
  readonly #database: Database;
  readonly #audit: AuditLog;
  #cached: Promise<MaintenanceStatus> | null = null;
  #caching = false;
  #listeners: ((status: MaintenanceStatus) => void)[] = [];

  constructor(options: { database: Database; audit: AuditLog }) {
    this.#database = options.database;
    this.#audit = options.audit;
  }

  async enableCache(listener: NotificationListener): Promise<void> {
    const refresh = () => {
      this.#cached = null;
      if (this.#listeners.length === 0) return;
      this.status().then(
        (status) => {
          for (const notify of this.#listeners) notify(status);
        },
        () => {},
      );
    };
    await listener.listen(MAINTENANCE_CHANNEL, refresh);
    listener.onReconnect(refresh);
    this.#caching = true;
  }

  onChange(listener: (status: MaintenanceStatus) => void): void {
    this.#listeners.push(listener);
  }

  status(executor: Executor = this.#database): Promise<MaintenanceStatus> {
    if (!this.#caching || executor !== this.#database) return this.#read(executor);
    if (!this.#cached) {
      const loading = this.#read(executor);
      this.#cached = loading;
      loading.catch(() => {
        if (this.#cached === loading) this.#cached = null;
      });
    }
    return this.#cached;
  }

  async #read(executor: Executor): Promise<MaintenanceStatus> {
    const result = await executor.execute<Row>(sql`
      select enabled, message, block_sign_in, started_at, changed_at, changed_by
      from maintenance_state where singleton
    `);
    return statusOf(result.rows[0]);
  }

  async set(actor: Principal, input: MaintenanceInput): Promise<MaintenanceStatus> {
    const message = normalizeMaintenanceMessage(input.message);
    const blockSignIn = input.enabled && (input.blockSignIn ?? false);
    const changedBy = actor.type === "account" ? actor.id : null;
    const status = await this.#database.transaction(async (tx) => {
      await tx.execute(sql`insert into maintenance_state (singleton) values (true) on conflict do nothing`);
      const before = statusOf(
        (
          await tx.execute<Row>(sql`
            select enabled, message, block_sign_in, started_at, changed_at, changed_by
            from maintenance_state where singleton for update
          `)
        ).rows[0],
      );
      if (!input.enabled && !before.enabled) return before;
      const unchanged =
        input.enabled && before.enabled && before.message === message && before.blockSignIn === blockSignIn;
      if (unchanged) return before;
      const now = new Date();
      const updated = await tx.execute<Row>(sql`
        update maintenance_state set
          enabled = ${input.enabled},
          message = ${input.enabled ? message : ""},
          block_sign_in = ${blockSignIn},
          started_at = ${input.enabled ? (before.startedAt ?? now) : null},
          changed_at = ${now},
          changed_by = ${changedBy}
        where singleton
        returning enabled, message, block_sign_in, started_at, changed_at, changed_by
      `);
      if (!input.enabled) {
        const minutes = before.startedAt
          ? Math.round((now.getTime() - before.startedAt.getTime()) / MINUTE_MS)
          : 0;
        await this.#audit.record(tx, {
          name: "maintenance.ended",
          actor,
          targetId: null,
          fields: { minutes: Math.max(0, minutes) },
        });
      } else {
        await this.#audit.record(tx, {
          name: before.enabled ? "maintenance.changed" : "maintenance.started",
          actor,
          targetId: null,
          fields: { message, blockSignIn },
        });
      }
      await tx.execute(sql`select pg_notify(${MAINTENANCE_CHANNEL}, '')`);
      return statusOf(updated.rows[0]);
    });
    this.#cached = null;
    return status;
  }

  async requireWritable(): Promise<void> {
    const status = await this.status();
    if (status.enabled) throw new MaintenanceModeError(status);
  }
}
