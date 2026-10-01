import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { Transform, type TransformCallback } from "node:stream";
import { DecryptionError } from "./envelope.js";
import { KEY_LENGTH, type KeyRing, KeyRingError, type SecretKey } from "./key-ring.js";

/*
 * Stream format, version 1 (for attachments and backups):
 *
 *   header (84 bytes)
 *     0  magic "PHS"          3 bytes
 *     3  format version (1)   1 byte
 *     4  key kind             1 byte: 1 master key, 2 backup key
 *     5  key ID               8 bytes: master key version (bytes 4-7), or backup key version
 *                             (bytes 0-3) and the first 4 bytes of its fingerprint
 *    13  wrap IV              12 bytes
 *    25  wrapped data key     32 bytes (AES-256-GCM, authenticates bytes 0-12)
 *    57  wrap tag             16 bytes
 *    73  nonce prefix         7 bytes
 *    80  chunk size           uint32, big endian
 *   chunks
 *     final flag              1 byte (0 or 1)
 *     length                  uint32, big endian: ciphertext plus 16-byte tag
 *     ciphertext and tag
 *
 * Each chunk is encrypted with the data key; its nonce is prefix, chunk counter (uint32)
 * and final flag, and it authenticates the caller's associated data followed by the whole
 * header. Reordering, dropping, truncating or appending chunks fails authentication, and so
 * does any change to the associated data, such as an unencrypted file header.
 */
const MAGIC = Buffer.from("PHS");
const FORMAT_VERSION = 1;
const HEADER_LENGTH = 84;
const WRAP_AAD_LENGTH = 13;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const NONCE_PREFIX_LENGTH = 7;
const FRAME_HEADER_LENGTH = 5;
export const DEFAULT_CHUNK_SIZE = 64 * 1024;
const MAX_CHUNK_SIZE = 16 * 1024 * 1024;

export type StreamKeyKind = "master" | "backup";
const KIND_CODES: Record<StreamKeyKind, number> = { master: 1, backup: 2 };

export interface StreamKey {
  kind: StreamKeyKind;
  id: Buffer;
  key: SecretKey;
}

/** Supplies the key for new streams and finds the key of existing ones. */
export interface StreamKeys {
  current(): StreamKey;
  resolve(kind: StreamKeyKind, id: Buffer): SecretKey;
}

export function masterStreamKeys(keyRing: () => KeyRing): StreamKeys {
  const idOf = (version: number) => {
    const id = Buffer.alloc(8);
    id.writeUInt32BE(version, 4);
    return id;
  };
  return {
    current() {
      const ring = keyRing();
      return { kind: "master", id: idOf(ring.currentVersion), key: ring.current() };
    },
    resolve(kind, id) {
      if (kind !== "master") throw new KeyRingError("The data is not encrypted with a master key");
      return keyRing().get(id.readUInt32BE(4));
    },
  };
}

/** The fingerprint identifies the backup key without revealing it. */
export function backupKeyFingerprint(key: SecretKey): Buffer {
  return createHash("sha256").update("pagehall-backup-key").update(key.use()).digest().subarray(0, 8);
}

function backupKeyId(version: number, key: SecretKey): Buffer {
  const id = Buffer.alloc(8);
  id.writeUInt32BE(version, 0);
  backupKeyFingerprint(key).copy(id, 4, 0, 4);
  return id;
}

/** Backup keys are versioned like master keys; new backups use the current version. */
export function backupStreamKeys(ring: KeyRing): StreamKeys {
  return {
    current: () => ({
      kind: "backup",
      id: backupKeyId(ring.currentVersion, ring.current()),
      key: ring.current(),
    }),
    resolve(kind, streamId) {
      if (kind !== "backup") throw new KeyRingError("The data is not encrypted with a backup key");
      const version = streamId.readUInt32BE(0);
      if (!ring.has(version)) throw new KeyRingError(`Backup key version ${version} is not available`);
      const key = ring.get(version);
      if (!streamId.equals(backupKeyId(version, key))) {
        throw new KeyRingError(
          `The data was encrypted with a different key than backup key version ${version}`,
        );
      }
      return key;
    },
  };
}

function nonce(prefix: Buffer, counter: number, final: boolean): Buffer {
  const bytes = Buffer.alloc(IV_LENGTH);
  prefix.copy(bytes, 0);
  bytes.writeUInt32BE(counter, NONCE_PREFIX_LENGTH);
  bytes[IV_LENGTH - 1] = final ? 1 : 0;
  return bytes;
}

class EncryptStream extends Transform {
  readonly #header: Buffer;
  readonly #aad: Buffer;
  readonly #dataKey: Buffer;
  readonly #prefix: Buffer;
  readonly #chunkSize: number;
  #pending: Buffer[] = [];
  #pendingLength = 0;
  #counter = 0;
  #headerSent = false;

  constructor(keys: StreamKeys, chunkSize: number, associatedData: Buffer) {
    super();
    if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_CHUNK_SIZE) {
      throw new RangeError("Invalid chunk size");
    }
    const { kind, id, key } = keys.current();
    this.#chunkSize = chunkSize;
    this.#dataKey = randomBytes(KEY_LENGTH);
    this.#prefix = randomBytes(NONCE_PREFIX_LENGTH);

    const head = Buffer.alloc(HEADER_LENGTH);
    MAGIC.copy(head, 0);
    head[3] = FORMAT_VERSION;
    head[4] = KIND_CODES[kind];
    id.copy(head, 5, 0, 8);
    const wrapIv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv("aes-256-gcm", key.use(), wrapIv);
    cipher.setAAD(head.subarray(0, WRAP_AAD_LENGTH));
    const wrapped = Buffer.concat([cipher.update(this.#dataKey), cipher.final()]);
    wrapIv.copy(head, 13);
    wrapped.copy(head, 25);
    cipher.getAuthTag().copy(head, 57);
    this.#prefix.copy(head, 73);
    head.writeUInt32BE(chunkSize, 80);
    this.#header = head;
    this.#aad = Buffer.concat([associatedData, head]);
  }

  #sendHeader() {
    if (!this.#headerSent) {
      this.push(this.#header);
      this.#headerSent = true;
    }
  }

  #emitChunk(plaintext: Buffer, final: boolean) {
    if (this.#counter > 0xffffffff) throw new RangeError("Stream too long");
    const cipher = createCipheriv("aes-256-gcm", this.#dataKey, nonce(this.#prefix, this.#counter, final));
    cipher.setAAD(this.#aad);
    const body = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
    const frame = Buffer.alloc(FRAME_HEADER_LENGTH);
    frame[0] = final ? 1 : 0;
    frame.writeUInt32BE(body.length, 1);
    this.push(Buffer.concat([frame, body]));
    this.#counter += 1;
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    try {
      this.#sendHeader();
      this.#pending.push(chunk);
      this.#pendingLength += chunk.length;
      while (this.#pendingLength > this.#chunkSize) {
        const all = Buffer.concat(this.#pending);
        this.#emitChunk(all.subarray(0, this.#chunkSize), false);
        const rest = all.subarray(this.#chunkSize);
        this.#pending = [rest];
        this.#pendingLength = rest.length;
      }
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  override _flush(callback: TransformCallback): void {
    try {
      this.#sendHeader();
      this.#emitChunk(Buffer.concat(this.#pending), true);
      this.#dataKey.fill(0);
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }
}

class DecryptStream extends Transform {
  readonly #keys: StreamKeys;
  readonly #associatedData: Buffer;
  #buffer = Buffer.alloc(0);
  #header: Buffer | undefined;
  #aad: Buffer | undefined;
  #dataKey: Buffer | undefined;
  #prefix: Buffer | undefined;
  #chunkSize = 0;
  #counter = 0;
  #finished = false;

  constructor(keys: StreamKeys, associatedData: Buffer) {
    super();
    this.#keys = keys;
    this.#associatedData = associatedData;
  }

  #readHeader(): boolean {
    if (this.#buffer.length < HEADER_LENGTH) return false;
    const head = Buffer.from(this.#buffer.subarray(0, HEADER_LENGTH));
    this.#buffer = this.#buffer.subarray(HEADER_LENGTH);
    if (!head.subarray(0, 3).equals(MAGIC) || head[3] !== FORMAT_VERSION) throw new DecryptionError();
    const kind = head[4] === 1 ? "master" : head[4] === 2 ? "backup" : undefined;
    if (!kind) throw new DecryptionError();
    const key = this.#keys.resolve(kind, head.subarray(5, 13));
    try {
      const decipher = createDecipheriv("aes-256-gcm", key.use(), head.subarray(13, 25));
      decipher.setAAD(head.subarray(0, WRAP_AAD_LENGTH));
      decipher.setAuthTag(head.subarray(57, 73));
      this.#dataKey = Buffer.concat([decipher.update(head.subarray(25, 57)), decipher.final()]);
    } catch {
      throw new DecryptionError();
    }
    this.#prefix = head.subarray(73, 80);
    this.#chunkSize = head.readUInt32BE(80);
    if (this.#chunkSize < 1 || this.#chunkSize > MAX_CHUNK_SIZE) throw new DecryptionError();
    this.#header = head;
    this.#aad = Buffer.concat([this.#associatedData, head]);
    return true;
  }

  #readFrames() {
    while (this.#buffer.length >= FRAME_HEADER_LENGTH) {
      if (this.#finished) throw new DecryptionError();
      const flag = this.#buffer[0];
      const length = this.#buffer.readUInt32BE(1);
      if ((flag !== 0 && flag !== 1) || length < TAG_LENGTH || length > this.#chunkSize + TAG_LENGTH) {
        throw new DecryptionError();
      }
      if (this.#buffer.length < FRAME_HEADER_LENGTH + length) return;
      const body = this.#buffer.subarray(FRAME_HEADER_LENGTH, FRAME_HEADER_LENGTH + length);
      this.#buffer = this.#buffer.subarray(FRAME_HEADER_LENGTH + length);
      const final = flag === 1;
      try {
        const decipher = createDecipheriv(
          "aes-256-gcm",
          this.#dataKey as Buffer,
          nonce(this.#prefix as Buffer, this.#counter, final),
        );
        decipher.setAAD(this.#aad as Buffer);
        decipher.setAuthTag(body.subarray(body.length - TAG_LENGTH));
        this.push(
          Buffer.concat([decipher.update(body.subarray(0, body.length - TAG_LENGTH)), decipher.final()]),
        );
      } catch {
        throw new DecryptionError();
      }
      this.#counter += 1;
      this.#finished = final;
    }
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    try {
      this.#buffer = Buffer.concat([this.#buffer, chunk]);
      if (!this.#header && !this.#readHeader()) {
        callback();
        return;
      }
      this.#readFrames();
      callback();
    } catch (error) {
      callback(error as Error);
    }
  }

  override _flush(callback: TransformCallback): void {
    this.#dataKey?.fill(0);
    callback(this.#finished && this.#buffer.length === 0 ? null : new DecryptionError());
  }
}

/** Encrypts a byte stream with a fresh data key wrapped by the current key of `keys`. */
export function createEncryptStream(
  keys: StreamKeys,
  options: { chunkSize?: number; associatedData?: Buffer } = {},
): Transform {
  return new EncryptStream(
    keys,
    options.chunkSize ?? DEFAULT_CHUNK_SIZE,
    options.associatedData ?? Buffer.alloc(0),
  );
}

/** Decrypts and authenticates a stream; fails if any part was changed, removed or appended. */
export function createDecryptStream(keys: StreamKeys, options: { associatedData?: Buffer } = {}): Transform {
  return new DecryptStream(keys, options.associatedData ?? Buffer.alloc(0));
}
