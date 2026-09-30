import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Commit, commitsWithoutSignOff, parseGitLog } from "./dco.ts";

function commit(message: string): Commit {
  return { sha: "abc", authorName: "Ada Lovelace", authorEmail: "ada@example.org", message };
}

describe("commitsWithoutSignOff", () => {
  it("accepts a sign-off by the author", () => {
    const signed = commit("feat: add x\n\nSigned-off-by: Ada Lovelace <ada@example.org>");
    assert.deepEqual(commitsWithoutSignOff([signed]), []);
  });

  it("compares e-mail addresses case-insensitively", () => {
    const signed = commit("fix: y\n\nSigned-off-by: Ada Lovelace <Ada@Example.org>");
    assert.deepEqual(commitsWithoutSignOff([signed]), []);
  });

  it("rejects commits without sign-off", () => {
    const unsigned = commit("feat: add x");
    assert.deepEqual(commitsWithoutSignOff([unsigned]), [unsigned]);
  });

  it("rejects a sign-off by someone else", () => {
    const other = commit("feat: add x\n\nSigned-off-by: Someone <someone@example.org>");
    assert.deepEqual(commitsWithoutSignOff([other]), [other]);
  });

  it("rejects a sign-off that is not on its own line", () => {
    const inline = commit("feat: mention Signed-off-by: Ada Lovelace <ada@example.org> inline");
    assert.deepEqual(commitsWithoutSignOff([inline]), [inline]);
  });
});

describe("parseGitLog", () => {
  it("splits records and fields", () => {
    const output =
      "a1\x1fAda\x1fada@example.org\x1ffeat: one\n\nSigned-off-by: Ada <ada@example.org>\n\x1e\n" +
      "b2\x1fBob\x1fbob@example.org\x1ffix: two\n\x1e\n";
    const commits = parseGitLog(output);
    assert.equal(commits.length, 2);
    assert.equal(commits[0]?.sha, "a1");
    assert.equal(commits[1]?.authorEmail, "bob@example.org");
    assert.match(commits[0]?.message ?? "", /Signed-off-by/);
  });
});
