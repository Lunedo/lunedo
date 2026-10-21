import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { accountAttemptLimitSetting, clientAttemptLimitSetting } from "@pagehall/server";
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

const VERSION_FILE = {
  schema: 1,
  releases: [
    {
      version: "99.0.0",
      date: "2026-11-02",
      minimumUpdateFrom: null,
      url: "https://github.com/pagehall/pagehall/releases/tag/v99.0.0",
      notes: { new: ["Something new."], improved: [], fixed: [], breaking: [], manualSteps: [] },
    },
  ],
};

describe.skipIf(!databaseBaseUrl)("updates through the API", () => {
  let test: AuthTestApp;
  let owner: TestClient;
  let member: TestClient;
  let server: Server;
  const requests: { url: string; headers: Record<string, unknown> }[] = [];

  beforeAll(async () => {
    server = createServer((request, response) => {
      requests.push({ url: request.url ?? "", headers: request.headers });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(VERSION_FILE));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    test = await createAuthTestApp({
      ...configuredSetupEnv,
      PAGEHALL_UPDATE_CHECK_URL: `http://127.0.0.1:${port}/pagehall-versions.json`,
      PAGEHALL_OUTBOUND_ALLOWED_NETWORKS: "127.0.0.1/32",
      PAGEHALL_INSTALL_METHOD: "script",
      PAGEHALL_INSTALL_DIR: "/opt/pagehall",
      PAGEHALL_VERSION: "1.4.2",
    });
    await completeConfiguredSetup(test);
    await test.runtime.settings.set(clientAttemptLimitSetting, {}, "instance", 10_000);
    await test.runtime.settings.set(accountAttemptLimitSetting, {}, "instance", 1000);
    owner = new TestClient(test.app);
    await owner.post("/api/v1/auth/sign-in", OWNER);
    await addTotp(owner);
    await createAccount(test, "updates-member@pagehall.test", "a long enough passphrase");
    member = await signedInClient(test, "updates-member@pagehall.test", "a long enough passphrase");
  });

  afterAll(async () => {
    await test?.close();
    await new Promise((resolve) => server?.close(resolve));
  });

  it("checks on request, sends nothing about the instance and shows the update to administrators only", async () => {
    expect((await member.get("/api/v1/instance/updates")).statusCode).toBe(403);
    expect((await member.post("/api/v1/instance/updates/check")).statusCode).toBe(403);

    const checked = await owner.post("/api/v1/instance/updates/check");
    expect(checked.statusCode, checked.body).toBe(200);
    expect(checked.json()).toMatchObject({
      check: { enabled: true, succeeded: true, failure: null },
      latest: "99.0.0",
      commands: {
        method: "script",
        steps: [{ text: "cd /opt/pagehall" }, { text: "./pagehall update 99.0.0" }],
      },
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("/pagehall-versions.json");
    expect(Object.keys(requests[0]?.headers ?? {}).sort()).toEqual([
      "accept",
      "connection",
      "host",
      "user-agent",
    ]);
    expect(requests[0]?.headers["user-agent"]).toBe("Pagehall update check");

    const shown = await owner.get("/api/v1/instance/updates");
    expect(shown.json()).toMatchObject({ running: "1.4.2", latest: "99.0.0" });
  });

  it("makes no request while the instance setting is off", async () => {
    const before = requests.length;
    const off = await owner.put("/api/v1/instance/settings/operations.updateCheck", { value: false });
    expect(off.statusCode, off.body).toBe(204);
    const checked = await owner.post("/api/v1/instance/updates/check");
    expect(checked.json()).toMatchObject({ check: { enabled: false, disabledBy: "setting" }, latest: null });
    expect(requests.length).toBe(before);
    await owner.put("/api/v1/instance/settings/operations.updateCheck", { value: true });
  });
});
