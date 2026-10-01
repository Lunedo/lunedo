import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { pipeline } from "node:stream/promises";
import { describe, expect, it } from "vitest";
import { DecryptionError } from "./envelope.js";
import { formatKeyEntry, KeyRingError, parseKeyRing, SecretKey } from "./key-ring.js";
import {
  backupStreamKeys,
  createDecryptStream,
  createEncryptStream,
  masterStreamKeys,
  type StreamKeys,
} from "./stream.js";

const HEADER = 84;
const masterRing = parseKeyRing(formatKeyEntry(1, randomBytes(32)));
const master = masterStreamKeys(() => masterRing);

async function encrypt(data: Buffer, keys: StreamKeys = master, chunkSize = 16): Promise<Buffer> {
  return buffer(Readable.from(splitRandomly(data)).pipe(createEncryptStream(keys, { chunkSize })));
}

async function decrypt(data: Buffer, keys: StreamKeys = master): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await pipeline(Readable.from(splitRandomly(data)), createDecryptStream(keys), async (source) => {
    for await (const chunk of source) chunks.push(chunk as Buffer);
  });
  return Buffer.concat(chunks);
}

/** Feeds the stream in uneven pieces to exercise buffering. */
function splitRandomly(data: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  for (let offset = 0; offset < data.length; ) {
    const size = 1 + Math.floor(Math.random() * 40);
    parts.push(data.subarray(offset, offset + size));
    offset += size;
  }
  return parts;
}

/** Offsets of the frames: [flag offset, frame length] for each chunk. */
function frames(ciphertext: Buffer): [number, number][] {
  const result: [number, number][] = [];
  for (let offset = HEADER; offset < ciphertext.length; ) {
    const length = 5 + ciphertext.readUInt32BE(offset + 1);
    result.push([offset, length]);
    offset += length;
  }
  return result;
}

describe("stream encryption", () => {
  it.each([0, 1, 15, 16, 17, 100, 1000])("round-trips %i bytes", async (size) => {
    const data = randomBytes(size);
    expect((await decrypt(await encrypt(data))).equals(data)).toBe(true);
  });

  it("handles large data with the default chunk size", async () => {
    const data = randomBytes(300 * 1024);
    const ciphertext = await buffer(Readable.from([data]).pipe(createEncryptStream(master)));
    expect((await decrypt(ciphertext)).equals(data)).toBe(true);
  });

  it("uses a fresh data key and nonce prefix per stream", async () => {
    const data = randomBytes(50);
    expect((await encrypt(data)).equals(await encrypt(data))).toBe(false);
  });

  it.each([
    ["the header magic", 1],
    ["the key ID", 8],
    ["the wrapped data key", 30],
    ["the nonce prefix", 75],
    ["the chunk size", 83],
    ["the first chunk", HEADER + 10],
  ])("rejects a modified byte in %s", async (_part, offset) => {
    const ciphertext = await encrypt(randomBytes(100));
    ciphertext[offset] = (ciphertext[offset] ?? 0) ^ 0x01;
    await expect(decrypt(ciphertext)).rejects.toThrow(DecryptionError);
  });

  it("rejects truncated streams", async () => {
    const ciphertext = await encrypt(randomBytes(100));
    const [last] = frames(ciphertext).slice(-1);
    await expect(decrypt(ciphertext.subarray(0, last?.[0]))).rejects.toThrow(DecryptionError);
    await expect(decrypt(ciphertext.subarray(0, ciphertext.length - 3))).rejects.toThrow(DecryptionError);
    await expect(decrypt(ciphertext.subarray(0, 40))).rejects.toThrow(DecryptionError);
  });

  it("rejects appended data", async () => {
    const ciphertext = await encrypt(randomBytes(40));
    await expect(decrypt(Buffer.concat([ciphertext, Buffer.from([0, 0, 0, 0, 16])]))).rejects.toThrow(
      DecryptionError,
    );
  });

  it("rejects reordered and dropped chunks", async () => {
    const ciphertext = await encrypt(randomBytes(64));
    const [first, second, ...rest] = frames(ciphertext).map(([offset, length]) =>
      ciphertext.subarray(offset, offset + length),
    );
    const header = ciphertext.subarray(0, HEADER);
    await expect(
      decrypt(Buffer.concat([header, second as Buffer, first as Buffer, ...rest])),
    ).rejects.toThrow(DecryptionError);
    await expect(decrypt(Buffer.concat([header, second as Buffer, ...rest]))).rejects.toThrow(
      DecryptionError,
    );
  });

  it("rejects a chunk marked as final that is not", async () => {
    const ciphertext = await encrypt(randomBytes(64));
    const [first] = frames(ciphertext);
    const tampered = Buffer.from(ciphertext);
    tampered[first?.[0] ?? HEADER] = 1;
    await expect(decrypt(tampered)).rejects.toThrow(DecryptionError);
  });

  it("rejects the wrong key with the same version", async () => {
    const ciphertext = await encrypt(randomBytes(40));
    const other = masterStreamKeys(() => parseKeyRing(formatKeyEntry(1, randomBytes(32))));
    await expect(decrypt(ciphertext, other)).rejects.toThrow(DecryptionError);
  });

  it("rejects an unknown key version", async () => {
    const ciphertext = await encrypt(randomBytes(40));
    const other = masterStreamKeys(() => parseKeyRing(formatKeyEntry(2, randomBytes(32))));
    await expect(decrypt(ciphertext, other)).rejects.toThrow("Master key version 1 is not available");
  });
});

describe("backup keys", () => {
  const backupKey = new SecretKey(randomBytes(32));

  it("round-trips with the backup key", async () => {
    const data = randomBytes(200);
    const keys = backupStreamKeys(backupKey);
    expect((await decrypt(await encrypt(data, keys), keys)).equals(data)).toBe(true);
  });

  it("reports a different backup key before decrypting", async () => {
    const ciphertext = await encrypt(randomBytes(20), backupStreamKeys(backupKey));
    const other = backupStreamKeys(new SecretKey(randomBytes(32)));
    await expect(decrypt(ciphertext, other)).rejects.toThrow("different backup key");
  });

  it("does not accept master key streams as backups", async () => {
    const ciphertext = await encrypt(randomBytes(20));
    await expect(decrypt(ciphertext, backupStreamKeys(backupKey))).rejects.toThrow(KeyRingError);
  });
});
