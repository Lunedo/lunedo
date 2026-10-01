import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { findPrivateReferences } from "./private-references.ts";

const script = path.resolve(import.meta.dirname, "check-private-references.ts");
const adr = (number: string) => `ADR ${number}`;
const folder = (name: string) => `_${name}`;

describe("findPrivateReferences", () => {
  it("finds decision records and private folders with their line", () => {
    const content = [
      "first line",
      `see ${adr("0028")} for details`,
      `copied from ${folder("Prompts")}/task`,
    ].join("\n");
    assert.deepEqual(findPrivateReferences(content), [
      { line: 2, text: adr("0028") },
      { line: 3, text: folder("Prompts") },
    ]);
    assert.equal(
      findPrivateReferences(`${folder("ADRs")} ${folder("Docs")} ${folder("Testdata")}`).length,
      3,
    );
    assert.equal(findPrivateReferences(`${"ADR"}-0011 and ${adr("0013")}`).length, 2);
  });

  it("ignores other text", () => {
    assert.deepEqual(findPrivateReferences("ADR without a number, docs/ and prompts"), []);
  });
});

describe("check-private-references", () => {
  const repo = mkdtempSync(path.join(tmpdir(), "pagehall-references-"));
  after(() => rmSync(repo, { recursive: true, force: true }));
  execFileSync("git", ["init", "--quiet", repo]);
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [script, ...args], { cwd: repo, encoding: "utf8" });

  it("checks staged files and tracked files", () => {
    writeFileSync(path.join(repo, "clean.ts"), "export const x = 1;\n");
    execFileSync("git", ["-C", repo, "add", "clean.ts"]);
    assert.equal(run("--staged").status, 0);
    writeFileSync(path.join(repo, "leak.md"), `Decided in ${adr("0021")}.\n`);
    execFileSync("git", ["-C", repo, "add", "leak.md"]);
    const staged = run("--staged");
    assert.equal(staged.status, 1);
    assert.ok(staged.stderr.includes(`leak.md:1: ${adr("0021")}`));
    assert.equal(run().status, 1);
  });

  it("checks commit messages", () => {
    const message = path.join(repo, "MESSAGE");
    writeFileSync(message, "fix: follow the decision\n");
    assert.equal(run("--message", message).status, 0);
    writeFileSync(message, `fix: follow ${adr("0011")}\n`);
    assert.equal(run("--message", message).status, 1);
  });
});
