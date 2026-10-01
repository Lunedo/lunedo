import type { NotificationListener } from "../database/notifications.js";
import { NOTIFICATIONS_CHANNEL } from "./service.js";

type Handler = () => void;

export class NotificationHub {
  readonly #listener: NotificationListener;
  readonly #handlers = new Map<string, Set<Handler>>();
  #listening: Promise<void> | undefined;

  constructor(listener: NotificationListener) {
    this.#listener = listener;
  }

  async subscribe(accountId: string, handler: Handler): Promise<() => void> {
    this.#listening ??= this.#listen().catch((error: unknown) => {
      this.#listening = undefined;
      throw error;
    });
    await this.#listening;
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
    this.#listener.onReconnect(() => {
      for (const handlers of this.#handlers.values()) for (const handler of handlers) handler();
    });
  }
}
