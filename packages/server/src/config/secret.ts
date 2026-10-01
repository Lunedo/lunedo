import { inspect } from "node:util";

const REDACTED = "[redacted]";

/**
 * Holds a secret value. The value is only available through `reveal()`, so that
 * logging, serializing or inspecting a configuration object never exposes it.
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return REDACTED;
  }
}
