import type { Readable } from "node:stream";

export interface MarkupBudget {
  elements: number;
  attributes: number;
}

const ATTRIBUTE_VALUE = /=[ \t\r\n]*["']/g;

export function takeMarkup(input: string, budget: MarkupBudget): boolean {
  for (let index = input.indexOf("<"); index !== -1; index = input.indexOf("<", index + 1)) {
    budget.elements -= 1;
    if (budget.elements < 0) return false;
  }
  ATTRIBUTE_VALUE.lastIndex = 0;
  while (ATTRIBUTE_VALUE.exec(input) !== null) {
    budget.attributes -= 1;
    if (budget.attributes < 0) return false;
  }
  return true;
}

export class SanitizerBusyError extends Error {
  override name = "SanitizerBusyError";
  readonly retryAfterSeconds = 2;

  constructor() {
    super("Too many drawings and diagrams are being checked at the moment; try again in a few seconds");
  }
}

export const MAX_PARALLEL_SANITIZATIONS = 4;

export class SanitizerSlots {
  readonly #limit: number;
  #running = 0;

  constructor(limit: number) {
    this.#limit = limit;
  }

  async run<T>(work: () => Promise<T> | T, unread?: Readable): Promise<T> {
    if (this.#running >= this.#limit) {
      unread?.resume();
      throw new SanitizerBusyError();
    }
    this.#running += 1;
    try {
      return await work();
    } finally {
      this.#running -= 1;
    }
  }
}

export const sanitizerSlots = new SanitizerSlots(MAX_PARALLEL_SANITIZATIONS);
