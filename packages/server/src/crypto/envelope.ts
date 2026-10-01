import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { KEY_LENGTH, type KeyRing, type SecretKey } from "./key-ring.js";

/*
 * Envelope format, version 1:
 *
 *   0  magic "PHE"           3 bytes
 *   3  format version (1)    1 byte
 *   4  master key version    uint32, big endian
 *   8  wrap IV               12 bytes
 *  20  wrapped data key      32 bytes
 *  52  wrap tag              16 bytes
 *  68  data IV               12 bytes
 *  80  data ciphertext       n bytes
 *  -16 data tag              16 bytes
 *
 * The data key is wrapped with AES-256-GCM under the master key; the wrap authenticates
 * bytes 0-7. The data is encrypted with AES-256-GCM under the data key; it authenticates
 * bytes 0-3 and the caller's context, so a value cannot be moved to another row or column.
 * Rotation replaces bytes 4-67 only.
 */
const MAGIC = Buffer.from("PHE");
const FORMAT_VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const WRAP_START = 8;
const DATA_START = WRAP_START + IV_LENGTH + KEY_LENGTH + TAG_LENGTH;
const MIN_LENGTH = DATA_START + IV_LENGTH + TAG_LENGTH;

export class DecryptionError extends Error {
  override name = "DecryptionError";

  constructor() {
    super("Decryption failed: the value is corrupted, was tampered with or belongs to another context");
  }
}

function checkHeader(envelope: Buffer): void {
  if (
    envelope.length < MIN_LENGTH ||
    !envelope.subarray(0, 3).equals(MAGIC) ||
    envelope[3] !== FORMAT_VERSION
  ) {
    throw new DecryptionError();
  }
}

function wrap(dataKey: Buffer, masterKey: SecretKey, header: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", masterKey.use(), iv);
  cipher.setAAD(header);
  const wrapped = Buffer.concat([cipher.update(dataKey), cipher.final()]);
  return Buffer.concat([iv, wrapped, cipher.getAuthTag()]);
}

function unwrap(envelope: Buffer, masterKey: SecretKey): Buffer {
  const header = envelope.subarray(0, WRAP_START);
  const iv = envelope.subarray(WRAP_START, WRAP_START + IV_LENGTH);
  const wrapped = envelope.subarray(WRAP_START + IV_LENGTH, WRAP_START + IV_LENGTH + KEY_LENGTH);
  const tag = envelope.subarray(WRAP_START + IV_LENGTH + KEY_LENGTH, DATA_START);
  try {
    const decipher = createDecipheriv("aes-256-gcm", masterKey.use(), iv);
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(wrapped), decipher.final()]);
  } catch {
    throw new DecryptionError();
  }
}

function header(keyVersion: number): Buffer {
  const bytes = Buffer.alloc(WRAP_START);
  MAGIC.copy(bytes, 0);
  bytes[3] = FORMAT_VERSION;
  bytes.writeUInt32BE(keyVersion, 4);
  return bytes;
}

function dataAad(context: string): Buffer {
  return Buffer.concat([MAGIC, Buffer.from([FORMAT_VERSION]), Buffer.from(context, "utf8")]);
}

/**
 * Envelope encryption for secrets stored in the database: every value gets its
 * own random data key, which is encrypted with the current master key.
 */
export class Encryption {
  readonly #keyRing: () => KeyRing;

  /** `keyRing` is read on every call, so a reloaded ring takes effect immediately. */
  constructor(keyRing: () => KeyRing) {
    this.#keyRing = keyRing;
  }

  encrypt(plaintext: Buffer | string, context: string): Buffer {
    const ring = this.#keyRing();
    const dataKey = randomBytes(KEY_LENGTH);
    const head = header(ring.currentVersion);
    const wrapped = wrap(dataKey, ring.current(), head);
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv("aes-256-gcm", dataKey, iv);
    cipher.setAAD(dataAad(context));
    const data = typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext;
    const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
    dataKey.fill(0);
    return Buffer.concat([head, wrapped, iv, ciphertext, cipher.getAuthTag()]);
  }

  decrypt(envelope: Buffer, context: string): Buffer {
    checkHeader(envelope);
    const dataKey = unwrap(envelope, this.#keyRing().get(envelope.readUInt32BE(4)));
    try {
      const iv = envelope.subarray(DATA_START, DATA_START + IV_LENGTH);
      const ciphertext = envelope.subarray(DATA_START + IV_LENGTH, envelope.length - TAG_LENGTH);
      const decipher = createDecipheriv("aes-256-gcm", dataKey, iv);
      decipher.setAAD(dataAad(context));
      decipher.setAuthTag(envelope.subarray(envelope.length - TAG_LENGTH));
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      throw new DecryptionError();
    } finally {
      dataKey.fill(0);
    }
  }

  decryptString(envelope: Buffer, context: string): string {
    return this.decrypt(envelope, context).toString("utf8");
  }

  /** Master key version that protects the value. */
  keyVersionOf(envelope: Buffer): number {
    checkHeader(envelope);
    return envelope.readUInt32BE(4);
  }

  /** Re-wraps the data key with the current master key. The encrypted data itself is unchanged. */
  rewrap(envelope: Buffer): Buffer {
    checkHeader(envelope);
    const ring = this.#keyRing();
    if (envelope.readUInt32BE(4) === ring.currentVersion) return envelope;
    const dataKey = unwrap(envelope, ring.get(envelope.readUInt32BE(4)));
    try {
      const head = header(ring.currentVersion);
      return Buffer.concat([head, wrap(dataKey, ring.current(), head), envelope.subarray(DATA_START)]);
    } finally {
      dataKey.fill(0);
    }
  }
}

/** Offset and length of the key version inside an envelope, for database queries. */
export const envelopeKeyVersionField = { offset: 4, length: 4 } as const;
