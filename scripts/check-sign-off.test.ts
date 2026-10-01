import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const script = path.resolve(import.meta.dirname, "check-sign-off.ts");
const repo = mkdtempSync(path.join(tmpdir(), "pagehall-sign-off-"));
execFileSync("git", ["init", "--quiet", repo]);
execFileSync("git", ["-C", repo, "config", "user.name", "Ada Lovelace"]);
execFileSync("git", ["-C", repo, "config", "user.email", "ada@example.org"]);

after(() => rmSync(repo, { recursive: true, force: true }));

function check(message: string) {
  const file = path.join(repo, "COMMIT_EDITMSG");
  writeFileSync(file, message);
  const env = { ...process.env };
  delete env.GIT_AUTHOR_NAME;
  delete env.GIT_AUTHOR_EMAIL;
  return spawnSync(process.execPath, [script, file], { cwd: repo, encoding: "utf8", env });
}

describe("commit-msg hook", () => {
  it("accepts a sign-off by the author", () => {
    assert.equal(check("feat: add x\n\nSigned-off-by: Ada Lovelace <ada@example.org>\n").status, 0);
  });

  it("rejects a commit without sign-off and names the author", () => {
    const result = check("feat: add x\n");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no Signed-off-by line for Ada Lovelace <ada@example\.org>/);
  });

  it("rejects a sign-off by someone else", () => {
    assert.equal(check("feat: add x\n\nSigned-off-by: Someone <someone@example.org>\n").status, 1);
  });
});
