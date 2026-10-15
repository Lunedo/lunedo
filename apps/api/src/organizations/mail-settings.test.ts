import { accountAttemptLimitSetting, clientAttemptLimitSetting } from "@pagehall/server";
import {
  type FakeGraph,
  GRAPH_CLIENT_ID,
  GRAPH_CLIENT_SECRET,
  GRAPH_TENANT_ID,
  startFakeGraph,
} from "@pagehall/server/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addTotp, completeConfiguredSetup, configuredSetupEnv, OWNER } from "../testing/accounts.js";
import { type AuthTestApp, createAuthTestApp, databaseBaseUrl, TestClient } from "../testing/auth-app.js";

describe.skipIf(!databaseBaseUrl)("e-mail settings through the API", () => {
  let test: AuthTestApp;
  let owner: TestClient;
  let graph: FakeGraph;

  beforeAll(async () => {
    test = await createAuthTestApp({ ...configuredSetupEnv, PAGEHALL_INSECURE_IDENTITY_PROVIDERS: "true" });
    await completeConfiguredSetup(test);
    await test.runtime.settings.set(clientAttemptLimitSetting, {}, "instance", 10_000);
    await test.runtime.settings.set(accountAttemptLimitSetting, {}, "instance", 1000);
    owner = new TestClient(test.app);
    await owner.post("/api/v1/auth/sign-in", OWNER);
    await addTotp(owner);
    graph = await startFakeGraph();
  });

  afterAll(async () => {
    await graph?.close();
    await test?.close();
  });

  const settings = () => ({
    tenantId: GRAPH_TENANT_ID,
    clientId: GRAPH_CLIENT_ID,
    sender: "alice@example.org",
    senderName: "Wiki",
    authority: graph.url,
    graphUrl: graph.url,
  });

  it("keeps the mail method and the Graph settings out of the general settings endpoint", async () => {
    const foreign = {
      ...settings(),
      authority: "https://attacker.example",
      graphUrl: "https://attacker.example",
    };
    for (const [key, value] of [
      ["mail.graph", foreign],
      ["mail.method", "graph"],
    ] as const) {
      const response = await owner.put(`/api/v1/instance/settings/${key}`, { value });
      expect(response.json()).toMatchObject({ code: "settingManagedElsewhere" });
    }
    const listed = (await owner.get("/api/v1/instance/settings?limit=200")).json().items as {
      key: string;
      editable: boolean;
    }[];
    expect(listed.filter((item) => item.key.startsWith("mail.")).every((item) => !item.editable)).toBe(true);
  });

  it("stores the Graph settings and a credential, tests them and switches the sending method", async () => {
    expect((await owner.get("/api/v1/instance/mail")).json()).toMatchObject({ method: "smtp", graph: null });
    expect((await owner.put("/api/v1/instance/mail/method", { method: "graph" })).json()).toMatchObject({
      code: "mailNotReady",
    });
    expect(
      (await owner.put("/api/v1/instance/mail/graph", { ...settings(), tenantId: "x" })).json(),
    ).toMatchObject({
      code: "invalidMailConfiguration",
    });
    expect((await owner.put("/api/v1/instance/mail/graph", settings())).statusCode).toBe(204);
    const added = await owner.post("/api/v1/instance/mail/graph/credentials", {
      kind: "clientSecret",
      secret: GRAPH_CLIENT_SECRET,
      expiresAt: null,
    });
    expect(added.statusCode).toBe(201);
    const test1 = await owner.post("/api/v1/instance/mail/graph/test", {
      to: "reader@example.net",
      language: "en",
    });
    expect(test1.json()).toEqual({ delivered: true, error: null });
    graph.data.mailScope = ["bob@example.org"];
    const refused = await owner.post("/api/v1/instance/mail/graph/test", {
      to: "reader@example.net",
      language: "en",
    });
    expect(refused.json()).toEqual({
      delivered: false,
      error: { code: "graphMailboxNotAllowed", responseCode: 403, step: "send" },
    });
    graph.data.mailScope = null;

    expect((await owner.put("/api/v1/instance/mail/method", { method: "graph" })).statusCode).toBe(204);
    const stored = (await owner.get("/api/v1/instance/mail")).json();
    expect(stored).toMatchObject({ method: "graph", graph: { sender: "alice@example.org" } });
    expect(stored.graphCredentials).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain(GRAPH_CLIENT_SECRET);

    const certificate = (
      await owner.post("/api/v1/instance/mail/graph/credentials", { kind: "certificate", validDays: 365 })
    ).json();
    const pem = await owner.get(`/api/v1/instance/mail/graph/credentials/${certificate.id}/certificate`);
    expect(pem.headers["content-type"]).toContain("application/x-pem-file");
    expect(pem.body).toContain("BEGIN CERTIFICATE");
  });
});
