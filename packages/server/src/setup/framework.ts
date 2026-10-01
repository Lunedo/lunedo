import type { z } from "zod";
import type { Transaction } from "../database/database.js";

export interface SetupActionResult {
  body?: unknown;
  download?: { filename: string; contentType: string; content: string };
}

export interface SetupActionContext {
  tx: Transaction;
  complete(): Promise<void>;
  reopen(): Promise<void>;
  state: Record<string, unknown>;
  setState(state: Record<string, unknown>): Promise<void>;
  request: { protocol: string; host: string | undefined };
}

export interface SetupAction<TInput> {
  input: z.ZodType<TInput>;
  run(context: SetupActionContext, input: TInput): Promise<SetupActionResult>;
}

export interface SetupStep {
  id: string;
  order: number;
  required: boolean;
  describe(context: {
    request: SetupActionContext["request"];
    state: Record<string, unknown>;
  }): Promise<unknown>;
  actions: Record<string, SetupAction<unknown>>;
}

export function defineSetupAction<TInput>(action: SetupAction<TInput>): SetupAction<TInput> {
  return action;
}

export class SetupRegistry {
  readonly #steps = new Map<string, SetupStep>();

  register(...steps: SetupStep[]): this {
    for (const step of steps) {
      if (!/^[a-z][a-zA-Z]*$/.test(step.id)) throw new Error(`Setup step ID ${step.id} must be camelCase`);
      if (this.#steps.has(step.id)) throw new Error(`Setup step ${step.id} is registered twice`);
      for (const action of Object.keys(step.actions)) {
        if (!/^[a-z][a-zA-Z]*$/.test(action))
          throw new Error(`Setup action ${step.id}.${action} must be camelCase`);
      }
      this.#steps.set(step.id, step);
    }
    return this;
  }

  get(id: string): SetupStep | undefined {
    return this.#steps.get(id);
  }

  all(): SetupStep[] {
    return [...this.#steps.values()].sort((a, b) => a.order - b.order);
  }
}
