import { argon2, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { PASSWORD_MAX_LENGTH } from "@lunedo/shared";
import { resourcePath } from "../resources.js";
import { ConcurrencyLimiter } from "./concurrency.js";

export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH_FLOOR } from "@lunedo/shared";

export interface Argon2Parameters {
  memory: number;
  passes: number;
  parallelism: number;
}

export const ARGON2_PARAMETERS: Argon2Parameters = { memory: 19_456, passes: 2, parallelism: 1 };

const SALT_LENGTH = 16;
const TAG_LENGTH = 32;
const ARGON2_VERSION = 19;

interface ParsedHash {
  parameters: Argon2Parameters;
  salt: Buffer;
  tag: Buffer;
}

function encode(parameters: Argon2Parameters, salt: Buffer, tag: Buffer): string {
  const { memory, passes, parallelism } = parameters;
  return `$argon2id$v=${ARGON2_VERSION}$m=${memory},t=${passes},p=${parallelism}$${salt.toString("base64url")}$${tag.toString("base64url")}`;
}

function decode(hash: string): ParsedHash | null {
  const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(hash);
  if (!match) return null;
  const [, memory, passes, parallelism, salt, tag] = match;
  return {
    parameters: { memory: Number(memory), passes: Number(passes), parallelism: Number(parallelism) },
    salt: Buffer.from(salt ?? "", "base64url"),
    tag: Buffer.from(tag ?? "", "base64url"),
  };
}

function derive(
  password: string,
  salt: Buffer,
  parameters: Argon2Parameters,
  tagLength: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      "argon2id",
      {
        message: Buffer.from(password.normalize("NFC"), "utf8"),
        nonce: salt,
        memory: parameters.memory,
        passes: parameters.passes,
        parallelism: parameters.parallelism,
        tagLength,
      },
      (error, tag) => (error ? reject(error) : resolve(tag)),
    );
  });
}

function sameParameters(a: Argon2Parameters, b: Argon2Parameters): boolean {
  return a.memory === b.memory && a.passes === b.passes && a.parallelism === b.parallelism;
}

export interface PasswordVerification {
  valid: boolean;
  needsRehash: boolean;
}

export class PasswordHasher {
  readonly #parameters: Argon2Parameters;
  readonly #limiter: ConcurrencyLimiter;
  #dummy: Promise<string> | undefined;

  constructor(options: { concurrency: number; maxQueued: number; parameters?: Argon2Parameters }) {
    this.#parameters = options.parameters ?? ARGON2_PARAMETERS;
    this.#limiter = new ConcurrencyLimiter({ limit: options.concurrency, maxQueued: options.maxQueued });
  }

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const tag = await this.#limiter.run(() => derive(password, salt, this.#parameters, TAG_LENGTH));
    return encode(this.#parameters, salt, tag);
  }

  async verify(hash: string, password: string): Promise<PasswordVerification> {
    const parsed = decode(hash);
    if (!parsed) throw new Error("The stored password hash has an unknown format");
    const tag = await this.#limiter.run(() =>
      derive(password, parsed.salt, parsed.parameters, parsed.tag.length),
    );
    return {
      valid: timingSafeEqual(tag, parsed.tag),
      needsRehash: !sameParameters(parsed.parameters, this.#parameters),
    };
  }

  async verifyNothing(password: string): Promise<void> {
    this.#dummy ??= this.hash(randomBytes(16).toString("hex"));
    await this.verify(await this.#dummy, password);
  }
}

const commonPasswordsFile = resourcePath("data", "common-passwords.txt");
let commonPasswords: Set<string> | undefined;

export function isCommonPassword(password: string): boolean {
  commonPasswords ??= new Set(
    readFileSync(commonPasswordsFile, "utf8")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
  return commonPasswords.has(password.normalize("NFC").toLowerCase());
}

export type PasswordProblem = "tooShort" | "tooLong" | "common";

export function passwordProblem(password: string, minLength: number): PasswordProblem | null {
  const length = [...password.normalize("NFC")].length;
  if (length < minLength) return "tooShort";
  if (length > PASSWORD_MAX_LENGTH) return "tooLong";
  if (isCommonPassword(password)) return "common";
  return null;
}
