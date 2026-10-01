import type { NotificationListener } from "../database/notifications.js";
import {
  parseSettingChangeSignal,
  SETTING_CHANGES_CHANNEL,
  type SettingChangeSignal,
} from "../settings/service.js";
import { NOTIFICATIONS_CHANNEL } from "./service.js";

type Handler = () => void;
type SettingsHandler = (signal: SettingChangeSignal) => void;

export class NotificationHub {
  readonly #listener: NotificationListener;
  readonly #handlers = new Map<string, Set<Handler>>();
  readonly #settingsHandlers = new Set<SettingsHandler>();
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
    this.#listener.onReconnect(() => {
      for (const handlers of this.#handlers.values()) for (const handler of handlers) handler();
    });
  }
}
