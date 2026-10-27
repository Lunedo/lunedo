import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  type CacheEntry,
  type CacheFileSystem,
  cacheAccess,
  cacheEnvironment,
  parseOwner,
  prepareCache,
  rootProblem,
  runnerDirectory,
} from "./ci-cache.ts";

function fakeFileSystem(entry: CacheEntry | undefined, writable = true, failingMkdir = false) {
  const created: string[] = [];
  const fs: CacheFileSystem = {
    stat: () => entry,
    writable: () => writable,
    mkdir: (target) => {
      if (failingMkdir) throw new Error("EACCES: permission denied");
      created.push(target);
    },
  };
  return { fs, created };
}

const directory = (uid: number): CacheEntry => ({ isDirectory: () => true, uid });

describe("parseOwner", () => {
  it("accepts host and e2e only", () => {
    assert.equal(parseOwner("host"), "host");
    assert.equal(parseOwner("e2e"), "e2e");
    assert.throws(() => parseOwner("vm"), /Unknown cache owner "vm"/);
    assert.throws(() => parseOwner("container"), /Unknown cache owner "container"/);
    assert.throws(() => parseOwner(undefined), /Unknown cache owner ""/);
  });
});

describe("runnerDirectory", () => {
  it("turns the runner name into one safe path segment", () => {
    assert.equal(runnerDirectory("lunedo-runner-2"), "lunedo-runner-2");
    assert.equal(runnerDirectory("runner 1/../x"), "runner-1-..-x");
  });

  it("refuses a missing or empty name, so runners never share a Turborepo cache", () => {
    assert.throws(() => runnerDirectory(undefined), /RUNNER_NAME is not set/);
    assert.throws(() => runnerDirectory("  "), /RUNNER_NAME is not set/);
    assert.throws(() => runnerDirectory(".."), /RUNNER_NAME is not set/);
  });
});

describe("cacheEnvironment", () => {
  it("shares the pnpm store and gives each runner its own Turborepo cache", () => {
    assert.deepEqual(cacheEnvironment("/srv/ci-cache", "host", "r1", "write"), {
      pnpm_config_store_dir: "/srv/ci-cache/host/pnpm-store",
      TURBO_CACHE_DIR: "/srv/ci-cache/host/turbo/r1",
    });
  });

  it("keeps the end-to-end container apart from the jobs on the host and from the root-owned tree of earlier runs", () => {
    assert.deepEqual(cacheEnvironment("/ci-cache", "e2e", "r2", "write"), {
      pnpm_config_store_dir: "/ci-cache/e2e/pnpm-store",
      TURBO_CACHE_DIR: "/ci-cache/e2e/turbo/r2",
      pnpm_config_cache_dir: "/ci-cache/e2e/pnpm-cache/r2",
    });
  });
});

describe("cacheAccess", () => {
  it("lets only pushes to main write the caches", () => {
    assert.equal(cacheAccess("push", "refs/heads/main"), "write");
    assert.equal(cacheAccess("pull_request", "refs/pull/78/merge"), "read");
    assert.equal(cacheAccess("push", "refs/heads/fix/review-imports"), "read");
    assert.equal(cacheAccess("schedule", "refs/heads/main"), "read");
    assert.equal(cacheAccess("workflow_dispatch", "refs/heads/main"), "read");
    assert.equal(cacheAccess(undefined, undefined), "read");
  });
});

describe("cacheEnvironment for pull requests", () => {
  it("reads the Turborepo cache of main without writing and keeps its own pnpm store", () => {
    assert.deepEqual(cacheEnvironment("/srv/ci-cache", "host", "r1", "read"), {
      pnpm_config_store_dir: "/srv/ci-cache/host/pnpm-store-pull-requests",
      TURBO_CACHE_DIR: "/srv/ci-cache/host/turbo/r1",
      TURBO_CACHE: "local:r",
    });
    assert.deepEqual(cacheEnvironment("/ci-cache", "e2e", "r2", "read"), {
      pnpm_config_store_dir: "/ci-cache/e2e/pnpm-store-pull-requests",
      TURBO_CACHE_DIR: "/ci-cache/e2e/turbo/r2",
      pnpm_config_cache_dir: "/ci-cache/e2e/pnpm-cache-pull-requests/r2",
      TURBO_CACHE: "local:r",
    });
  });

  it("creates only directories", () => {
    const { fs, created } = fakeFileSystem(directory(1001));
    prepareCache("/srv/ci-cache", "host", "r1", "read", fs);
    assert.deepEqual(created, ["/srv/ci-cache/host/pnpm-store-pull-requests", "/srv/ci-cache/host/turbo/r1"]);
  });
});

describe("rootProblem", () => {
  it("accepts a writable directory", () => {
    assert.equal(rootProblem("/srv/ci-cache", "host", fakeFileSystem(directory(1001)).fs), undefined);
    assert.equal(rootProblem("/ci-cache", "e2e", fakeFileSystem(directory(1001)).fs), undefined);
  });

  it("names a missing directory and where the setup is described", () => {
    assert.match(
      rootProblem("/srv/ci-cache", "host", fakeFileSystem(undefined).fs) ?? "",
      /\/srv\/ci-cache does not exist on this runner\. .*docs\/development\/self-hosted-runners\.md/,
    );
  });

  it("rejects a file in place of the directory", () => {
    const file = { isDirectory: () => false, uid: 1001 };
    assert.match(rootProblem("/srv/ci-cache", "host", fakeFileSystem(file).fs) ?? "", /is not a directory/);
  });

  it("rejects a directory the runner user cannot write", () => {
    assert.match(
      rootProblem("/srv/ci-cache", "host", fakeFileSystem(directory(0), false).fs) ?? "",
      /is not writable for the runner user/,
    );
  });

  it("recognizes the empty directory Docker creates for a missing mount source", () => {
    assert.match(
      rootProblem("/ci-cache", "e2e", fakeFileSystem(directory(0)).fs) ?? "",
      /belongs to root, so Docker most likely created it/,
    );
  });
});

describe("prepareCache", () => {
  it("creates the directories of the job", () => {
    const { fs, created } = fakeFileSystem(directory(1001));
    prepareCache("/srv/ci-cache", "host", "r1", "write", fs);
    assert.deepEqual(created, ["/srv/ci-cache/host/pnpm-store", "/srv/ci-cache/host/turbo/r1"]);
  });

  it("fails with the setup hint before creating anything when the root is unusable", () => {
    const { fs, created } = fakeFileSystem(undefined);
    assert.throws(() => prepareCache("/srv/ci-cache", "host", "r1", "write", fs), /does not exist/);
    assert.deepEqual(created, []);
  });

  it("explains a directory it cannot create", () => {
    const { fs } = fakeFileSystem(directory(1001), true, true);
    assert.throws(
      () => prepareCache("/srv/ci-cache", "host", "r1", "write", fs),
      /Could not create \/srv\/ci-cache\/host\/pnpm-store in the CI cache: EACCES/,
    );
  });

  it("works on a real directory", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ci-cache-"));
    try {
      const env = prepareCache(root.replaceAll("\\", "/"), "host", "r1", "read");
      for (const name of ["pnpm_config_store_dir", "TURBO_CACHE_DIR"]) {
        assert.ok(statSync(env[name] as string).isDirectory());
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
