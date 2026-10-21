import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const script = path.join(root, "scripts", "install.sh");

function run(args: string[]) {
  return spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, MSYS_NO_PATHCONV: "1" },
  });
}

function documented(): string {
  const docs = readFileSync(path.join(root, "docs", "setup.md"), "utf8");
  const start = docs.indexOf("<!-- compose-file -->\n```yaml\n");
  assert.ok(start >= 0, "docs/setup.md has no marked Compose file");
  const body = docs.slice(start + "<!-- compose-file -->\n```yaml\n".length);
  return body.slice(0, body.indexOf("```"));
}

describe("install.sh", () => {
  it("writes the Compose file that docs/setup.md shows", () => {
    const printed = run(["print-compose"]);
    assert.equal(printed.status, 0, printed.stderr);
    assert.equal(printed.stdout, documented());
    assert.match(printed.stdout, /image: ghcr\.io\/pagehall\/pagehall:<version>\n/);
    assert.match(printed.stdout, /PAGEHALL_SETUP_CODE: \$\{PAGEHALL_SETUP_CODE:-\}/);
    assert.match(printed.stdout, /PAGEHALL_INSTANCE_URL: \$\{PAGEHALL_INSTANCE_URL:-\}/);
  });

  it("refuses versions, ports and options it does not know", () => {
    assert.match(run(["update", "next"]).stderr, /next is not a version like 1\.4\.2/);
    assert.match(run(["install", "--port", "99999"]).stderr, /99999 is not a port number/);
    assert.match(run(["install", "--unknown"]).stderr, /Unknown option --unknown/);
    assert.match(run(["update", "1.4.2", "1.5.0"]).stderr, /Unexpected argument 1\.5\.0/);
  });

  it("changes nothing in an existing installation and points to the update command", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "pagehall-installed-"));
    writeFileSync(path.join(directory, ".env"), "PAGEHALL_MASTER_KEYS=1:kept\n");
    writeFileSync(path.join(directory, ".pagehall-install"), "method=script\nversion=1.4.2\n");
    const result = run(["install", "--dir", directory, "--yes"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Pagehall is already installed in .* \(version 1\.4\.2\)/);
    assert.match(result.stdout, /pagehall update/);
    assert.equal(readFileSync(path.join(directory, ".env"), "utf8"), "PAGEHALL_MASTER_KEYS=1:kept\n");
  });

  it("refuses to update a directory without an installation", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "pagehall-empty-"));
    assert.match(run(["update", "--dir", directory, "--yes"]).stderr, /is not a Pagehall installation/);
  });
});
