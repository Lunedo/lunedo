import { randomBytes } from "node:crypto";
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { secretsEqual } from "./constant-time.js";
import { DecryptionError, Encryption } from "./envelope.js";
import { formatKeyEntry, KeyRing, KeyRingError, parseKeyRing, SecretKey } from "./key-ring.js";

function ring(...versions: [number, Buffer][]): KeyRing {
  return parseKeyRing(versions.map(([version, key]) => formatKeyEntry(version, key)).join("\n"));
}

const key1 = randomBytes(32);
const key2 = randomBytes(32);

describe("parseKeyRing", () => {
  it("reads versions and uses the highest as current", () => {
    const keyRing = parseKeyRing(`# comment\n${formatKeyEntry(2, key2)}\n\n${formatKeyEntry(1, key1)}`);
    expect(keyRing.versions).toEqual([1, 2]);
    expect(keyRing.currentVersion).toBe(2);
    expect(keyRing.get(1).use().equals(key1)).toBe(true);
  });

  it("accepts comma-separated entries", () => {
    expect(parseKeyRing(`${formatKeyEntry(1, key1)},${formatKeyEntry(2, key2)}`).versions).toEqual([1, 2]);
  });

  it.each([
    ["an empty ring", ""],
    ["a malformed entry", "one:abc"],
    ["a short key", `1:${randomBytes(16).toString("base64")}`],
    ["a duplicate version", `${formatKeyEntry(1, key1)}\n${formatKeyEntry(1, key2)}`],
    ["version zero", formatKeyEntry(0, key1)],
  ])("rejects %s", (_name, text) => {
    expect(() => parseKeyRing(text)).toThrow(KeyRingError);
  });

  it("never exposes key material", () => {
    const keyRing = ring([1, key1]);
    const secret = new SecretKey(key1);
    const printed = [
      String(keyRing),
      JSON.stringify(keyRing),
      inspect(keyRing),
      String(secret),
      JSON.stringify({ secret }),
      inspect({ secret }),
    ].join(" ");
    expect(printed).not.toContain(key1.toString("base64"));
    expect(printed).not.toContain(key1.toString("hex"));

    let message = "";
    try {
      parseKeyRing(`1:${key1.toString("base64")}\n1:${key1.toString("base64")}`);
    } catch (error) {
      message = String(error);
    }
    expect(message).not.toContain(key1.toString("base64"));
  });
});

describe("Encryption", () => {
  const encryption = new Encryption(() => ring([1, key1]));

  it("round-trips values and uses a fresh data key each time", () => {
    const a = encryption.encrypt("smtp password", "smtp:1");
    const b = encryption.encrypt("smtp password", "smtp:1");
    expect(a.equals(b)).toBe(false);
    expect(encryption.decryptString(a, "smtp:1")).toBe("smtp password");
    expect(encryption.decrypt(encryption.encrypt(Buffer.alloc(0), "empty"), "empty")).toHaveLength(0);
  });

  it("records the key version in the envelope", () => {
    expect(encryption.keyVersionOf(encryption.encrypt("x", "c"))).toBe(1);
    const newer = new Encryption(() => ring([1, key1], [2, key2]));
    expect(newer.keyVersionOf(newer.encrypt("x", "c"))).toBe(2);
  });

  it("rejects a value decrypted in another context", () => {
    const envelope = encryption.encrypt("secret", "table:row-1");
    expect(() => encryption.decrypt(envelope, "table:row-2")).toThrow(DecryptionError);
  });

  it.each([
    ["the magic", 0],
    ["the format version", 3],
    ["the wrap IV", 10],
    ["the wrapped data key", 30],
    ["the wrap tag", 60],
    ["the data IV", 70],
    ["the ciphertext", 82],
  ])("rejects a modified byte in %s", (_part, offset) => {
    const envelope = encryption.encrypt("secret value", "c");
    const tampered = Buffer.from(envelope);
    tampered[offset] = (tampered[offset] ?? 0) ^ 0x01;
    expect(() => encryption.decrypt(tampered, "c")).toThrow(DecryptionError);
  });

  it("rejects a modified data tag and truncated values", () => {
    const envelope = encryption.encrypt("secret value", "c");
    const tampered = Buffer.from(envelope);
    tampered[tampered.length - 1] = (tampered.at(-1) ?? 0) ^ 0x01;
    expect(() => encryption.decrypt(tampered, "c")).toThrow(DecryptionError);
    expect(() => encryption.decrypt(envelope.subarray(0, envelope.length - 1), "c")).toThrow(DecryptionError);
    expect(() => encryption.decrypt(envelope.subarray(0, 40), "c")).toThrow(DecryptionError);
  });

  it("rejects an unknown key version", () => {
    const envelope = Buffer.from(encryption.encrypt("secret", "c"));
    envelope.writeUInt32BE(7, 4);
    expect(() => encryption.decrypt(envelope, "c")).toThrow("Master key version 7 is not available");
  });

  it("rejects a key version changed to another existing version", () => {
    const both = new Encryption(() => ring([1, key1], [2, key2]));
    const envelope = Buffer.from(both.encrypt("secret", "c"));
    envelope.writeUInt32BE(1, 4);
    expect(() => both.decrypt(envelope, "c")).toThrow(DecryptionError);
  });

  it("rejects the wrong key under the same version", () => {
    const envelope = encryption.encrypt("secret", "c");
    const other = new Encryption(() => ring([1, randomBytes(32)]));
    expect(() => other.decrypt(envelope, "c")).toThrow(DecryptionError);
  });

  it("never includes plaintext or keys in errors", () => {
    const envelope = encryption.encrypt("very secret value", "c");
    let message = "";
    try {
      encryption.decrypt(envelope, "other");
    } catch (error) {
      message = `${String(error)} ${inspect(error)}`;
    }
    expect(message).not.toContain("very secret value");
    expect(message).not.toContain(key1.toString("base64"));
  });
});

describe("rewrap", () => {
  it("moves a value to the current key version without changing the encrypted data", () => {
    let keyRing = ring([1, key1]);
    const encryption = new Encryption(() => keyRing);
    const original = encryption.encrypt("rotate me", "c");

    keyRing = ring([1, key1], [2, key2]);
    const rewrapped = encryption.rewrap(original);
    expect(encryption.keyVersionOf(rewrapped)).toBe(2);
    expect(rewrapped.subarray(68).equals(original.subarray(68))).toBe(true);
    expect(encryption.decryptString(rewrapped, "c")).toBe("rotate me");
    expect(encryption.decryptString(original, "c")).toBe("rotate me");

    keyRing = ring([2, key2]);
    expect(encryption.decryptString(rewrapped, "c")).toBe("rotate me");
    expect(() => encryption.decrypt(original, "c")).toThrow(KeyRingError);
  });

  it("returns values that already use the current version unchanged", () => {
    const encryption = new Encryption(() => ring([1, key1]));
    const envelope = encryption.encrypt("x", "c");
    expect(encryption.rewrap(envelope)).toBe(envelope);
  });

  it("rejects a tampered envelope", () => {
    const encryption = new Encryption(() => ring([1, key1], [2, key2]));
    const envelope = Buffer.from(new Encryption(() => ring([1, key1])).encrypt("x", "c"));
    envelope[30] = (envelope[30] ?? 0) ^ 0x01;
    expect(() => encryption.rewrap(envelope)).toThrow(DecryptionError);
  });
});

describe("secretsEqual", () => {
  it("compares values of any length", () => {
    expect(secretsEqual("token", "token")).toBe(true);
    expect(secretsEqual("token", "tokem")).toBe(false);
    expect(secretsEqual("short", "a much longer token")).toBe(false);
    expect(secretsEqual("", "")).toBe(true);
  });
});
