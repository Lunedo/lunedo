import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SHELLCHECK_IMAGE, shellcheckArguments, shellScripts } from "./shell-scripts.ts";

describe("shellScripts", () => {
  it("checks every tracked shell script and nothing else", () => {
    assert.deepEqual(shellScripts(["scripts/install.sh", "docker/start.sh", "README.md", "scripts/a.ts"]), [
      "docker/start.sh",
      "scripts/install.sh",
    ]);
  });

  it("runs a pinned shellcheck image on a read-only copy of the repository", () => {
    assert.match(SHELLCHECK_IMAGE, /@sha256:[0-9a-f]{64}$/);
    assert.deepEqual(shellcheckArguments("/repo", ["docker/start.sh"]), [
      "run",
      "--rm",
      "-v",
      "/repo:/mnt:ro",
      "-w",
      "/mnt",
      SHELLCHECK_IMAGE,
      "--severity=style",
      "docker/start.sh",
    ]);
  });
});
