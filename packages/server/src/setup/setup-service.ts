import { createHash, randomInt } from "node:crypto";
import { and, eq, gt, isNotNull, lt, sql } from "drizzle-orm";
import { ANONYMOUS, type Principal } from "../accounts/principal.js";
import { instance } from "../accounts/schema.js";
import type { AuditLog } from "../audit/audit-log.js";
import { RateLimitedError } from "../auth/errors.js";
import { clientSubject, type RateLimiter } from "../auth/throttle.js";
import { generateToken, hashToken, isWellFormedToken } from "../auth/tokens.js";
import { secretsEqual } from "../crypto/constant-time.js";
import type { Database, Transaction } from "../database/database.js";
import type { Logger } from "../logging/logger.js";
import type { SetupActionContext, SetupActionResult, SetupRegistry, SetupStep } from "./framework.js";
import { setupSessions, setupSteps } from "./schema.js";

const SESSION_IDLE_MS = 60 * 60 * 1000;
const SESSION_MAX_MS = 24 * 60 * 60 * 1000;
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 16;
const EXCHANGES_PER_CLIENT = 10;
const EXCHANGE_WINDOW_SECONDS = 15 * 60;
const ISSUE_LOCK = "pagehall.setup";

function hashCode(code: string): Buffer {
  return createHash("sha256").update(code.toUpperCase().replace(/[\s-]/g, ""), "utf8").digest();
}

function logTheOnlySecretEverLogged(logger: Logger, setupCode: string): void {
  logger.warn(
    `Setup code: ${setupCode}. Open Pagehall in a browser and enter this code to set up the instance.`,
  );
}

export class SetupNotFoundError extends Error {
  override name = "SetupNotFoundError";

  constructor() {
    super("Setup is complete");
  }
}

export class SetupStepError extends Error {
  override name = "SetupStepError";

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface SetupStatus {
  steps: {
    id: string;
    required: boolean;
    completed: boolean;
    details: unknown;
  }[];
  ready: boolean;
}

export class SetupService {
  readonly #database: Database;
  readonly #registry: SetupRegistry;
  readonly #audit: AuditLog;
  readonly #rateLimiter: RateLimiter;
  #completed = false;

  constructor(options: {
    database: Database;
    registry: SetupRegistry;
    audit: AuditLog;
    rateLimiter: RateLimiter;
  }) {
    this.#database = options.database;
    this.#registry = options.registry;
    this.#audit = options.audit;
    this.#rateLimiter = options.rateLimiter;
  }

  async isComplete(): Promise<boolean> {
    if (this.#completed) return true;
    const [row] = await this.#database
      .select({ completedAt: instance.setupCompletedAt })
      .from(instance)
      .where(isNotNull(instance.setupCompletedAt));
    this.#completed = row !== undefined;
    return this.#completed;
  }

  async issueCode(logger: Logger): Promise<void> {
    const code = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)])
      .join("")
      .replace(/(.{4})(?!$)/g, "$1-");
    const issued = await this.#database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ISSUE_LOCK}))`);
      await tx.insert(instance).values({ id: 1 }).onConflictDoNothing();
      const [row] = await tx
        .update(instance)
        .set({ setupCodeHash: hashCode(code), setupCodeIssuedAt: new Date() })
        .where(sql`${instance.setupCompletedAt} is null`)
        .returning({ id: instance.id });
      return row !== undefined;
    });
    if (issued) logTheOnlySecretEverLogged(logger, code);
  }

  async exchangeCode(code: string, clientIp: string | undefined, origin: string): Promise<string> {
    if (await this.isComplete()) throw new SetupNotFoundError();
    const limit = await this.#rateLimiter.consume(
      `setupCode:client:${clientSubject(clientIp ?? "unknown")}`,
      EXCHANGES_PER_CLIENT,
      EXCHANGE_WINDOW_SECONDS,
    );
    if (!limit.allowed) throw new RateLimitedError(limit.retryAfterSeconds);
    const token = generateToken();
    const exchanged = await this.#database.transaction(async (tx) => {
      const [row] = await tx
        .select({ hash: instance.setupCodeHash, completedAt: instance.setupCompletedAt })
        .from(instance)
        .for("update");
      if (!row?.hash || row.completedAt) return false;
      if (!secretsEqual(hashCode(code).toString("hex"), row.hash.toString("hex"))) return false;
      await tx.update(instance).set({ setupCodeHash: null }).where(eq(instance.id, 1));
      await tx
        .insert(setupSessions)
        .values({ tokenHash: hashToken(token), origin, expiresAt: new Date(Date.now() + SESSION_IDLE_MS) });
      await this.#audit.record(tx, {
        name: "setup.sessionStarted",
        actor: ANONYMOUS,
        targetId: null,
        fields: {},
      });
      return true;
    });
    if (!exchanged) throw new SetupStepError("invalidSetupCode", "The setup code is not valid");
    return token;
  }

  async validSession(token: string): Promise<boolean> {
    if (!isWellFormedToken(token) || (await this.isComplete())) return false;
    const updated = await this.#database
      .update(setupSessions)
      .set({ expiresAt: new Date(Date.now() + SESSION_IDLE_MS) })
      .where(
        and(
          eq(setupSessions.tokenHash, hashToken(token)),
          gt(setupSessions.expiresAt, new Date()),
          gt(setupSessions.createdAt, new Date(Date.now() - SESSION_MAX_MS)),
        ),
      )
      .returning({ id: setupSessions.id });
    return updated.length === 1;
  }

  async sessionOrigin(token: string): Promise<string | null> {
    if (!isWellFormedToken(token) || (await this.isComplete())) return null;
    const [row] = await this.#database
      .select({ origin: setupSessions.origin })
      .from(setupSessions)
      .where(
        and(
          eq(setupSessions.tokenHash, hashToken(token)),
          gt(setupSessions.expiresAt, new Date()),
          gt(setupSessions.createdAt, new Date(Date.now() - SESSION_MAX_MS)),
        ),
      );
    return row?.origin ?? null;
  }

  async #states(): Promise<Map<string, { state: Record<string, unknown>; completed: boolean }>> {
    const rows = await this.#database.select().from(setupSteps);
    return new Map(
      rows.map((row) => [
        row.step,
        { state: row.state as Record<string, unknown>, completed: row.completedAt !== null },
      ]),
    );
  }

  async status(request: SetupActionContext["request"]): Promise<SetupStatus> {
    const states = await this.#states();
    const steps = [];
    for (const step of this.#registry.all()) {
      const stored = states.get(step.id);
      steps.push({
        id: step.id,
        required: step.required,
        completed: stored?.completed ?? false,
        details: await step.describe({ request, state: stored?.state ?? {} }),
      });
    }
    return { steps, ready: steps.every((step) => !step.required || step.completed) };
  }

  async runAction(
    stepId: string,
    actionName: string,
    input: unknown,
    request: SetupActionContext["request"],
  ): Promise<SetupActionResult> {
    const step = this.#registry.get(stepId);
    const action = step?.actions[actionName];
    if (!step || !action)
      throw new SetupStepError("unknownSetupAction", "The setup step or action does not exist");
    const parsed = action.input.safeParse(input);
    if (!parsed.success)
      throw new SetupStepError("invalidInput", "The input of the setup action is not valid");

    return this.locked(async (tx) => {
      if (await this.#completedIn(tx)) throw new SetupNotFoundError();
      await tx.insert(setupSteps).values({ step: step.id }).onConflictDoNothing();
      const [row] = await tx.select().from(setupSteps).where(eq(setupSteps.step, step.id)).for("update");
      const context: SetupActionContext = {
        tx,
        request,
        state: (row?.state as Record<string, unknown>) ?? {},
        setState: async (state) => {
          await tx
            .update(setupSteps)
            .set({ state, updatedAt: new Date() })
            .where(eq(setupSteps.step, step.id));
          context.state = state;
        },
        complete: () => this.#completeStep(tx, step, ANONYMOUS),
        reopen: async () => {
          await tx
            .update(setupSteps)
            .set({ completedAt: null, updatedAt: new Date() })
            .where(eq(setupSteps.step, step.id));
        },
      };
      return action.run(context, parsed.data);
    });
  }

  async #completedIn(tx: Transaction): Promise<boolean> {
    const [row] = await tx.select({ completedAt: instance.setupCompletedAt }).from(instance);
    return row?.completedAt != null;
  }

  async #completeStep(tx: Transaction, step: SetupStep, actor: Principal): Promise<void> {
    const [updated] = await tx
      .update(setupSteps)
      .set({ completedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(setupSteps.step, step.id), sql`${setupSteps.completedAt} is null`))
      .returning({ step: setupSteps.step });
    if (!updated) return;
    await this.#audit.record(tx, { name: "setup.stepCompleted", actor, targetId: step.id, fields: {} });
  }

  async completeSteps(tx: Transaction, stepIds: string[]): Promise<void> {
    for (const id of stepIds) {
      const step = this.#registry.get(id);
      if (!step) continue;
      await tx.insert(setupSteps).values({ step: id }).onConflictDoNothing();
      await this.#completeStep(tx, step, { type: "system" });
    }
  }

  async finish(): Promise<void> {
    await this.locked(async (tx) => {
      if (await this.#completedIn(tx)) throw new SetupNotFoundError();
      const completed = new Set(
        (
          await tx.select({ step: setupSteps.step }).from(setupSteps).where(isNotNull(setupSteps.completedAt))
        ).map((row) => row.step),
      );
      if (this.#registry.all().some((step) => step.required && !completed.has(step.id))) {
        throw new SetupStepError("setupNotReady", "Required setup steps are not completed");
      }
      await this.markComplete(tx, "assistant");
    });
  }

  async markComplete(tx: Transaction, through: "assistant" | "configuration"): Promise<void> {
    await tx.insert(instance).values({ id: 1 }).onConflictDoNothing();
    const [row] = await tx
      .update(instance)
      .set({ setupCompletedAt: new Date(), setupCompletedThrough: through, setupCodeHash: null })
      .where(sql`${instance.setupCompletedAt} is null`)
      .returning({ id: instance.id });
    if (!row) throw new SetupNotFoundError();
    await tx.delete(setupSessions);
    await this.#audit.record(tx, {
      name: "setup.completed",
      actor: through === "assistant" ? ANONYMOUS : { type: "system" },
      targetId: null,
      fields: { through },
    });
  }

  async locked<T>(operation: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.#database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ISSUE_LOCK}))`);
      return operation(tx);
    });
  }

  async cleanup(): Promise<number> {
    const deleted = await this.#database.delete(setupSessions).where(lt(setupSessions.expiresAt, new Date()));
    return deleted.rowCount ?? 0;
  }
}
