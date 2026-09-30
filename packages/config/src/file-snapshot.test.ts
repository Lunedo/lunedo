import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { snapshot } from "./file-snapshot.js";

let root: string | undefined;

function fixture(): string {
  root = mkdtempSync(path.join(tmpdir(), "pagehall-snapshot-"));
  mkdirSync(path.join(root, "src", "nested"), { recursive: true });
  mkdirSync(path.join(root, "src", "node_modules"));
  writeFileSync(path.join(root, "src", "a.ts"), "a");
  writeFileSync(path.join(root, "src", "nested", "b.ts"), "b");
  return root;
}

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("snapshot", () => {
  it("is stable while nothing changes", () => {
    const dir = fixture();
    expect(snapshot([path.join(dir, "src")])).toBe(snapshot([path.join(dir, "src")]));
  });

  it("changes when a nested file changes", () => {
    const dir = fixture();
    const before = snapshot([path.join(dir, "src")]);
    const file = path.join(dir, "src", "nested", "b.ts");
    writeFileSync(file, "bb");
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    expect(snapshot([path.join(dir, "src")])).not.toBe(before);
  });

  it("changes when a file is added or removed", () => {
    const dir = fixture();
    const before = snapshot([path.join(dir, "src")]);
    writeFileSync(path.join(dir, "src", "c.ts"), "c");
    const added = snapshot([path.join(dir, "src")]);
    expect(added).not.toBe(before);
    rmSync(path.join(dir, "src", "c.ts"));
    expect(snapshot([path.join(dir, "src")])).toBe(before);
  });

  it("ignores node_modules and missing directories", () => {
    const dir = fixture();
    const before = snapshot([path.join(dir, "src"), path.join(dir, "missing")]);
    writeFileSync(path.join(dir, "src", "node_modules", "x.js"), "x");
    expect(snapshot([path.join(dir, "src"), path.join(dir, "missing")])).toBe(before);
  });
});
