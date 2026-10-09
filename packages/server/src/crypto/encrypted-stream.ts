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
  versions?(context: EncryptedStreamContext): Promise<Record<number, number>>;
  streams(context: EncryptedStreamContext, targetVersion?: number): AsyncIterable<EncryptedStream>;
}
