import type { Principal } from "../accounts/principal.js";

export class BusyError extends Error {
  override name = "BusyError";

  constructor() {
    super("Too many operations are waiting; try again later");
  }
}

export class ConcurrencyLimiter {
  readonly #limit: number;
  readonly #maxQueued: number;
  readonly #queue: (() => void)[] = [];
  #running = 0;

  constructor(options: { limit: number; maxQueued: number }) {
    this.#limit = options.limit;
    this.#maxQueued = options.maxQueued;
  }

  get running(): number {
    return this.#running;
  }

  get queued(): number {
    return this.#queue.length;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.#running >= this.#limit) {
      if (this.#queue.length >= this.#maxQueued) throw new BusyError();
      await new Promise<void>((resolve) => this.#queue.push(resolve));
    } else {
      this.#running += 1;
    }
    try {
      return await task();
    } finally {
      const next = this.#queue.shift();
      if (next) next();
      else this.#running -= 1;
    }
  }
}

export class OwnerSlots {
  readonly #limit: number;
  readonly #perOwner: number;
  readonly #busy: () => Error;
  readonly #owners = new Map<string, number>();
  #running = 0;

  constructor(limit: number, perOwner: number, busy: () => Error) {
    this.#limit = limit;
    this.#perOwner = perOwner;
    this.#busy = busy;
  }

  async run<T>(owner: Principal, work: () => Promise<T> | T): Promise<T> {
    const key = owner.type === "account" ? owner.id : owner.type;
    const held = this.#owners.get(key) ?? 0;
    if (this.#running >= this.#limit || held >= this.#perOwner) throw this.#busy();
    this.#running += 1;
    this.#owners.set(key, held + 1);
    try {
      return await work();
    } finally {
      this.#running -= 1;
      const left = (this.#owners.get(key) ?? 1) - 1;
      if (left > 0) this.#owners.set(key, left);
      else this.#owners.delete(key);
    }
  }
}
