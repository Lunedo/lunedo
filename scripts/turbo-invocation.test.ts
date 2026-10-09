import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { turboInvocation } from "./turbo-invocation.ts";

const windows = { cores: 16, platform: "win32" } as const;

describe("turboInvocation", () => {
  it("splits the local budget between Turbo tasks and the workers of each task", () => {
    const { args, env } = turboInvocation(["run", "test", "--continue"], {}, windows);
    assert.deepEqual(args, ["run", "test", "--continue", "--concurrency=2"]);
    assert.equal(env.PAGEHALL_TEST_WORKERS, "4");
    assert.equal(env.GOMAXPROCS, "4");
  });

  it("takes the budget from PAGEHALL_PARALLELISM", () => {
    const { args, env } = turboInvocation(["run", "test"], { PAGEHALL_PARALLELISM: "16" }, windows);
    assert.deepEqual(args, ["run", "test", "--concurrency=4"]);
    assert.equal(env.PAGEHALL_TEST_WORKERS, "4");
  });

  it("keeps a concurrency and worker count that the caller chose", () => {
    const { args, env } = turboInvocation(
      ["run", "typecheck", "--concurrency=1"],
      { PAGEHALL_TEST_WORKERS: "5", GOMAXPROCS: "7" },
      windows,
    );
    assert.deepEqual(args, ["run", "typecheck", "--concurrency=1"]);
    assert.equal(env.PAGEHALL_TEST_WORKERS, "5");
    assert.equal(env.GOMAXPROCS, "7");
    assert.deepEqual(turboInvocation(["run", "test"], { TURBO_CONCURRENCY: "2" }, windows).args, [
      "run",
      "test",
    ]);
  });

  it("leaves CI runs to CI_PARALLELISM", () => {
    const env = { CI: "true", CI_PARALLELISM: "3", TURBO_CONCURRENCY: "3" };
    assert.deepEqual(turboInvocation(["run", "test"], env, windows), { args: ["run", "test"], env });
  });
});
