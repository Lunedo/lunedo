import type { NotificationListener } from "../database/notifications.js";
import { notify } from "../database/notifications.js";
import type { DatabasePool } from "../database/pool.js";
import type { Logger } from "../logging/logger.js";
import type { KeyProvider } from "./key-provider.js";
import { type KeyRing, KeyRingError } from "./key-ring.js";

export const KEY_RING_CHANNEL = "pagehall_key_ring";

/**
 * Holds the loaded key ring of this process. All nodes reload it when a new key version
 * is announced, so that every node encrypts with the same current version.
 */
export class KeyRingHolder {
  readonly #provider: KeyProvider;
  readonly #logger: Logger;
  #ring: KeyRing | undefined;

  constructor(provider: KeyProvider, logger: Logger) {
    this.#provider = provider;
    this.#logger = logger;
  }

  get provider(): KeyProvider {
    return this.#provider;
  }

  get ring(): KeyRing {
    if (!this.#ring) throw new KeyRingError("The master key ring is not loaded");
    return this.#ring;
  }

  get loaded(): boolean {
    return this.#ring !== undefined;
  }

  async reload(): Promise<KeyRing> {
    this.#ring = await this.#provider.load();
    return this.#ring;
  }

  /** Reloads on announcements from other nodes and after a lost notification connection. */
  async subscribe(listener: NotificationListener): Promise<void> {
    const reload = () => {
      this.reload().then(
        (ring) => this.#logger.info({ currentVersion: ring.currentVersion }, "Master key ring reloaded"),
        (error: unknown) => this.#logger.error({ err: error }, "Reloading the master key ring failed"),
      );
    };
    await listener.listen(KEY_RING_CHANNEL, reload);
    listener.onReconnect(reload);
  }

  async announce(pool: Pick<DatabasePool, "query">): Promise<void> {
    await notify(pool, KEY_RING_CHANNEL, String(this.ring.currentVersion));
  }
}
