import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findResourceRoot, resourcePath } from "./resources.js";

describe("server resources", () => {
  it("are found in the nearest folder that holds the migrations, however deep the code lies", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lunedo-resources-"));
    mkdirSync(path.join(root, "drizzle", "meta"), { recursive: true });
    writeFileSync(path.join(root, "drizzle", "meta", "_journal.json"), "{}");
    mkdirSync(path.join(root, "dist", "auth"), { recursive: true });

    expect(findResourceRoot(root)).toBe(root);
    expect(findResourceRoot(path.join(root, "dist", "auth"))).toBe(root);
  });

  it("name the folder when they are missing", () => {
    const empty = mkdtempSync(path.join(tmpdir(), "lunedo-no-resources-"));
    expect(() => findResourceRoot(empty)).toThrow(/drizzle\/ and data\//);
  });

  it("resolve the shipped data and migrations from the source tree", () => {
    const server = path.resolve(import.meta.dirname, "..");
    expect(resourcePath("data", "common-passwords.txt")).toBe(
      path.join(server, "data", "common-passwords.txt"),
    );
    expect(resourcePath("drizzle")).toBe(path.join(server, "drizzle"));
  });
});
