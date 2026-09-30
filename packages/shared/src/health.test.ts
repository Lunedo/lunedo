import { describe, expect, it, vi } from "vitest";
import { runHealthChecks } from "./health.js";

describe("runHealthChecks", () => {
  it("reports ok when all checks pass", async () => {
    const report = await runHealthChecks({ database: async () => {}, storage: async () => {} });
    expect(report.status).toBe("ok");
    expect(Object.keys(report.checks)).toEqual(["database", "storage"]);
    expect(report.checks.database?.status).toBe("ok");
  });

  it("reports ok without checks", async () => {
    expect(await runHealthChecks({})).toEqual({ status: "ok", checks: {} });
  });

  it("reports an error when one check fails and does not expose the error", async () => {
    const onFailure = vi.fn();
    const report = await runHealthChecks(
      {
        database: async () => {
          throw new Error("password authentication failed for user secret");
        },
        storage: async () => {},
      },
      { onFailure },
    );
    expect(report.status).toBe("error");
    expect(report.checks.database?.status).toBe("error");
    expect(report.checks.storage?.status).toBe("ok");
    expect(JSON.stringify(report)).not.toContain("secret");
    expect(onFailure).toHaveBeenCalledWith("database", expect.any(Error));
  });

  it("fails checks that exceed the timeout", async () => {
    const report = await runHealthChecks({ slow: () => new Promise(() => {}) }, { timeoutMs: 20 });
    expect(report.status).toBe("error");
  });
});
