import {
  ANNOUNCEMENT_CHANGES_CHANNEL,
  type AnnouncementChangeSignal,
  parseAnnouncementChangeSignal,
} from "../announcements/announcements.js";
import { AUDIT_CHANGES_CHANNEL, type AuditChangeSignal, parseAuditChangeSignal } from "../audit/audit-log.js";
import type { NotificationListener } from "../database/notifications.js";
import { parseSyncRunSignal, SYNC_RUNS_CHANNEL, type SyncRunSignal } from "../identity/sync-signals.js";
import {
  IMPORT_CHANGES_CHANNEL,
  type ImportChangeSignal,
  parseImportChangeSignal,
} from "../imports/signals.js";
import { MAINTENANCE_CHANNEL } from "../operations/maintenance.js";
import {
  parseSettingChangeSignal,
  SETTING_CHANGES_CHANNEL,
  type SettingChangeSignal,
} from "../settings/service.js";
import { parseSpaceChangeSignal, SPACE_CHANGES_CHANNEL, type SpaceChangeSignal } from "../spaces/signals.js";
import { NOTIFICATIONS_CHANNEL } from "./service.js";

type Handler = () => void;
type SettingsHandler = (signal: SettingChangeSignal) => void;
type SyncRunHandler = (signal: SyncRunSignal) => void;
type ChangeHandler = (signal: AuditChangeSignal) => void;
type SpaceHandler = (signal: SpaceChangeSignal) => void;
type ImportHandler = (signal: ImportChangeSignal) => void;
type AnnouncementHandler = (signal: AnnouncementChangeSignal) => void;

export class NotificationHub {
  readonly #listener: NotificationListener;
  readonly #handlers = new Map<string, Set<Handler>>();
  readonly #settingsHandlers = new Set<SettingsHandler>();
  readonly #syncRunHandlers = new Set<SyncRunHandler>();
  readonly #changeHandlers = new Set<ChangeHandler>();
  readonly #spaceHandlers = new Set<SpaceHandler>();
  readonly #importHandlers = new Set<ImportHandler>();
  readonly #announcementHandlers = new Set<AnnouncementHandler>();
  readonly #maintenanceHandlers = new Set<Handler>();
  #listening: Promise<void> | undefined;

  constructor(listener: NotificationListener) {
    this.#listener = listener;
  }

  async #ready(): Promise<void> {
    this.#listening ??= this.#listen().catch((error: unknown) => {
      this.#listening = undefined;
      throw error;
    });
    await this.#listening;
  }

  async subscribeSettings(handler: SettingsHandler): Promise<() => void> {
    await this.#ready();
    this.#settingsHandlers.add(handler);
    return () => {
      this.#settingsHandlers.delete(handler);
    };
  }

  async subscribeSyncRuns(handler: SyncRunHandler): Promise<() => void> {
    await this.#ready();
    this.#syncRunHandlers.add(handler);
    return () => {
      this.#syncRunHandlers.delete(handler);
    };
  }

  async subscribeChanges(handler: ChangeHandler): Promise<() => void> {
    await this.#ready();
    this.#changeHandlers.add(handler);
    return () => {
      this.#changeHandlers.delete(handler);
    };
  }

  async subscribeSpaces(handler: SpaceHandler): Promise<() => void> {
    await this.#ready();
    this.#spaceHandlers.add(handler);
    return () => {
      this.#spaceHandlers.delete(handler);
    };
  }

  async subscribeImports(handler: ImportHandler): Promise<() => void> {
    await this.#ready();
    this.#importHandlers.add(handler);
    return () => {
      this.#importHandlers.delete(handler);
    };
  }

  async subscribeAnnouncements(handler: AnnouncementHandler): Promise<() => void> {
    await this.#ready();
    this.#announcementHandlers.add(handler);
    return () => {
      this.#announcementHandlers.delete(handler);
    };
  }

  async subscribeMaintenance(handler: Handler): Promise<() => void> {
    await this.#ready();
    this.#maintenanceHandlers.add(handler);
    return () => {
      this.#maintenanceHandlers.delete(handler);
    };
  }

  async subscribe(accountId: string, handler: Handler): Promise<() => void> {
    await this.#ready();
    let handlers = this.#handlers.get(accountId);
    if (!handlers) {
      handlers = new Set();
      this.#handlers.set(accountId, handlers);
    }
    handlers.add(handler);
    return () => {
      const current = this.#handlers.get(accountId);
      current?.delete(handler);
      if (current?.size === 0) this.#handlers.delete(accountId);
    };
  }

  get subscriptions(): number {
    let count = 0;
    for (const handlers of this.#handlers.values()) count += handlers.size;
    return count;
  }

  async #listen(): Promise<void> {
    await this.#listener.listen(NOTIFICATIONS_CHANNEL, (accountId) => {
      for (const handler of this.#handlers.get(accountId) ?? []) handler();
    });
    await this.#listener.listen(SETTING_CHANGES_CHANNEL, (payload) => {
      const signal = parseSettingChangeSignal(payload);
      if (!signal) return;
      for (const handler of this.#settingsHandlers) handler(signal);
    });
    await this.#listener.listen(SYNC_RUNS_CHANNEL, (payload) => {
      const signal = parseSyncRunSignal(payload);
      if (!signal) return;
      for (const handler of this.#syncRunHandlers) handler(signal);
    });
    await this.#listener.listen(AUDIT_CHANGES_CHANNEL, (payload) => {
      const signal = parseAuditChangeSignal(payload);
      if (!signal) return;
      for (const handler of this.#changeHandlers) handler(signal);
    });
    await this.#listener.listen(SPACE_CHANGES_CHANNEL, (payload) => {
      const signal = parseSpaceChangeSignal(payload);
      if (!signal) return;
      for (const handler of this.#spaceHandlers) handler(signal);
    });
    await this.#listener.listen(IMPORT_CHANGES_CHANNEL, (payload) => {
      const signal = parseImportChangeSignal(payload);
      if (!signal) return;
      for (const handler of this.#importHandlers) handler(signal);
    });
    await this.#listener.listen(ANNOUNCEMENT_CHANGES_CHANNEL, (payload) => {
      const signal = parseAnnouncementChangeSignal(payload);
      if (!signal) return;
      for (const handler of this.#announcementHandlers) handler(signal);
    });
    await this.#listener.listen(MAINTENANCE_CHANNEL, () => {
      for (const handler of this.#maintenanceHandlers) handler();
    });
    this.#listener.onReconnect(() => {
      for (const handlers of this.#handlers.values()) for (const handler of handlers) handler();
      for (const handler of this.#maintenanceHandlers) handler();
    });
  }
}
