import type { Readable } from "node:stream";
import type { Principal } from "../accounts/principal.js";

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
export const MAX_PARALLEL_SANITIZATIONS_PER_ACCOUNT = 1;

export class SanitizerSlots {
  readonly #limit: number;
  readonly #perOwner: number;
  readonly #owners = new Map<string, number>();
  #running = 0;

  constructor(limit: number, perOwner: number) {
    this.#limit = limit;
    this.#perOwner = perOwner;
  }

  async run<T>(owner: Principal, work: () => Promise<T> | T, unread?: Readable): Promise<T> {
    const key = owner.type === "account" ? owner.id : owner.type;
    const held = this.#owners.get(key) ?? 0;
    if (this.#running >= this.#limit || held >= this.#perOwner) {
      unread?.resume();
      throw new SanitizerBusyError();
    }
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

export const sanitizerSlots = new SanitizerSlots(
  MAX_PARALLEL_SANITIZATIONS,
  MAX_PARALLEL_SANITIZATIONS_PER_ACCOUNT,
);

export function attributeWarning(level: string, message: string): boolean {
  return level === "warning" && /attribute/i.test(message);
}
