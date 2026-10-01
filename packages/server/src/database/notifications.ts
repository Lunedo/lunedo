import pg from "pg";
import type { Logger } from "../logging/logger.js";
import type { DatabasePool } from "./pool.js";

type Handler = (payload: string) => void;

const RECONNECT_DELAY_MS = 1000;

/**
 * Receives PostgreSQL notifications on a dedicated connection and reconnects when it
 * drops. Notifications sent while disconnected are lost, so `onReconnect` handlers must
 * assume anything may have changed, e.g. by clearing their caches.
 */
export class NotificationListener {
  readonly #connectionString: string;
  readonly #logger: Logger;
  readonly #handlers = new Map<string, Set<Handler>>();
  readonly #reconnectHandlers = new Set<() => void>();
  #client: pg.Client | undefined;
  #closed = false;
  #connecting: Promise<void> | undefined;

  constructor(options: { connectionString: string; logger: Logger }) {
    this.#connectionString = options.connectionString;
    this.#logger = options.logger;
  }

  async listen(channel: string, handler: Handler): Promise<void> {
    if (!/^[a-z_][a-z0-9_]*$/.test(channel)) throw new Error(`Invalid channel name ${channel}`);
    let handlers = this.#handlers.get(channel);
    if (!handlers) {
      handlers = new Set();
      this.#handlers.set(channel, handlers);
      await this.#connect();
      await this.#client?.query(`listen ${channel}`);
    }
    handlers.add(handler);
  }

  onReconnect(handler: () => void): void {
    this.#reconnectHandlers.add(handler);
  }

  async #connect(): Promise<void> {
    if (this.#client || this.#closed) return;
    this.#connecting ??= (async () => {
      const client = new pg.Client({
        connectionString: this.#connectionString,
        application_name: "pagehall-notifications",
      });
      client.on("notification", (message) => {
        for (const handler of this.#handlers.get(message.channel) ?? []) handler(message.payload ?? "");
      });
      client.on("error", (error) => {
        this.#logger.warn({ err: error }, "Notification connection lost");
        this.#drop(client);
      });
      client.on("end", () => this.#drop(client));
      await client.connect();
      for (const channel of this.#handlers.keys()) await client.query(`listen ${channel}`);
      this.#client = client;
    })().finally(() => {
      this.#connecting = undefined;
    });
    await this.#connecting;
  }

  #drop(client: pg.Client) {
    if (this.#client !== client) return;
    this.#client = undefined;
    client.end().catch(() => {});
    if (this.#closed) return;
    const retry = () => {
      if (this.#closed) return;
      this.#connect().then(
        () => {
          for (const handler of this.#reconnectHandlers) handler();
        },
        (error: unknown) => {
          this.#logger.warn({ err: error }, "Reconnecting notifications failed");
          setTimeout(retry, RECONNECT_DELAY_MS).unref();
        },
      );
    };
    setTimeout(retry, RECONNECT_DELAY_MS).unref();
  }

  async close(): Promise<void> {
    this.#closed = true;
    const client = this.#client;
    this.#client = undefined;
    await client?.end();
  }
}

/** Sends a notification; inside a transaction it is delivered on commit. */
export async function notify(
  executor: Pick<DatabasePool, "query">,
  channel: string,
  payload: string,
): Promise<void> {
  await executor.query("select pg_notify($1, $2)", [channel, payload]);
}
