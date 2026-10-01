import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { pipeline } from "node:stream/promises";
import { describe, expect, it } from "vitest";
import { DecryptionError } from "./envelope.js";
import { formatKeyEntry, KeyRingError, parseKeyRing } from "./key-ring.js";
import {
  backupStreamKeys,
  createDecryptStream,
  createEncryptStream,
  masterStreamKeys,
  rewrapStreamHeader,
  STREAM_HEADER_LENGTH,
  type StreamKeys,
  streamMasterKeyVersion,
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
  const key1 = randomBytes(32);
  const key2 = randomBytes(32);
  const ring = (...entries: [number, Buffer][]) =>
    parseKeyRing(entries.map(([version, key]) => formatKeyEntry(version, key)).join("\n"));

  it("round-trip with the current backup key version", async () => {
    const data = randomBytes(200);
    const keys = backupStreamKeys(ring([1, key1]));
    expect((await decrypt(await encrypt(data, keys), keys)).equals(data)).toBe(true);
  });

  it("stay readable after a new version is added", async () => {
    const data = randomBytes(50);
    const ciphertext = await encrypt(data, backupStreamKeys(ring([1, key1])));
    const rotated = backupStreamKeys(ring([1, key1], [2, key2]));
    expect((await decrypt(ciphertext, rotated)).equals(data)).toBe(true);
  });

  it("report a missing version before decrypting", async () => {
    const ciphertext = await encrypt(randomBytes(20), backupStreamKeys(ring([2, key2])));
    await expect(decrypt(ciphertext, backupStreamKeys(ring([1, key1])))).rejects.toThrow(
      "Backup key version 2 is not available",
    );
  });

  it("report a different key under the same version", async () => {
    const ciphertext = await encrypt(randomBytes(20), backupStreamKeys(ring([1, key1])));
    await expect(decrypt(ciphertext, backupStreamKeys(ring([1, key2])))).rejects.toThrow("different key");
  });

  it("do not accept master key streams as backups", async () => {
    const ciphertext = await encrypt(randomBytes(20));
    await expect(decrypt(ciphertext, backupStreamKeys(ring([1, key1])))).rejects.toThrow(KeyRingError);
  });
});

describe("associated data", () => {
  async function roundTrip(written: Buffer, read: Buffer) {
    const ciphertext = await buffer(
      Readable.from([randomBytes(100)]).pipe(
        createEncryptStream(master, { chunkSize: 16, associatedData: written }),
      ),
    );
    const chunks: Buffer[] = [];
    await pipeline(
      Readable.from([ciphertext]),
      createDecryptStream(master, { associatedData: read }),
      async (source) => {
        for await (const chunk of source) chunks.push(chunk as Buffer);
      },
    );
    return Buffer.concat(chunks);
  }

  it("must match to decrypt", async () => {
    expect(await roundTrip(Buffer.from("header"), Buffer.from("header"))).toHaveLength(100);
    await expect(roundTrip(Buffer.from("header"), Buffer.from("headex"))).rejects.toThrow(DecryptionError);
    await expect(roundTrip(Buffer.from("header"), Buffer.alloc(0))).rejects.toThrow(DecryptionError);
  });
});

describe("rewrapStreamHeader", () => {
  const key1 = randomBytes(32);
  const key2 = randomBytes(32);
  const before = parseKeyRing(formatKeyEntry(1, key1));
  const after = parseKeyRing(`${formatKeyEntry(1, key1)}\n${formatKeyEntry(2, key2)}`);
  const onlyNew = parseKeyRing(formatKeyEntry(2, key2));

  async function encryptWith(ring: typeof before, data: Buffer) {
    return buffer(
      Readable.from([data]).pipe(
        createEncryptStream(
          masterStreamKeys(() => ring),
          { chunkSize: 16 },
        ),
      ),
    );
  }

  it("moves a stream to the current key version without touching its chunks", async () => {
    const data = randomBytes(100);
    const ciphertext = await encryptWith(before, data);
    expect(streamMasterKeyVersion(ciphertext)).toBe(1);

    const header = rewrapStreamHeader(
      ciphertext.subarray(0, STREAM_HEADER_LENGTH),
      masterStreamKeys(() => after),
    );
    expect(header).toHaveLength(STREAM_HEADER_LENGTH);
    expect(streamMasterKeyVersion(header)).toBe(2);
    const rotated = Buffer.concat([header, ciphertext.subarray(STREAM_HEADER_LENGTH)]);
    expect(rotated.subarray(STREAM_HEADER_LENGTH).equals(ciphertext.subarray(STREAM_HEADER_LENGTH))).toBe(
      true,
    );
    expect(
      (
        await decrypt(
          rotated,
          masterStreamKeys(() => onlyNew),
        )
      ).equals(data),
    ).toBe(true);
  });

  it("rejects a tampered header", async () => {
    const ciphertext = await encryptWith(before, randomBytes(20));
    const header = Buffer.from(ciphertext.subarray(0, STREAM_HEADER_LENGTH));
    header[40] = (header[40] ?? 0) ^ 0x01;
    expect(() =>
      rewrapStreamHeader(
        header,
        masterStreamKeys(() => after),
      ),
    ).toThrow(DecryptionError);
  });

  it("rejects a wrapped key taken from another stream", async () => {
    const first = await encryptWith(before, randomBytes(40));
    const second = await encryptWith(before, randomBytes(40));
    const mixed = Buffer.from(second);
    first.copy(mixed, 5, 5, 73);
    await expect(
      decrypt(
        mixed,
        masterStreamKeys(() => before),
      ),
    ).rejects.toThrow(DecryptionError);
  });

  it("reports no master key version for backup streams", async () => {
    const backupRing = parseKeyRing(formatKeyEntry(1, key1));
    const ciphertext = await encrypt(randomBytes(20), backupStreamKeys(backupRing));
    expect(streamMasterKeyVersion(ciphertext)).toBeUndefined();
  });
});
