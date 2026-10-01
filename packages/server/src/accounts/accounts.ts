import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { AuditLog } from "../audit/audit-log.js";
import type { PasswordHasher, PasswordProblem } from "../auth/passwords.js";
import { passwordProblem } from "../auth/passwords.js";
import { passwordMinLengthSetting } from "../auth/settings.js";
import type { Database, Executor, Transaction } from "../database/database.js";
import type { SettingsService } from "../settings/service.js";
import { type AccountState, type AccountType, accounts, instance } from "./schema.js";
import { accountScopeChain } from "./scope.js";

export const emailSchema = z.email().max(254);
export const accountNameSchema = z.string().trim().min(1).max(200);

export interface Account {
  id: string;
  type: AccountType;
  state: AccountState;
  email: string | null;
  name: string;
  passwordHash: string | null;
  passwordChangedAt: Date | null;
  createdAt: Date;
}

const accountColumns = {
  id: accounts.id,
  type: accounts.type,
  state: accounts.state,
  email: accounts.email,
  name: accounts.name,
  passwordHash: accounts.passwordHash,
  passwordChangedAt: accounts.passwordChangedAt,
  createdAt: accounts.createdAt,
};

export class EmailInUseError extends Error {
  override name = "EmailInUseError";

  constructor() {
    super("The e-mail address is already in use");
  }
}

export class PasswordPolicyError extends Error {
  override name = "PasswordPolicyError";

  constructor(
    readonly problem: PasswordProblem,
    readonly minLength: number,
  ) {
    super(`The password does not meet the policy: ${problem}`);
  }
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  const cause = (error as { cause?: { code?: string; constraint?: string } }).cause ?? error;
  const details = cause as { code?: string; constraint?: string };
  return details.code === "23505" && details.constraint === constraint;
}

export async function withUniqueEmail<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isUniqueViolation(error, "accounts_email_unique")) throw new EmailInUseError();
    throw error;
  }
}

export class AccountService {
  readonly #database: Database;
  readonly #settings: SettingsService;
  readonly #audit: AuditLog;
  readonly #hasher: PasswordHasher;

  constructor(options: {
    database: Database;
    settings: SettingsService;
    audit: AuditLog;
    hasher: PasswordHasher;
  }) {
    this.#database = options.database;
    this.#settings = options.settings;
    this.#audit = options.audit;
    this.#hasher = options.hasher;
  }

  async get(id: string, executor: Executor = this.#database): Promise<Account | null> {
    const [row] = await executor.select(accountColumns).from(accounts).where(eq(accounts.id, id));
    return row ?? null;
  }

  async findByEmail(email: string, executor: Executor = this.#database): Promise<Account | null> {
    const [row] = await executor
      .select(accountColumns)
      .from(accounts)
      .where(sql`lower(${accounts.email}) = lower(${email.trim()})`);
    return row ?? null;
  }

  async checkPassword(password: string, accountId?: string): Promise<void> {
    const minLength = await this.#settings.get(
      passwordMinLengthSetting,
      accountId ? accountScopeChain(accountId) : {},
    );
    const problem = passwordProblem(password, minLength);
    if (problem) throw new PasswordPolicyError(problem, minLength);
  }

  async hashPassword(password: string, accountId?: string): Promise<string> {
    await this.checkPassword(password, accountId);
    return this.#hasher.hash(password);
  }

  async createStandard(
    tx: Transaction,
    input: { email: string; name: string; password: string },
  ): Promise<Account> {
    const email = emailSchema.parse(input.email.trim());
    const name = accountNameSchema.parse(input.name);
    const passwordHash = await this.hashPassword(input.password);
    const [row] = await withUniqueEmail(() =>
      tx
        .insert(accounts)
        .values({
          type: "standard",
          state: "active",
          email,
          name,
          passwordHash,
          passwordChangedAt: new Date(),
        })
        .returning(accountColumns),
    );
    if (!row) throw new Error("The account was not created");
    await this.#audit.record(tx, {
      name: "account.created",
      targetId: row.id,
      fields: { type: row.type, email },
    });
    return row;
  }

  async lock(tx: Transaction, id: string): Promise<Account | null> {
    const [row] = await tx.select(accountColumns).from(accounts).where(eq(accounts.id, id)).for("update");
    return row ?? null;
  }

  async setPasswordHash(executor: Executor, id: string, passwordHash: string): Promise<void> {
    await executor
      .update(accounts)
      .set({ passwordHash, passwordChangedAt: new Date() })
      .where(eq(accounts.id, id));
  }

  async ownerId(executor: Executor = this.#database): Promise<string | null> {
    const [row] = await executor.select({ ownerAccountId: instance.ownerAccountId }).from(instance);
    return row?.ownerAccountId ?? null;
  }
}
