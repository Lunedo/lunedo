import { chmodSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkFileStorage } from "./steps.js";

const unixUser = process.getuid !== undefined && process.getuid() !== 0;

describe("checkFileStorage", () => {
  it("passes for a writable directory and reports its facts", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "pagehall-check-"));
    const result = await checkFileStorage(directory);
    expect(result).toMatchObject({
      cause: null,
      fixCommand: null,
      docs: "setup.md#file-storage",
      path: directory,
      exists: true,
      writable: true,
    });
    expect(result.freeBytes).toBeGreaterThan(0);
  });

  it("explains a missing directory and how to create it", async () => {
    const directory = path.join(mkdtempSync(path.join(tmpdir(), "pagehall-check-")), "files dir");
    const result = await checkFileStorage(directory);
    expect(result).toMatchObject({ status: "error", cause: "missing", exists: false, writable: false });
    expect(result.fixCommand).toContain(`mkdir -p '${directory}'`);
    if (process.getuid) {
      expect(result.fixCommand).toContain(`chown ${process.getuid()}:${process.getgid?.()} '${directory}'`);
    }
  });

  it.skipIf(!unixUser)("names the owner and the command when the directory is not writable", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "pagehall-check-"));
    chmodSync(directory, 0o500);
    try {
      const result = await checkFileStorage(directory);
      expect(result).toMatchObject({
        status: "error",
        cause: "notWritable",
        exists: true,
        writable: false,
        processUid: process.getuid?.(),
        ownerUid: process.getuid?.(),
        fixCommand: `chown -R ${process.getuid?.()}:${process.getgid?.()} ${directory}`,
      });
    } finally {
      chmodSync(directory, 0o700);
    }
  });
});
