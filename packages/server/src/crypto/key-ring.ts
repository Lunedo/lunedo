import { createHash } from "node:crypto";
import { inspect } from "node:util";

export const KEY_LENGTH = 32;
const REDACTED = "[key material]";

/** 256-bit key material. It never appears in logs, errors, JSON or snapshots. */
export class SecretKey {
  readonly #bytes: Buffer;

  constructor(bytes: Buffer) {
    if (bytes.length !== KEY_LENGTH) throw new KeyRingError(`Keys must be ${KEY_LENGTH} bytes long`);
    this.#bytes = Buffer.from(bytes);
  }

  /** Returns the key bytes for a cipher call. Callers must not keep or log them. */
  use(): Buffer {
    return this.#bytes;
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

export class KeyRingError extends Error {
  override name = "KeyRingError";
}

/** Versioned master keys. New data is encrypted with the current (highest) version. */
export class KeyRing {
  readonly #keys: ReadonlyMap<number, SecretKey>;
  readonly currentVersion: number;

  constructor(keys: ReadonlyMap<number, SecretKey>) {
    if (keys.size === 0) throw new KeyRingError("The key ring contains no keys");
    for (const version of keys.keys()) {
      if (!Number.isInteger(version) || version < 1 || version > 0xffffffff) {
        throw new KeyRingError("Key versions must be positive integers");
      }
    }
    this.#keys = new Map(keys);
    this.currentVersion = Math.max(...keys.keys());
  }

  get versions(): number[] {
    return [...this.#keys.keys()].sort((a, b) => a - b);
  }

  current(): SecretKey {
    return this.get(this.currentVersion);
  }

  get(version: number): SecretKey {
    const key = this.#keys.get(version);
    if (!key) throw new KeyRingError(`Master key version ${version} is not available`);
    return key;
  }

  has(version: number): boolean {
    return this.#keys.has(version);
  }

  toString(): string {
    return `KeyRing(versions ${this.versions.join(", ")})`;
  }

  toJSON(): { versions: number[]; currentVersion: number } {
    return { versions: this.versions, currentVersion: this.currentVersion };
  }

  [inspect.custom](): string {
    return this.toString();
  }
}

/**
 * Parses a key ring: one `<version>:<base64 key>` entry per line or separated by commas.
 * Empty lines and lines starting with `#` are ignored.
 */
export function parseKeyRing(text: string): KeyRing {
  const keys = new Map<number, SecretKey>();
  for (const entry of text.split(/[\n,]/)) {
    const trimmed = entry.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const match = /^(\d+):([A-Za-z0-9+/=_-]+)$/.exec(trimmed);
    if (!match) throw new KeyRingError("Key ring entries must look like <version>:<base64 key>");
    const version = Number(match[1]);
    if (keys.has(version)) throw new KeyRingError(`Key version ${version} appears twice`);
    const bytes = Buffer.from(match[2] ?? "", "base64");
    if (bytes.length !== KEY_LENGTH) {
      throw new KeyRingError(`Key version ${version} must be ${KEY_LENGTH} bytes, encoded as base64`);
    }
    keys.set(version, new SecretKey(bytes));
  }
  return new KeyRing(keys);
}

/**
 * Identifies a key without revealing anything about it: the first 8 bytes of SHA-256 over
 * a purpose label and the key, in hex.
 */
export function keyFingerprint(purpose: "master" | "backup", key: SecretKey): string {
  return createHash("sha256")
    .update(`pagehall-${purpose}-key`)
    .update(key.use())
    .digest()
    .subarray(0, 8)
    .toString("hex");
}

export function formatKeyEntry(version: number, key: Buffer): string {
  return `${version}:${key.toString("base64")}`;
}
