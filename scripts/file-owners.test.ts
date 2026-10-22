import assert from "node:assert/strict";
import type { Dirent } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { foreignEntries, foreignReport, type OwnerFileSystem } from "./file-owners.ts";

type Tree = { [name: string]: Tree | number };
type Node = { uid: number; tree?: Tree };

function fakeFileSystem(root: string, uid: number, tree: Tree): OwnerFileSystem & { listed: string[] } {
  const listed: string[] = [];
  const find = (target: string): Node => {
    const parts = path.relative(root, target).split(path.sep).filter(Boolean);
    let node: Node = { uid, tree };
    for (const part of parts) {
      const child: Tree | number | undefined = node.tree?.[part];
      if (child === undefined) throw new Error(`ENOENT: ${target}`);
      node =
        typeof child === "number"
          ? { uid: child }
          : { uid: (child[".uid"] as number | undefined) ?? uid, tree: child };
    }
    return node;
  };
  return {
    listed,
    uid: (target) => find(target).uid,
    children: (target) => {
      listed.push(target);
      return Object.entries(find(target).tree ?? {})
        .filter(([name]) => name !== ".uid")
        .map(([name, value]) => ({ name, isDirectory: () => typeof value !== "number" }) as Dirent);
    },
  };
}

const workspace = path.join(path.sep, "work", "lunedo");

describe("foreignEntries", () => {
  it("finds nothing when everything belongs to the runner user", () => {
    const fs = fakeFileSystem(workspace, 1001, { apps: { web: { "index.ts": 1001 } }, ".cache": {} });
    assert.deepEqual(foreignEntries([workspace], 1001, 20, fs), []);
  });

  it("reports files and directories of another user, also deep below the root", () => {
    const fs = fakeFileSystem(workspace, 1001, {
      ".cache": { ".uid": 0, drawio: { "app.min.js": 0 } },
      apps: { web: { dist: { drawio: { "index.html": 0 } } } },
    });
    const found = foreignEntries([workspace], 1001, 20, fs);
    assert.deepEqual(found.map((entry) => [path.relative(workspace, entry.path), entry.uid]).sort(), [
      [".cache", 0],
      [path.join("apps", "web", "dist", "drawio", "index.html"), 0],
    ]);
  });

  it("does not descend into a directory of another user, which it may not be able to read", () => {
    const fs = fakeFileSystem(workspace, 1001, { ".cache": { ".uid": 0, drawio: { "app.min.js": 0 } } });
    foreignEntries([workspace], 1001, 20, fs);
    assert.deepEqual(fs.listed, [workspace]);
  });

  it("checks every root, so a cache directory counts as well", () => {
    const cache = path.join(workspace, "cache");
    const fs = fakeFileSystem(workspace, 1001, {
      src: { "main.ts": 1001 },
      cache: { e2e: { "pnpm-store": { "index.json": 0 } } },
    });
    const found = foreignEntries([path.join(workspace, "src"), cache], 1001, 20, fs);
    assert.equal(found.length, 1);
    assert.equal(found[0]?.path, path.join(cache, "e2e", "pnpm-store", "index.json"));
  });

  it("stops after the limit", () => {
    const fs = fakeFileSystem(workspace, 1001, { a: 0, b: 0, c: 0, d: 0 });
    assert.equal(foreignEntries([workspace], 1001, 2, fs).length, 2);
  });
});

describe("foreignReport", () => {
  it("names each entry with its owner and says what to do", () => {
    const report = foreignReport([{ path: "/work/lunedo/.cache", uid: 0 }], 1001);
    assert.match(report, /^One entry belongs to another user than 1001/);
    assert.match(report, /Run containers with the runner's UID and GID/);
    assert.match(report, /\/work\/lunedo\/\.cache \(UID 0\)/);
  });
});
