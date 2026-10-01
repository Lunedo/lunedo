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
