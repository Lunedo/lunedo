import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { patchesOf, patchProblems, resolvedVersions } from "./patched-dependencies.ts";

const script = path.resolve(import.meta.dirname, "check-patches.ts");

const workspace = [
  "packages:",
  "  - apps/*",
  "",
  "overrides:",
  '  "left-pad>undici": ^7.0.0',
  "",
  "patchedDependencies:",
  '  "@scope/editor-binding@3.0.9": patches/@scope__editor-binding@3.0.9.patch',
  "  plain-lib@1.2.3: patches/plain-lib@1.2.3.patch",
  "",
].join("\n");

function lockfile(...versions: string[]): string {
  return [
    "lockfileVersion: '9.0'",
    "",
    "patchedDependencies:",
    "  '@scope/editor-binding@3.0.9': 0123abcd",
    "",
    "packages:",
    "",
    ...versions.flatMap((version) => [
      `  '@scope/editor-binding@${version}':`,
      "    resolution: {integrity: sha512-x}",
      "",
    ]),
    "snapshots:",
    "",
    "  '@scope/editor-binding@3.0.9(patch_hash=0123abcd)(yjs@13.6.33)':",
    "    dependencies: {}",
    "",
  ].join("\n");
}

const manifest = (file: string, dependencies: Record<string, string>, field = "dependencies") => ({
  file,
  content: JSON.stringify({ name: file, [field]: dependencies }),
});

const patch = {
  name: "@scope/editor-binding",
  version: "3.0.9",
  file: "patches/@scope__editor-binding@3.0.9.patch",
};

describe("patchesOf", () => {
  it("reads every patched dependency with its exact version and patch file", () => {
    assert.deepEqual(patchesOf(workspace), [
      patch,
      { name: "plain-lib", version: "1.2.3", file: "patches/plain-lib@1.2.3.patch" },
    ]);
  });

  it("finds nothing when no dependency is patched", () => {
    assert.deepEqual(patchesOf("packages:\n  - apps/*\n"), []);
  });
});

describe("resolvedVersions", () => {
  it("lists the versions the lockfile installs, ignoring snapshots and the patch list", () => {
    assert.deepEqual(resolvedVersions(lockfile("3.0.9", "3.1.0"), "@scope/editor-binding"), [
      "3.0.9",
      "3.1.0",
    ]);
    assert.deepEqual(resolvedVersions(lockfile("3.0.9"), "other"), []);
  });
});

describe("patchProblems", () => {
  it("accepts a dependency pinned to the patched version", () => {
    const manifests = [
      manifest("apps/web/package.json", { "@scope/editor-binding": "3.0.9" }),
      manifest("packages/schema/package.json", { "@scope/editor-binding": "3.0.9" }),
      manifest("packages/caret/package.json", { "@scope/editor-binding": "^3.0.7" }, "peerDependencies"),
    ];
    assert.deepEqual(patchProblems([patch], manifests, lockfile("3.0.9")), []);
  });

  it("reports a manifest that asks for another version or a range", () => {
    const problems = patchProblems(
      [patch],
      [
        manifest("apps/web/package.json", { "@scope/editor-binding": "3.0.10" }),
        manifest("packages/schema/package.json", { "@scope/editor-binding": "^3.0.9" }, "devDependencies"),
      ],
      lockfile("3.0.9"),
    );
    assert.equal(problems.length, 2);
    assert.match(problems[0] ?? "", /apps\/web\/package\.json asks for @scope\/editor-binding@3\.0\.10/);
    assert.match(problems[0] ?? "", /remove the patch or recreate it/);
    assert.match(
      problems[1] ?? "",
      /packages\/schema\/package\.json asks for @scope\/editor-binding@\^3\.0\.9/,
    );
  });

  it("reports a lockfile that installs an unpatched version", () => {
    const problems = patchProblems([patch], [], lockfile("3.0.9", "3.1.0"));
    assert.deepEqual(problems.length, 1);
    assert.match(
      problems[0] ?? "",
      /resolves @scope\/editor-binding@3\.1\.0, but the patch was made for 3\.0\.9/,
    );
  });

  it("reports a patch for a dependency that is no longer installed", () => {
    const problems = patchProblems([patch], [], lockfile());
    assert.match(problems[0] ?? "", /does not contain @scope\/editor-binding/);
  });
});

describe("check-patches", () => {
  const roots: string[] = [];
  after(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  function repository(version: string): string {
    const root = mkdtempSync(path.join(tmpdir(), "pagehall-patches-"));
    roots.push(root);
    mkdirSync(path.join(root, "apps", "web"), { recursive: true });
    mkdirSync(path.join(root, "packages"), { recursive: true });
    writeFileSync(path.join(root, "pnpm-workspace.yaml"), workspace);
    writeFileSync(path.join(root, "pnpm-lock.yaml"), lockfile(version));
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "root" }));
    writeFileSync(
      path.join(root, "apps", "web", "package.json"),
      JSON.stringify({
        name: "web",
        dependencies: { "@scope/editor-binding": version, "plain-lib": "1.2.3" },
      }),
    );
    return root;
  }

  it("passes while the patched version is installed", () => {
    const root = repository("3.0.9");
    writeFileSync(
      path.join(root, "pnpm-workspace.yaml"),
      workspace.replace("  plain-lib@1.2.3: patches/plain-lib@1.2.3.patch\n", ""),
    );
    const result = spawnSync(process.execPath, [script, root], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  });

  it("fails once the patched dependency is updated", () => {
    const result = spawnSync(process.execPath, [script, repository("3.0.10")], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /A patched dependency changed/);
    assert.match(result.stderr, /apps\/web\/package\.json asks for @scope\/editor-binding@3\.0\.10/);
  });
});
