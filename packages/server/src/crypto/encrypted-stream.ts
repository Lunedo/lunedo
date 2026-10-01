import type { Database } from "../database/database.js";

/** One item encrypted with the stream format under a master key, such as an attachment. */
export interface EncryptedStream {
  id: string;
  /** The first `STREAM_HEADER_LENGTH` bytes of the stream. */
  readHeader(): Promise<Buffer>;
  /** Replaces the header in place; the rest of the stream is left as it is. */
  writeHeader(header: Buffer): Promise<void>;
}

export interface EncryptedStreamContext {
  database: Database;
  filesDir: string;
}

/** A module that stores stream-encrypted data and lists it for key rotation. */
export interface EncryptedStreamOwner {
  name: string;
  streams(context: EncryptedStreamContext): AsyncIterable<EncryptedStream>;
}

/**
 * All owners of stream-encrypted data. Modules add their owner here together with the code
 * that writes such data, so that key rotation re-wraps it.
 */
export const encryptedStreamOwners: readonly EncryptedStreamOwner[] = [];
