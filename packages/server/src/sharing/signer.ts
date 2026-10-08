import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Encryption } from "../crypto/envelope.js";
import type { Database } from "../database/database.js";
import { instanceSecrets } from "../mail/schema.js";

const SIGNING_KEY = "signedValueKey";
const SIGNING_KEY_CONTEXT = `instance_secrets.value:${SIGNING_KEY}`;
const KEY_LENGTH = 32;

export class ValueSigner {
  readonly #database: Database;
  readonly #encryption: Encryption;
  #key: Promise<Buffer> | undefined;

  constructor(options: { database: Database; encryption: Encryption }) {
    this.#database = options.database;
    this.#encryption = options.encryption;
  }

  async #load(): Promise<Buffer> {
    const read = async () => {
      const [row] = await this.#database
        .select({ value: instanceSecrets.value })
        .from(instanceSecrets)
        .where(eq(instanceSecrets.name, SIGNING_KEY));
      return row
        ? Buffer.from(this.#encryption.decryptString(row.value, SIGNING_KEY_CONTEXT), "base64")
        : null;
    };
    const stored = await read();
    if (stored) return stored;
    const fresh = randomBytes(KEY_LENGTH);
    await this.#database
      .insert(instanceSecrets)
      .values({
        name: SIGNING_KEY,
        value: this.#encryption.encrypt(fresh.toString("base64"), SIGNING_KEY_CONTEXT),
      })
      .onConflictDoNothing();
    fresh.fill(0);
    const created = await read();
    if (!created) throw new Error("The signing key is missing");
    return created;
  }

  #keyOnce(): Promise<Buffer> {
    if (!this.#key) {
      this.#key = this.#load();
      this.#key.catch(() => {
        this.#key = undefined;
      });
    }
    return this.#key;
  }

  async sign(purpose: string, parts: readonly string[], expiresAt: Date): Promise<string> {
    const expiry = Math.floor(expiresAt.getTime() / 1000).toString(36);
    const mac = createHmac("sha256", await this.#keyOnce())
      .update([purpose, expiry, ...parts].join("\n"), "utf8")
      .digest("base64url");
    return `${expiry}.${mac}`;
  }

  async verify(purpose: string, parts: readonly string[], token: string, now = new Date()): Promise<boolean> {
    const match = /^([0-9a-z]{1,12})\.([A-Za-z0-9_-]{43})$/.exec(token);
    if (!match?.[1] || !match[2]) return false;
    const expiry = match[1];
    if (Number.parseInt(expiry, 36) * 1000 <= now.getTime()) return false;
    const expected = createHmac("sha256", await this.#keyOnce())
      .update([purpose, expiry, ...parts].join("\n"), "utf8")
      .digest();
    const provided = Buffer.from(match[2], "base64url");
    if (provided.toString("base64url") !== match[2]) return false;
    return provided.length === expected.length && timingSafeEqual(provided, expected);
  }
}
