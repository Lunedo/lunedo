import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureSecretFile, generateKey, generateToken } from "./generated-secrets.js";

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("ensureSecretFile", () => {
  it("generates a secret once and returns the stored value afterwards", () => {
    dir = mkdtempSync(path.join(tmpdir(), "pagehall-secrets-"));
    const secretsDir = path.join(dir, "secrets");
    const first = ensureSecretFile(secretsDir, "backup-key", generateKey);
    const second = ensureSecretFile(secretsDir, "backup-key", () => "other");
    expect(second.reveal()).toBe(first.reveal());
    expect(readFileSync(path.join(secretsDir, "backup-key"), "utf8").trim()).toBe(first.reveal());
    expect(readdirSync(secretsDir)).toEqual(["backup-key"]);
  });

  it("keeps the first value when several callers race", () => {
    dir = mkdtempSync(path.join(tmpdir(), "pagehall-secrets-"));
    const values = Array.from({ length: 5 }, (_, i) =>
      ensureSecretFile(dir as string, "token", () => `v${i}`),
    );
    expect(new Set(values.map((value) => value.reveal()))).toEqual(new Set(["v0"]));
  });

  it.skipIf(process.platform === "win32")("restricts file permissions to the owner", () => {
    dir = mkdtempSync(path.join(tmpdir(), "pagehall-secrets-"));
    ensureSecretFile(dir, "token", generateToken);
    expect(statSync(path.join(dir, "token")).mode & 0o777).toBe(0o600);
  });
});

describe("generators", () => {
  it("create 256-bit random values", () => {
    expect(Buffer.from(generateKey(), "base64")).toHaveLength(32);
    expect(Buffer.from(generateToken(), "base64url")).toHaveLength(32);
    expect(generateKey()).not.toBe(generateKey());
  });
});
