import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Secret } from "../config/secret.js";
import { EnvKeyProvider, FileKeyProvider } from "./key-provider.js";
import { formatKeyEntry, KeyRingError } from "./key-ring.js";

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("FileKeyProvider", () => {
  it("generates version 1 on first use and keeps it", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "pagehall-keys-"));
    const file = path.join(dir, "secrets", "master-keys");
    const provider = new FileKeyProvider(file);
    const first = await provider.load({ create: true });
    expect(first.versions).toEqual([1]);
    const again = await new FileKeyProvider(file).load();
    expect(again.get(1).use().equals(first.get(1).use())).toBe(true);
  });

  it("never creates a key unless asked to", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "pagehall-keys-"));
    const file = path.join(dir, "master-keys");
    await expect(new FileKeyProvider(file).load()).rejects.toThrow(
      `The master key ring ${file} does not exist`,
    );
    await expect(new FileKeyProvider(file).addVersion()).rejects.toThrow("does not exist");
    expect(existsSync(file)).toBe(false);
  });

  it("appends a new version and keeps the old ones", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "pagehall-keys-"));
    const provider = new FileKeyProvider(path.join(dir, "master-keys"));
    const first = await provider.load({ create: true });
    const rotated = await provider.addVersion();
    expect(rotated.versions).toEqual([1, 2]);
    expect(rotated.currentVersion).toBe(2);
    expect(rotated.get(1).use().equals(first.get(1).use())).toBe(true);
    expect(readFileSync(path.join(dir, "master-keys"), "utf8").trim().split("\n")).toHaveLength(2);
  });
});

describe("EnvKeyProvider", () => {
  it("reads the configured ring", async () => {
    const provider = new EnvKeyProvider(new Secret(formatKeyEntry(3, randomBytes(32))));
    expect((await provider.load()).currentVersion).toBe(3);
  });

  it("cannot add versions itself", async () => {
    const provider = new EnvKeyProvider(new Secret(formatKeyEntry(1, randomBytes(32))));
    await expect(provider.addVersion()).rejects.toThrow(KeyRingError);
  });
});
