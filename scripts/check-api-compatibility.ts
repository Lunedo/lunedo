import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BREAKING_API_LABEL, contextFromEnvironment, pullRequestLabels } from "./github-api.ts";

const OASDIFF = "tufin/oasdiff@sha256:0286f138545a39010525df6c1bea67ffafacb384ef800effffa63bbd04718ce5";
const DESCRIPTION = "apps/api/openapi.json";

const base = process.argv[2];
const pullRequestFlag = process.argv.indexOf("--pr");
const pullRequest = pullRequestFlag < 0 ? undefined : Number(process.argv[pullRequestFlag + 1]);
if (!base || (pullRequest !== undefined && !Number.isInteger(pullRequest))) {
  console.error(
    "Usage: node scripts/check-api-compatibility.ts <base revision> [--allow-breaking | --pr <number>]",
  );
  process.exit(2);
}
let allowBreaking = process.argv.includes("--allow-breaking");
if (pullRequest !== undefined) {
  try {
    allowBreaking = (await pullRequestLabels(contextFromEnvironment(process.env), pullRequest)).includes(
      BREAKING_API_LABEL,
    );
  } catch (error) {
    console.error(`Could not read the labels of pull request ${pullRequest}: ${(error as Error).message}`);
    process.exit(1);
  }
}

let previous: string;
try {
  previous = execFileSync("git", ["show", `${base}:${DESCRIPTION}`], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
} catch {
  console.log(`${base} has no API description yet; nothing to compare.`);
  process.exit(0);
}

const directory = mkdtempSync(path.join(tmpdir(), "pagehall-oasdiff-"));
try {
  writeFileSync(path.join(directory, "base.json"), previous);
  copyFileSync(DESCRIPTION, path.join(directory, "head.json"));
  const result = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--network=none",
      "-v",
      `${directory}:/specs:ro`,
      OASDIFF,
      "breaking",
      "/specs/base.json",
      "/specs/head.json",
      ...(allowBreaking ? [] : ["--fail-on", "ERR"]),
    ],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    console.error(
      "The API description has breaking changes. If they are intended, add the label `breaking-api-change` to the pull request.",
    );
    process.exit(1);
  }
  console.log(allowBreaking ? "Breaking changes are allowed by the label." : "No breaking API changes.");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
