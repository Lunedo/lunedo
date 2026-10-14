import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contextFromEnvironment, type GithubContext, pullRequestLabels } from "./github-api.ts";
import { rerunCi } from "./rerun-ci.ts";

function context(
  handler: (method: string, url: string) => { status?: number; body?: unknown },
  calls: string[] = [],
): GithubContext {
  return {
    apiUrl: "https://api.example",
    repository: "org/repo",
    token: "token",
    fetch: (async (url: string, init: { method: string }) => {
      calls.push(`${init.method} ${url.replace("https://api.example/repos/org/repo", "")}`);
      const { status = 200, body = null } = handler(init.method, url);
      return new Response(body === null ? "" : JSON.stringify(body), { status });
    }) as unknown as typeof fetch,
  };
}

describe("pullRequestLabels", () => {
  it("returns the current label names", async () => {
    const labels = await pullRequestLabels(
      context(() => ({ body: [{ name: "a" }, { name: "b" }] })),
      7,
    );
    assert.deepEqual(labels, ["a", "b"]);
  });

  it("names the failing request when GitHub refuses it", async () => {
    await assert.rejects(
      pullRequestLabels(
        context(() => ({ status: 403 })),
        7,
      ),
      /403/,
    );
  });
});

describe("contextFromEnvironment", () => {
  it("requires the repository and the token", () => {
    assert.throws(() => contextFromEnvironment({}), /GITHUB_TOKEN/);
  });
});

describe("rerunCi", () => {
  it("runs a completed run again without cancelling it", async () => {
    const calls: string[] = [];
    const id = await rerunCi(
      context(
        (_, url) => ({
          body: url.includes("/runs?") ? { workflow_runs: [{ id: 5, status: "completed" }] } : null,
        }),
        calls,
      ),
      "abc",
      async () => {},
    );
    assert.equal(id, 5);
    assert.deepEqual(calls.slice(1), ["POST /actions/runs/5/rerun"]);
  });

  it("cancels a running run, waits until it stopped and then runs it again", async () => {
    const calls: string[] = [];
    let polls = 0;
    await rerunCi(
      context((method, url) => {
        if (url.includes("/runs?")) return { body: { workflow_runs: [{ id: 9, status: "in_progress" }] } };
        if (method === "GET") return { body: { id: 9, status: ++polls < 3 ? "in_progress" : "completed" } };
        return {};
      }, calls),
      "abc",
      async () => {},
    );
    assert.deepEqual(calls.slice(1, 2), ["POST /actions/runs/9/cancel"]);
    assert.equal(calls.at(-1), "POST /actions/runs/9/rerun");
    assert.equal(polls, 3);
  });

  it("explains what to do when the commit has no CI run", async () => {
    await assert.rejects(
      rerunCi(
        context(() => ({ body: { workflow_runs: [] } })),
        "abc",
        async () => {},
      ),
      /Push a commit/,
    );
  });
});
