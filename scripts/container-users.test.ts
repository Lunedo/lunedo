import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { containerUserProblems } from "./container-users.ts";

const jobContainer = (options: string) => `
jobs:
  e2e:
    runs-on: ubuntu-24.04
    container:
      image: mcr.microsoft.com/playwright:v1.64.1-noble
      options: >-
${options}
    steps:
      - run: pnpm test
`;

const dockerRun = (command: string) => `
jobs:
  prune:
    runs-on: ubuntu-24.04
    steps:
      - name: Prune
        run: >-
${command}
`;

describe("containerUserProblems", () => {
  it("refuses a job container without --user", () => {
    const problems = containerUserProblems({ "ci.yml": jobContainer("        --tmpfs /pagehall-e2e") });
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? "", /ci\.yml, job e2e runs its steps in a container without --user/);
  });

  it("accepts a job container that runs as the runner user", () => {
    const workflow = jobContainer("        --user 1001:118\n        --tmpfs /x");
    assert.deepEqual(containerUserProblems({ "ci.yml": workflow }), []);
  });

  it("refuses docker run with the workspace or the CI cache mounted and no --user", () => {
    for (const mount of ['--volume "$CI_CACHE_DIR:/ci-cache"', '-v "$GITHUB_WORKSPACE:/repo"']) {
      const problems = containerUserProblems({
        "audit.yml": dockerRun(`          docker run --rm ${mount} image`),
      });
      assert.equal(problems.length, 1, mount);
      assert.match(problems[0] ?? "", /job prune mounts the workspace or the CI cache/);
    }
  });

  it("accepts docker run with --user, and docker run without such a mount", () => {
    const withUser = dockerRun(
      '          docker run --rm --user "$(id -u):$(id -g)"\n          --volume "$CI_CACHE_DIR:/ci-cache" image',
    );
    const otherMount = dockerRun('          docker run --rm -v "$data:/var/lib/pagehall" image');
    assert.deepEqual(containerUserProblems({ "a.yml": withUser, "b.yml": otherMount }), []);
  });

  it("finds no problem in the workflows of this repository", () => {
    const directory = path.join(import.meta.dirname, "..", ".github", "workflows");
    const workflows = Object.fromEntries(
      readdirSync(directory)
        .filter((file) => /\.ya?ml$/.test(file))
        .map((file) => [file, readFileSync(path.join(directory, file), "utf8")]),
    );
    assert.deepEqual(containerUserProblems(workflows), []);
  });
});
