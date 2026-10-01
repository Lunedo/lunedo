import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ensureSecretFile } from "../config/generated-secrets.js";
import type { ServerConfig } from "../config/load.js";
import type { Secret } from "../config/secret.js";
import { formatKeyEntry, KEY_LENGTH, type KeyRing, KeyRingError, parseKeyRing } from "./key-ring.js";

/**
 * Source of the master keys. Vault, OpenBao and cloud KMS providers
 * are further implementations of this interface.
 */
export interface KeyProvider {
  readonly name: string;
  /**
   * Loads the key ring. A provider that manages keys itself creates the first key only with
   * `create: true`; otherwise a missing key ring is an error.
   */
  load(options?: { create?: boolean }): Promise<KeyRing>;
  /** Creates the next key version, where the provider manages keys itself. */
  addVersion(): Promise<KeyRing>;
}

/** Reads the key ring from `PAGEHALL_MASTER_KEYS`. Operators add versions and restart. */
export class EnvKeyProvider implements KeyProvider {
  readonly name = "env";
  readonly #value: Secret;

  constructor(value: Secret) {
    this.#value = value;
  }

  async load(): Promise<KeyRing> {
    return parseKeyRing(this.#value.reveal());
  }

  async addVersion(): Promise<KeyRing> {
    throw new KeyRingError(
      "The env key provider cannot create keys: add a new version to PAGEHALL_MASTER_KEYS and restart all nodes",
    );
  }
}

/**
 * Reads the key ring from a file, by default in the secrets volume. The first start of an
 * empty instance generates version 1; rotation appends a new version.
 */
export class FileKeyProvider implements KeyProvider {
  readonly name = "file";
  readonly #file: string;

  constructor(file: string) {
    this.#file = file;
  }

  async load(options: { create?: boolean } = {}): Promise<KeyRing> {
    if (!options.create && !existsSync(this.#file)) {
      throw new KeyRingError(`The master key ring ${this.#file} does not exist`);
    }
    const secret = ensureSecretFile(path.dirname(this.#file), path.basename(this.#file), () =>
      formatKeyEntry(1, randomBytes(KEY_LENGTH)),
    );
    return parseKeyRing(secret.reveal());
  }

  async addVersion(): Promise<KeyRing> {
    const current = await this.load();
    const text = readFileSync(this.#file, "utf8").replace(/\s*$/, "\n");
    const next = `${text}${formatKeyEntry(current.currentVersion + 1, randomBytes(KEY_LENGTH))}\n`;
    const temporary = `${this.#file}.${randomUUID()}.tmp`;
    writeFileSync(temporary, next, { mode: 0o600, flag: "wx" });
    renameSync(temporary, this.#file);
    return this.load();
  }
}

export function createKeyProvider(config: ServerConfig): KeyProvider {
  if (config.keys.provider === "env") {
    if (!config.keys.masterKeys) throw new KeyRingError("PAGEHALL_MASTER_KEYS is not set");
    return new EnvKeyProvider(config.keys.masterKeys);
  }
  return new FileKeyProvider(config.keys.masterKeysPath);
}
