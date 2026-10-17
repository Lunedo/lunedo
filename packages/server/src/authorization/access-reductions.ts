import type { Transaction } from "../database/database.js";

export interface AccessReduction {
  readonly organizationId: string | null;
  readonly accountId: string | null;
}

type Listener = (tx: Transaction, reduction: AccessReduction) => Promise<void>;

export class AccessReductions {
  readonly #listeners: Listener[] = [];

  on(listener: Listener): void {
    this.#listeners.push(listener);
  }

  async reduced(tx: Transaction, reduction: AccessReduction): Promise<void> {
    for (const listener of this.#listeners) await listener(tx, reduction);
  }
}
