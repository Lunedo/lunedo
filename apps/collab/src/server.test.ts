import { testDatabaseBaseUrl } from "@lunedo/server/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Cluster, createCluster, type Node } from "./harness.testing.js";
import { itemIdOf } from "./server.js";

const baseUrl = testDatabaseBaseUrl();

describe("document names", () => {
  it("accept only pages addressed by a lower-case ID", () => {
    expect(itemIdOf("page:01929b1e-0000-7000-8000-000000000001")).toBe(
      "01929b1e-0000-7000-8000-000000000001",
    );
    expect(itemIdOf("page:01929B1E-0000-7000-8000-000000000001")).toBeNull();
    expect(itemIdOf("space:01929b1e-0000-7000-8000-000000000001")).toBeNull();
    expect(itemIdOf("page:../etc")).toBeNull();
  });
});

describe.skipIf(!baseUrl)("operations endpoints", () => {
  let cluster: Cluster;
  let node: Node;
  let http: string;

  beforeAll(async () => {
    cluster = await createCluster(baseUrl ?? "", 1);
    node = await cluster.node();
    http = `http://127.0.0.1:${node.server.address.port}`;
  });

  afterAll(async () => {
    await cluster?.close();
  });

  it("reports liveness and readiness", async () => {
    expect((await fetch(`${http}/health/live`)).status).toBe(200);
    const ready = await fetch(`${http}/health/ready`);
    expect(ready.status).toBe(200);
  });

  it("serves metrics only with the token", async () => {
    expect((await fetch(`${http}/metrics`)).status).toBe(401);
    const response = await fetch(`${http}/metrics`, { headers: { authorization: "Bearer collab-token" } });
    expect(response.status).toBe(200);
  });

  it("answers other HTTP requests with 404", async () => {
    const response = await fetch(`${http}/`);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });
});
