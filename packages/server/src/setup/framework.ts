import type { z } from "zod";
import type { Transaction } from "../database/database.js";

/** What a setup action returns to the assistant. */
export interface SetupActionResult {
  /** JSON for the assistant. Secrets appear only where the step must show them once, like recovery codes. */
  body?: unknown;
  /** A file to download instead of JSON. */
  download?: { filename: string; contentType: string; content: string };
}

export interface SetupActionContext {
  tx: Transaction;
  /** Marks the step as completed in the same transaction and records the audit event. */
  complete(): Promise<void>;
  /** Marks the step as open again, for steps that can be repeated until setup is complete. */
  reopen(): Promise<void>;
  /** The step's stored state. */
  state: Record<string, unknown>;
  /** Replaces the step's stored state. Never store secrets in it. */
  setState(state: Record<string, unknown>): Promise<void>;
  /** Origin and protocol of the request, for checks such as HTTPS detection. */
  request: { protocol: string; host: string | undefined };
}

export interface SetupAction<TInput> {
  input: z.ZodType<TInput>;
  run(context: SetupActionContext, input: TInput): Promise<SetupActionResult>;
}

export interface SetupStep {
  /** Stable identifier, also used in the API path. */
  id: string;
  /** Position in the assistant; steps are shown in ascending order. */
  order: number;
  /** Setup cannot be completed while a required step is open. */
  required: boolean;
  /** What the assistant shows for the step, such as check results or current values. Never secrets. */
  describe(context: {
    request: SetupActionContext["request"];
    state: Record<string, unknown>;
  }): Promise<unknown>;
  /** Each action checks its own input type with its schema. */
  actions: Record<string, SetupAction<unknown>>;
}

export function defineSetupAction<TInput>(action: SetupAction<TInput>): SetupAction<TInput> {
  return action;
}

/** Setup steps registered by the modules. Later modules add their steps without changing the assistant. */
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
