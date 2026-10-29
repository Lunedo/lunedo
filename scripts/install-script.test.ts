import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const script = path.join(root, "scripts", "install.sh");

function run(args: string[], extraPath?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env, MSYS_NO_PATHCONV: "1" };
  if (extraPath) env.PATH = `${extraPath}${path.delimiter}${process.env.PATH ?? ""}`;
  return spawnSync("bash", [script, ...args], { encoding: "utf8", env });
}

function onMacos(): string {
  const bin = mkdtempSync(path.join(tmpdir(), "lunedo-macos-"));
  writeFileSync(path.join(bin, "uname"), "#!/bin/sh\necho Darwin\n", { mode: 0o755 });
  return bin;
}

function documented(): string {
  const docs = readFileSync(path.join(root, "docs", "admin", "installation", "compose.md"), "utf8");
  const start = docs.indexOf("<!-- compose-file -->\n```yaml\n");
  assert.ok(start >= 0, "docs/admin/installation/compose.md has no marked Compose file");
  const body = docs.slice(start + "<!-- compose-file -->\n```yaml\n".length);
  return body.slice(0, body.indexOf("```"));
}

describe("install.sh", () => {
  it("writes the Compose file that docs/admin/installation/compose.md shows", () => {
    const printed = run(["print-compose"]);
    assert.equal(printed.status, 0, printed.stderr);
    assert.equal(printed.stdout, documented());
    assert.match(printed.stdout, /image: ghcr\.io\/lunedo\/lunedo:<version>\n/);
    assert.match(printed.stdout, /LUNEDO_SETUP_CODE: \$\{LUNEDO_SETUP_CODE:-\}/);
    assert.match(printed.stdout, /LUNEDO_INSTANCE_URL: \$\{LUNEDO_INSTANCE_URL:-\}/);
    assert.match(
      printed.stdout,
      /\n {2}postgres:\n {4}image: postgres:17-alpine\n {4}restart: unless-stopped\n {4}shm_size: 1gb\n/,
    );
  });

  it("refuses versions, ports and options it does not know", () => {
    assert.match(run(["update", "next"]).stderr, /next is not a version like 1\.4\.2/);
    assert.match(run(["install", "--port", "99999"]).stderr, /99999 is not a port number/);
    assert.match(run(["install", "--unknown"]).stderr, /Unknown option --unknown/);
    assert.match(run(["update", "1.4.2", "1.5.0"]).stderr, /Unexpected argument 1\.5\.0/);
  });

  it("changes nothing in an existing installation and points to the update command", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "lunedo-installed-"));
    writeFileSync(path.join(directory, ".env"), "LUNEDO_MASTER_KEYS=1:kept\n");
    writeFileSync(path.join(directory, ".lunedo-install"), "method=script\nversion=1.4.2\n");
    const result = run(["install", "--dir", directory, "--yes"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Lunedo is already installed in .* \(version 1\.4\.2\)/);
    assert.match(result.stdout, /lunedo update/);
    assert.equal(readFileSync(path.join(directory, ".env"), "utf8"), "LUNEDO_MASTER_KEYS=1:kept\n");
  });

  it("refuses every command on macOS and points to the development docs", () => {
    const bin = onMacos();
    const directory = mkdtempSync(path.join(tmpdir(), "lunedo-macos-target-"));
    for (const args of [
      ["install", "--dir", directory, "--yes"],
      ["update", "--dir", directory, "--yes"],
      ["backup", "list"],
      ["print-compose"],
    ]) {
      const result = run(args, bin);
      assert.equal(result.status, 1, args.join(" "));
      assert.match(result.stderr, /Lunedo runs on Linux only, and this host runs macOS/);
      assert.match(result.stderr, /docs\/development/);
      assert.equal(result.stdout, "");
    }
    assert.equal(run(["help"], bin).status, 0);
  });

  it("installs into /opt/lunedo by default", () => {
    assert.match(
      run(["help"]).stdout,
      /--dir <directory> +Installation directory \(default \/opt\/lunedo\)\n/,
    );
  });

  it("refuses to update a directory without an installation", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "lunedo-empty-"));
    assert.match(run(["update", "--dir", directory, "--yes"]).stderr, /is not a Lunedo installation/);
  });
});
