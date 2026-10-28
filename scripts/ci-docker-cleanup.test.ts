import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "ci-docker-cleanup.sh");
const image =
  "curlimages/curl:8.18.0@sha256:d94d07ba9e7d6de898b6d96c1a072f6f8266c687af78a74f380087a0addf5d17";

function docker(...args: string[]) {
  return spawnSync("docker", args, { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
}

function cleanup(...args: string[]) {
  return spawnSync("bash", [script, ...args], { encoding: "utf8" });
}

const dockerAvailable = docker("info", "--format", "{{.ServerVersion}}").status === 0;

function sources(): { file: string; text: string }[] {
  const workflows = readdirSync(path.join(root, ".github", "workflows")).map((name) =>
    path.join(".github", "workflows", name),
  );
  const scripts = readdirSync(path.join(root, "scripts"))
    .filter((name) => name.endsWith(".sh"))
    .map((name) => path.join("scripts", name));
  return [...workflows, ...scripts].map((file) => ({
    file,
    text: readFileSync(path.join(root, file), "utf8"),
  }));
}

describe("CI Docker cleanup", () => {
  it("removes CI resources only by the label of a job, never by the run or a name pattern", () => {
    for (const { file, text } of sources()) {
      assert.doesNotMatch(text, /lunedo\.ci\.run/, `${file} uses the run label`);
      assert.doesNotMatch(text, /LUNEDO_CI_RUN/, `${file} uses the run alone`);
      assert.doesNotMatch(text, /--filter\s+"?name=/, `${file} removes by a name pattern`);
      for (const match of text.matchAll(/^\s+LUNEDO_CI_JOB: (.+)$/gm)) {
        assert.match(
          match[1] ?? "",
          /github\.run_id.*github\.run_attempt.*github\.job/,
          `${file}: ${match[0]}`,
        );
      }
      for (const match of text.matchAll(/run: scripts\/ci-docker-cleanup\.sh job (\S+)(.*)/g)) {
        assert.equal(match[1], '"$LUNEDO_CI_JOB"', `${file}: ${match[0]}`);
        for (const project of (match[2] ?? "").trim().split(/\s+/).filter(Boolean)) {
          assert.match(project, /\$LUNEDO_CI_JOB"$/, `${file}: ${project}`);
        }
      }
    }
  });

  it("refuses job ids that name only the run and compose projects of other jobs", () => {
    assert.equal(cleanup("job", "40725121535-1").status, 2);
    assert.notEqual(cleanup("job", "").status, 0);
    assert.equal(cleanup("job", "40725121535-1-backup", "lunedo-storage-40725121535-1-operations").status, 2);
    assert.equal(cleanup("run", "40725121535-1").status, 2);
  });

  describe("on a shared Docker host", { skip: !dockerAvailable && "Docker is not available" }, () => {
    const run = `${randomInt(100_000_000, 999_999_999)}-1`;
    const jobs = { backup: `${run}-backup`, operations: `${run}-operations` };

    function start(job: string) {
      const label = `lunedo.ci.job=${job}`;
      assert.equal(docker("network", "create", "--label", label, `cleanup-test-${job}`).status, 0);
      assert.equal(docker("volume", "create", "--label", label, `cleanup-test-${job}`).status, 0);
      const started = docker(
        "run",
        "-d",
        "--label",
        label,
        "--name",
        `cleanup-test-${job}`,
        "--network",
        `cleanup-test-${job}`,
        "-v",
        `cleanup-test-${job}:/data`,
        "--entrypoint",
        "sleep",
        image,
        "300",
      );
      assert.equal(started.status, 0, started.stderr);
      const composed = docker(
        "run",
        "-d",
        "--label",
        `com.docker.compose.project=lunedo-storage-${job}`,
        "--name",
        `cleanup-test-compose-${job}`,
        "--entrypoint",
        "sleep",
        image,
        "300",
      );
      assert.equal(composed.status, 0, composed.stderr);
    }

    function running(name: string): boolean {
      const inspected = docker("inspect", "-f", "{{.State.Running}}", name);
      return inspected.status === 0 && inspected.stdout.trim() === "true";
    }

    function exists(kind: "network" | "volume", name: string): boolean {
      return docker(kind, "inspect", name).status === 0;
    }

    after(() => {
      for (const job of Object.values(jobs)) cleanup("job", job, `lunedo-storage-${job}`);
    });

    it("leaves the containers, networks and volumes of the other job of the same run running", () => {
      start(jobs.backup);
      start(jobs.operations);
      const result = cleanup("job", jobs.backup, `lunedo-storage-${jobs.backup}`);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(running(`cleanup-test-${jobs.backup}`), false);
      assert.equal(running(`cleanup-test-compose-${jobs.backup}`), false);
      assert.equal(exists("network", `cleanup-test-${jobs.backup}`), false);
      assert.equal(exists("volume", `cleanup-test-${jobs.backup}`), false);
      assert.equal(running(`cleanup-test-${jobs.operations}`), true);
      assert.equal(running(`cleanup-test-compose-${jobs.operations}`), true);
      assert.equal(exists("network", `cleanup-test-${jobs.operations}`), true);
      assert.equal(exists("volume", `cleanup-test-${jobs.operations}`), true);
    });
  });
});
