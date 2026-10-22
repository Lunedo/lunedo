import type { NotificationHub, SpaceChangeSignal } from "@lunedo/server";

export const SPACE_AUDIENCE_MS = 10_000;
export const COALESCE_MS = 1500;

type Deliver = (signal: SpaceChangeSignal) => void;
type LoadAudience = (accountIds: string[], spaceId: string) => Promise<Set<string>>;

interface Listener {
  accountId: string;
  deliver: Deliver;
}

interface Audience {
  loading: Promise<{ accounts: ReadonlySet<string>; members: ReadonlySet<string> }>;
  at: number;
}

interface Burst {
  pending: SpaceChangeSignal | null;
  timer: NodeJS.Timeout;
}

export class SpaceSignals {
  readonly #hub: NotificationHub;
  readonly #loadAudience: LoadAudience;
  readonly #listeners = new Set<Listener>();
  readonly #audiences = new Map<string, Audience>();
  readonly #bursts = new Map<string, Burst>();
  #subscribed: Promise<void> | undefined;

  constructor(hub: NotificationHub, loadAudience: LoadAudience) {
    this.#hub = hub;
    this.#loadAudience = loadAudience;
  }

  async join(accountId: string, deliver: Deliver): Promise<() => void> {
    this.#subscribed ??= this.#subscribe().catch((error: unknown) => {
      this.#subscribed = undefined;
      throw error;
    });
    await this.#subscribed;
    const listener = { accountId, deliver };
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async reaches(spaceId: string, accountId: string): Promise<boolean> {
    const current = this.#audiences.get(spaceId);
    if (current && Date.now() - current.at < SPACE_AUDIENCE_MS) {
      const audience = await current.loading;
      if (audience.accounts.has(accountId)) return audience.members.has(accountId);
      if (this.#audiences.get(spaceId) === current) this.#audiences.delete(spaceId);
    } else if (current && this.#audiences.get(spaceId) === current) {
      this.#audiences.delete(spaceId);
    }
    const audience = await this.#load(spaceId);
    return audience.members.has(accountId);
  }

  #load(spaceId: string): Audience["loading"] {
    const existing = this.#audiences.get(spaceId);
    if (existing) return existing.loading;
    const now = Date.now();
    for (const [id, audience] of this.#audiences) {
      if (now - audience.at >= SPACE_AUDIENCE_MS) this.#audiences.delete(id);
    }
    const accounts = new Set([...this.#listeners].map((listener) => listener.accountId));
    const entry: Audience = {
      loading: this.#loadAudience([...accounts], spaceId).then((members) => ({ accounts, members })),
      at: now,
    };
    this.#audiences.set(spaceId, entry);
    entry.loading.catch(() => {
      if (this.#audiences.get(spaceId) === entry) this.#audiences.delete(spaceId);
    });
    return entry.loading;
  }

  async #subscribe(): Promise<void> {
    await this.#hub.subscribeChanges(() => this.#audiences.clear());
    await this.#hub.subscribeSpaces((signal) => this.#receive(signal));
  }

  #receive(signal: SpaceChangeSignal): void {
    if (signal.kind === "access") this.#audiences.delete(signal.spaceId);
    if ((signal.kind !== "page" && signal.kind !== "draft") || !signal.itemId) {
      this.#deliver(signal);
      return;
    }
    const key = `${signal.kind}:${signal.itemId}`;
    const burst = this.#bursts.get(key);
    if (burst) {
      burst.pending = signal;
      return;
    }
    this.#deliver(signal);
    this.#bursts.set(key, { pending: null, timer: this.#flushLater(key) });
  }

  #flushLater(key: string): NodeJS.Timeout {
    const timer = setTimeout(() => {
      const burst = this.#bursts.get(key);
      if (!burst?.pending) {
        this.#bursts.delete(key);
        return;
      }
      const signal = burst.pending;
      burst.pending = null;
      burst.timer = this.#flushLater(key);
      this.#deliver(signal);
    }, COALESCE_MS);
    timer.unref();
    return timer;
  }

  #deliver(signal: SpaceChangeSignal): void {
    for (const listener of this.#listeners) listener.deliver(signal);
  }
}
