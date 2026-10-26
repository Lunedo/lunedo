import { chmodSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { checkFileStorage, type SetupStepDependencies, systemCheckStep } from "./steps.js";

const baseUrl = testDatabaseBaseUrl();

const unixUser = process.getuid !== undefined && process.getuid() !== 0;

describe("checkFileStorage", () => {
  it("passes for a writable directory and reports its facts", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "lunedo-check-"));
    const result = await checkFileStorage(directory);
    expect(result).toMatchObject({
      cause: null,
      fixCommand: null,
      docs: "setup.md#file-storage",
      path: directory,
      exists: true,
      writable: true,
    });
    expect(result.freeBytes).toBeGreaterThan(0);
  });

  it("explains a missing directory and how to create it", async () => {
    const directory = path.join(mkdtempSync(path.join(tmpdir(), "lunedo-check-")), "files dir");
    const result = await checkFileStorage(directory);
    expect(result).toMatchObject({ status: "error", cause: "missing", exists: false, writable: false });
    expect(result.fixCommand).toContain(`mkdir -p '${directory}'`);
    if (process.getuid) {
      expect(result.fixCommand).toContain(`chown ${process.getuid()}:${process.getgid?.()} '${directory}'`);
    }
  });

  it.skipIf(!unixUser)("names the owner and the command when the directory is not writable", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "lunedo-check-"));
    chmodSync(directory, 0o500);
    try {
      const result = await checkFileStorage(directory);
      expect(result).toMatchObject({
        status: "error",
        cause: "notWritable",
        exists: true,
        writable: false,
        processUid: process.getuid?.(),
        ownerUid: process.getuid?.(),
        fixCommand: `chown -R ${process.getuid?.()}:${process.getgid?.()} ${directory}`,
      });
    } finally {
      chmodSync(directory, 0o700);
    }
  });
});

describe.skipIf(!baseUrl)("the system check", () => {
  let test: TestServices;

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
  });

  afterAll(async () => {
    await test?.close();
  });

  function check(configuredInstanceUrl: string | undefined) {
    const step = systemCheckStep({
      pool: test.pool,
      database: test.database,
      settings: test.settings,
      probe: {
        resolve: async () => ["203.0.113.10"],
        fetch: async () => {
          throw new TypeError("fetch failed");
        },
      },
      filesDir: mkdtempSync(path.join(tmpdir(), "lunedo-check-")),
      configuredInstanceUrl,
    } as unknown as SetupStepDependencies);
    return step.describe({
      request: { protocol: "http", host: "10.0.0.5:3000" },
      state: {},
      completed: false,
    }) as Promise<{
      checks: Record<string, Record<string, unknown>>;
    }>;
  }

  it("checks the configured instance URL instead of the address of the request", async () => {
    const { checks } = await check("https://wiki.example.org");
    expect(checks.instanceUrl).toMatchObject({
      status: "ok",
      configured: true,
      url: "https://wiki.example.org",
      source: "configuration",
    });
    expect(checks.https).toMatchObject({ status: "ok", cause: null });
    expect(checks.reachability).toMatchObject({
      status: "warning",
      cause: "unreachable",
      url: "https://wiki.example.org",
    });
  });

  it("warns when the configured instance URL does not use HTTPS", async () => {
    const { checks } = await check("http://wiki.example.org");
    expect(checks.https).toMatchObject({ status: "warning", cause: "instanceUrlNotHttps" });
  });

  it("warns about the request without any instance URL", async () => {
    const { checks } = await check(undefined);
    expect(checks.instanceUrl).toMatchObject({ status: "warning", cause: "notSet", source: null });
    expect(checks.https).toMatchObject({ status: "warning", cause: "requestNotHttps" });
  });
});
