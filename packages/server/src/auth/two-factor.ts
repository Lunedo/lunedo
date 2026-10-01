import { createHash, randomInt } from "node:crypto";
import { uuidv7 } from "@pagehall/shared";
import { and, count, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { Secret, TOTP } from "otpauth";
import type { Encryption } from "../crypto/envelope.js";
import type { Database, Executor } from "../database/database.js";
import { recoveryCodes, totpCredentials, webauthnCredentials } from "./schema.js";

const TOTP_PERIOD = 30;
const TOTP_DIGITS = 6;
/** Codes of one step before and after the current one are accepted, for clock drift. */
const TOTP_WINDOW = 1;

function totpContext(id: string): string {
  return `totp_credentials.secret:${id}`;
}

export interface TotpSetup {
  /** Base32 secret for manual entry. */
  secret: string;
  /** `otpauth://` URI for a QR code. */
  uri: string;
}

/**
 * TOTP for any authenticator app (RFC 6238, SHA-1, 6 digits, 30 seconds). The secret is stored
 * with envelope encryption. A code is accepted once only: the step of the last accepted code is
 * stored, and only later steps are accepted afterwards.
 */
export class TotpService {
  readonly #database: Database;
  readonly #encryption: Encryption;
  readonly #clock: () => Date;

  constructor(options: { database: Database; encryption: Encryption; clock?: () => Date }) {
    this.#database = options.database;
    this.#encryption = options.encryption;
    this.#clock = options.clock ?? (() => new Date());
  }

  /**
   * Starts setting up TOTP with a new secret. Replaces an unconfirmed secret; returns null when
   * the account already has confirmed TOTP.
   */
  async begin(
    accountId: string,
    labels: { issuer: string; account: string },
    executor: Executor = this.#database,
  ): Promise<TotpSetup | null> {
    const secret = new Secret({ size: 20 });
    return executor.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: totpCredentials.id, confirmedAt: totpCredentials.confirmedAt })
        .from(totpCredentials)
        .where(eq(totpCredentials.accountId, accountId))
        .for("update");
      if (existing?.confirmedAt) return null;
      if (existing) await tx.delete(totpCredentials).where(eq(totpCredentials.id, existing.id));
      const id = uuidv7();
      await tx
        .insert(totpCredentials)
        .values({ id, accountId, secret: this.#encryption.encrypt(secret.base32, totpContext(id)) });
      const totp = new TOTP({
        issuer: labels.issuer,
        label: labels.account,
        secret,
        digits: TOTP_DIGITS,
        period: TOTP_PERIOD,
      });
      return { secret: secret.base32, uri: totp.toString() };
    });
  }

  /**
   * Checks a code and marks its step as used. With `confirming`, the code is checked against an
   * unconfirmed secret, which becomes confirmed.
   */
  async verify(executor: Executor, accountId: string, code: string, options: { confirming?: boolean } = {}) {
    if (!/^\d{6}$/.test(code)) return false;
    const [row] = await executor
      .select({ id: totpCredentials.id, secret: totpCredentials.secret })
      .from(totpCredentials)
      .where(
        and(
          eq(totpCredentials.accountId, accountId),
          options.confirming ? isNull(totpCredentials.confirmedAt) : isNotNull(totpCredentials.confirmedAt),
        ),
      );
    if (!row) return false;
    const secret = Secret.fromBase32(this.#encryption.decryptString(row.secret, totpContext(row.id)));
    const timestamp = this.#clock().getTime();
    const delta = TOTP.validate({
      token: code,
      secret,
      digits: TOTP_DIGITS,
      period: TOTP_PERIOD,
      timestamp,
      window: TOTP_WINDOW,
    });
    if (delta === null) return false;
    const step = TOTP.counter({ period: TOTP_PERIOD, timestamp }) + delta;
    const accepted = await executor
      .update(totpCredentials)
      .set({ lastUsedStep: step, ...(options.confirming ? { confirmedAt: this.#clock() } : {}) })
      .where(
        and(
          eq(totpCredentials.id, row.id),
          or(isNull(totpCredentials.lastUsedStep), lt(totpCredentials.lastUsedStep, step)),
        ),
      )
      .returning({ id: totpCredentials.id });
    return accepted.length === 1;
  }

  /** Removes TOTP; returns whether a confirmed secret existed. */
  async remove(executor: Executor, accountId: string): Promise<boolean> {
    const deleted = await executor
      .delete(totpCredentials)
      .where(eq(totpCredentials.accountId, accountId))
      .returning({ confirmedAt: totpCredentials.confirmedAt });
    return deleted.some((row) => row.confirmedAt !== null);
  }
}

const RECOVERY_CODE_COUNT = 10;
/** Crockford's base32 alphabet: no I, L, O or U, so codes are easy to read and type. */
const RECOVERY_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
/** 16 characters of base32 are 80 bits, too many to guess even with the stored hash. */
const RECOVERY_CODE_LENGTH = 16;

function normalizeRecoveryCode(code: string): string {
  return code.toLowerCase().replace(/[\s-]/g, "").replace(/o/g, "0").replace(/[il]/g, "1");
}

function hashRecoveryCode(code: string): Buffer {
  return createHash("sha256").update(normalizeRecoveryCode(code), "utf8").digest();
}

function generateRecoveryCode(): string {
  const characters = Array.from({ length: RECOVERY_CODE_LENGTH }, () => RECOVERY_ALPHABET[randomInt(32)]);
  return characters.join("").replace(/(.{4})(?!$)/g, "$1-");
}

/** Ten single-use recovery codes per account, stored as hashes. */
export class RecoveryCodeService {
  readonly #clock: () => Date;

  constructor(options: { clock?: () => Date } = {}) {
    this.#clock = options.clock ?? (() => new Date());
  }

  /** Replaces all codes of the account with new ones and returns them. */
  async generate(executor: Executor, accountId: string): Promise<string[]> {
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
    await executor.delete(recoveryCodes).where(eq(recoveryCodes.accountId, accountId));
    await executor
      .insert(recoveryCodes)
      .values(codes.map((code) => ({ accountId, codeHash: hashRecoveryCode(code) })));
    return codes;
  }

  /** Uses a code. Returns the number of codes left, or null when the code is not valid. */
  async use(executor: Executor, accountId: string, code: string): Promise<number | null> {
    if (normalizeRecoveryCode(code).length !== RECOVERY_CODE_LENGTH) return null;
    const used = await executor
      .update(recoveryCodes)
      .set({ usedAt: this.#clock() })
      .where(
        and(
          eq(recoveryCodes.accountId, accountId),
          eq(recoveryCodes.codeHash, hashRecoveryCode(code)),
          isNull(recoveryCodes.usedAt),
        ),
      )
      .returning({ id: recoveryCodes.id });
    if (used.length === 0) return null;
    return this.remaining(executor, accountId);
  }

  async remaining(executor: Executor, accountId: string): Promise<number> {
    const [row] = await executor
      .select({ count: count() })
      .from(recoveryCodes)
      .where(and(eq(recoveryCodes.accountId, accountId), isNull(recoveryCodes.usedAt)));
    return row?.count ?? 0;
  }
}

export interface SecondFactors {
  totp: boolean;
  passkeys: number;
  recoveryCodes: number;
}

/** The confirmed second factors of an account and its unused recovery codes. */
export async function secondFactorsOf(executor: Executor, accountId: string): Promise<SecondFactors> {
  const [row] = await executor
    .execute<{ totp: boolean; passkeys: number; recovery_codes: number }>(sql`
    select
      exists (select 1 from ${totpCredentials} where ${totpCredentials.accountId} = ${accountId}
        and ${totpCredentials.confirmedAt} is not null) as totp,
      (select count(*)::int from ${webauthnCredentials} where ${webauthnCredentials.accountId} = ${accountId}) as passkeys,
      (select count(*)::int from ${recoveryCodes} where ${recoveryCodes.accountId} = ${accountId}
        and ${recoveryCodes.usedAt} is null) as recovery_codes`)
    .then((result) => result.rows);
  return { totp: row?.totp ?? false, passkeys: row?.passkeys ?? 0, recoveryCodes: row?.recovery_codes ?? 0 };
}

export function hasSecondFactor(factors: SecondFactors): boolean {
  return factors.totp || factors.passkeys > 0;
}
