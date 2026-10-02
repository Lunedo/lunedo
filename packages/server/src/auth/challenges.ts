import { and, eq, gt, lt, sql } from "drizzle-orm";
import type { SignInMethod } from "../audit/catalog.js";
import type { Database, Executor } from "../database/database.js";
import { authChallenges } from "./schema.js";
import { generateToken, hashToken, isWellFormedToken } from "./tokens.js";

export type ChallengePurpose = (typeof authChallenges.$inferSelect)["purpose"];

export interface Challenge {
  id: string;
  purpose: ChallengePurpose;
  accountId: string | null;
  sessionId: string | null;
  challenge: string | null;
  methods: SignInMethod[];
  failedAttempts: number;
  deviceHash: Buffer | null;
  payload: unknown;
  expiresAt: Date;
}

const columns = {
  id: authChallenges.id,
  purpose: authChallenges.purpose,
  accountId: authChallenges.accountId,
  sessionId: authChallenges.sessionId,
  challenge: authChallenges.challenge,
  methods: authChallenges.methods,
  failedAttempts: authChallenges.failedAttempts,
  deviceHash: authChallenges.deviceHash,
  payload: authChallenges.payload,
  expiresAt: authChallenges.expiresAt,
};

export const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;

export const MAX_CHALLENGE_FAILURES = 5;

export class ChallengeStore {
  readonly #database: Database;
  readonly #clock: () => Date;

  constructor(options: { database: Database; clock?: () => Date }) {
    this.#database = options.database;
    this.#clock = options.clock ?? (() => new Date());
  }

  async create(
    executor: Executor,
    options: {
      purpose: ChallengePurpose;
      accountId?: string;
      sessionId?: string;
      challenge?: string;
      methods?: SignInMethod[];
      deviceHash?: Buffer | null;
      payload?: unknown;
      withToken: boolean;
    },
  ): Promise<{ id: string; token: string | null }> {
    const token = options.withToken ? generateToken() : null;
    const [row] = await executor
      .insert(authChallenges)
      .values({
        purpose: options.purpose,
        tokenHash: token ? hashToken(token) : null,
        accountId: options.accountId ?? null,
        sessionId: options.sessionId ?? null,
        challenge: options.challenge ?? null,
        methods: options.methods ?? [],
        deviceHash: options.deviceHash ?? null,
        payload: options.payload ?? null,
        expiresAt: new Date(this.#clock().getTime() + CHALLENGE_LIFETIME_MS),
      })
      .returning({ id: authChallenges.id });
    if (!row) throw new Error("The challenge was not created");
    return { id: row.id, token };
  }

  async findByToken(token: string, purpose: ChallengePurpose): Promise<Challenge | null> {
    if (!isWellFormedToken(token)) return null;
    const [row] = await this.#database
      .select(columns)
      .from(authChallenges)
      .where(
        and(
          eq(authChallenges.tokenHash, hashToken(token)),
          eq(authChallenges.purpose, purpose),
          gt(authChallenges.expiresAt, this.#clock()),
        ),
      );
    return row ?? null;
  }

  async setChallenge(id: string, challenge: string): Promise<void> {
    await this.#database.update(authChallenges).set({ challenge }).where(eq(authChallenges.id, id));
  }

  async consume(executor: Executor, id: string): Promise<Challenge | null> {
    const [row] = await executor
      .delete(authChallenges)
      .where(and(eq(authChallenges.id, id), gt(authChallenges.expiresAt, this.#clock())))
      .returning(columns);
    return row ?? null;
  }

  async consumeForSession(sessionId: string, purpose: ChallengePurpose): Promise<Challenge | null> {
    const [row] = await this.#database
      .delete(authChallenges)
      .where(
        and(
          eq(authChallenges.sessionId, sessionId),
          eq(authChallenges.purpose, purpose),
          gt(authChallenges.expiresAt, this.#clock()),
        ),
      )
      .returning(columns);
    return row ?? null;
  }

  async replaceForSession(
    sessionId: string,
    accountId: string,
    purpose: ChallengePurpose,
    challenge: string,
  ): Promise<void> {
    await this.#database.transaction(async (tx) => {
      await tx
        .delete(authChallenges)
        .where(and(eq(authChallenges.sessionId, sessionId), eq(authChallenges.purpose, purpose)));
      await this.create(tx, { purpose, sessionId, accountId, challenge, withToken: false });
    });
  }

  async recordFailure(id: string): Promise<void> {
    await this.#database.transaction(async (tx) => {
      const [row] = await tx
        .update(authChallenges)
        .set({ failedAttempts: sql`${authChallenges.failedAttempts} + 1` })
        .where(eq(authChallenges.id, id))
        .returning({ failedAttempts: authChallenges.failedAttempts });
      if (row && row.failedAttempts >= MAX_CHALLENGE_FAILURES) {
        await tx.delete(authChallenges).where(eq(authChallenges.id, id));
      }
    });
  }

  async cleanup(): Promise<number> {
    const deleted = await this.#database
      .delete(authChallenges)
      .where(lt(authChallenges.expiresAt, this.#clock()));
    return deleted.rowCount ?? 0;
  }
}
