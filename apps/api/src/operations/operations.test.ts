import { accountAttemptLimitSetting, clientAttemptLimitSetting, SYSTEM } from "@pagehall/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addTotp,
  completeConfiguredSetup,
  configuredSetupEnv,
  createAccount,
  OWNER,
  signedInClient,
} from "../testing/accounts.js";
import { type AuthTestApp, createAuthTestApp, databaseBaseUrl, TestClient } from "../testing/auth-app.js";

const METRICS_TOKEN = "operations-metrics-token-value";

describe.skipIf(!databaseBaseUrl)("operations status through the API", () => {
  let test: AuthTestApp;
  let owner: TestClient;
  let member: TestClient;

  beforeAll(async () => {
    test = await createAuthTestApp({
      ...configuredSetupEnv,
      PAGEHALL_METRICS_TOKEN: METRICS_TOKEN,
      PAGEHALL_COLLAB_UPSTREAM: "http://127.0.0.1:9",
    });
    await completeConfiguredSetup(test);
    await test.runtime.settings.set(clientAttemptLimitSetting, {}, "instance", 10_000);
    await test.runtime.settings.set(accountAttemptLimitSetting, {}, "instance", 1000);
    owner = new TestClient(test.app);
    await owner.post("/api/v1/auth/sign-in", OWNER);
    await addTotp(owner);
    await createAccount(test, "operations-member@pagehall.test", "a long enough passphrase");
    member = await signedInClient(test, "operations-member@pagehall.test", "a long enough passphrase");
  });

  afterAll(async () => {
    await test?.close();
  });

  it("shows the status to instance administrators only", async () => {
    const response = await owner.get("/api/v1/instance/operations/status");
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as {
      status: string;
      items: { id: string; status: string; reason: string | null }[];
    };
    expect(body.items.map((item) => item.id)).toContain("recentErrors");
    expect(body.items.find((item) => item.id === "collaboration")).toMatchObject({
      status: "error",
      reason: "unavailable",
    });
    expect(body.items.find((item) => item.id === "backups")).toMatchObject({ reason: "noTarget" });
    expect(body.status).toBe("error");

    expect((await member.get("/api/v1/instance/operations/status")).statusCode).toBe(403);
    expect((await new TestClient(test.app).get("/api/v1/instance/operations/status")).statusCode).toBe(401);
  });

  it("lets viewers of operations read, but only managers change maintenance and run the update check", async () => {
    const watcher = await createAccount(test, "operations-auditor@pagehall.test", "a long enough passphrase");
    await test.runtime.services.roles.assign(SYSTEM, {
      scope: "instance",
      organizationId: null,
      role: { builtIn: "securityAuditor" },
      principal: { kind: "account", id: watcher.id },
    });
    const auditor = await signedInClient(
      test,
      "operations-auditor@pagehall.test",
      "a long enough passphrase",
    );
    for (const url of [
      "/api/v1/instance/operations/status",
      "/api/v1/instance/maintenance",
      "/api/v1/instance/updates",
    ]) {
      expect((await auditor.get(url)).statusCode, url).toBe(200);
    }
    expect((await auditor.put("/api/v1/instance/maintenance", { enabled: true })).statusCode).toBe(403);
    expect((await auditor.post("/api/v1/instance/updates/check")).statusCode).toBe(403);
    expect((await owner.get("/api/v1/instance/maintenance")).json()).toMatchObject({ enabled: false });
  });

  it("exposes the instance metrics with the token", async () => {
    const response = await test.app.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: `Bearer ${METRICS_TOKEN}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatch(/^pagehall_build_info\{version="dev",service="api"\} 1$/m);
    expect(response.body).toMatch(/^pagehall_database_size_bytes\{service="api"\} \d+$/m);
    expect(response.body).toMatch(/^pagehall_storage_level\{service="api"\} 0$/m);
    expect(response.body).toMatch(/^pagehall_collab_up\{service="api"\} 0$/m);
    expect(response.body).toMatch(/^pagehall_mail_delivery_failures_total\{service="api"\} 0$/m);
    expect(response.body).not.toContain("operations-member@pagehall.test");
  });
});
