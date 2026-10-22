import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { releaseJobProblems, workflowJobs } from "./release-jobs.ts";

const selfHosted = `name: Image
permissions:
  contents: read
jobs:
  build:
    runs-on: \${{ fromJSON(vars.RUNNER_LABELS || '"ubuntu-24.04"') }}
    steps:
      - run: docker build .
  publish:
    runs-on: \${{ fromJSON(vars.RUNNER_LABELS || '"ubuntu-24.04"') }}
    permissions:
      contents: read
      packages: write
    steps:
      - run: echo publish
  version-file:
    needs: publish
    runs-on: [self-hosted, linux]
    permissions:
      contents: write
    steps:
      - name: Read the release notes
        run: |
          docker run --rm "$IMAGE:\${TAG#v}" release-notes --json > lunedo-versions.json
`;

const isolated = `name: Image
permissions:
  contents: read
jobs:
  publish:
    runs-on: ubuntu-24.04
    permissions:
      packages: write
    steps:
      - run: echo publish
  version-file:
    runs-on: ubuntu-24.04
    permissions:
      contents: write
    steps:
      - run: |
          docker run --rm --pull always "$IMAGE@$DIGEST" release-notes --json > lunedo-versions.json
`;

describe("release jobs", () => {
  it("reads the runner, the permissions and the commands of every job", () => {
    const jobs = workflowJobs(selfHosted);
    assert.deepEqual(
      jobs.map((job) => job.id),
      ["build", "publish", "version-file"],
    );
    assert.equal(jobs[0]?.permissions.get("contents"), "read");
    assert.equal(jobs[1]?.permissions.get("packages"), "write");
    assert.equal(jobs[2]?.runsOn, "[self-hosted, linux]");
    assert.match(jobs[2]?.commands[0] ?? "", /docker run --rm "\$IMAGE:/);
  });

  it("refuses jobs that may write packages or the repository on self-hosted runners", () => {
    const problems = releaseJobProblems({ "image.yml": selfHosted });
    assert.equal(problems.filter((problem) => problem.includes("runs on")).length, 2);
    assert.ok(
      problems.some((problem) => problem.includes("job publish") && problem.includes("packages: write")),
    );
    assert.ok(
      problems.some((problem) => problem.includes("job version-file") && problem.includes("self-hosted")),
    );
  });

  it("refuses an image that the version file job runs by its tag", () => {
    const problems = releaseJobProblems({ "image.yml": selfHosted });
    assert.ok(problems.some((problem) => problem.includes("without its digest")));
  });

  it("accepts GitHub-hosted jobs that run the image by digest", () => {
    assert.deepEqual(releaseJobProblems({ "image.yml": isolated }), []);
  });

  it("accepts the workflows of the repository", () => {
    const workflows: Record<string, string> = {};
    for (const file of readdirSync(".github/workflows")) {
      if (/\.ya?ml$/.test(file)) workflows[file] = readFileSync(`.github/workflows/${file}`, "utf8");
    }
    assert.deepEqual(releaseJobProblems(workflows), []);
  });
});
