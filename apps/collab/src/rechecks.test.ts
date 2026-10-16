import { AUDIT_CHANGES_CHANNEL, accountPrincipal, type ServerRuntime } from "@pagehall/server";
import { testDatabaseBaseUrl } from "@pagehall/server/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Client,
  type Cluster,
  connect,
  createCluster,
  type Node,
  signIn,
  waitFor,
} from "./harness.testing.js";

const baseUrl = testDatabaseBaseUrl();

const OPEN_CONNECTIONS = 500;
const SPACES = 10;
const OPENED_TOGETHER = 25;
const REVOCATION_BOUND_MS = 1000;

describe.skipIf(!baseUrl)("permission rechecks with many open connections", () => {
  let cluster: Cluster;
  let node: Node;
  let runtime: ServerRuntime;
  let organizationId: string;
  let admin: string;
  const spaces: { id: string; itemId: string }[] = [];
  const clients: Client[] = [];

  async function editorOf(spaceId: string): Promise<string> {
    const account = await cluster.fixtures.member(organizationId);
    await runtime.services.spacePermissions.apply(accountPrincipal(admin), spaceId, {
      action: "grant",
      principalKind: "account",
      principalId: account,
      role: "editor",
    });
    return account;
  }

  async function openAll(itemId: string, token: string, count: number): Promise<Client[]> {
    const opened: Client[] = [];
    for (let start = 0; start < count; start += OPENED_TOGETHER) {
      const batch = Array.from({ length: Math.min(OPENED_TOGETHER, count - start) }, () =>
        connect(node.url, itemId, { token }),
      );
      clients.push(...batch);
      opened.push(...batch);
      await Promise.all(batch.map((client) => client.authenticated));
    }
    return opened;
  }

  beforeAll(async () => {
    cluster = await createCluster(baseUrl ?? "", 1);
    node = await cluster.node();
    runtime = node.runtime;
    const organization = await cluster.fixtures.organization();
    organizationId = organization.id;
    admin = await cluster.fixtures.member(organizationId);
    for (let index = 0; index < SPACES; index++) {
      const space = await cluster.fixtures.space(organizationId, admin);
      const item = await runtime.services.tree.create(accountPrincipal(admin), space.id, {
        kind: "page",
        title: `Page ${index}`,
        mode: "live",
        placement: { parentId: null },
      });
      spaces.push({ id: space.id, itemId: item.id });
    }
    for (const [index, space] of spaces.entries()) {
      const token = await signIn(runtime, await editorOf(space.id));
      const count = OPEN_CONNECTIONS / SPACES - (index === 0 ? 1 : 0);
      await openAll(space.itemId, token, count);
    }
  }, 180_000);

  afterAll(async () => {
    for (const client of clients) client.destroy();
    await cluster?.close();
  }, 30_000);

  async function revocationTime(before: () => Promise<void> = async () => undefined): Promise<number> {
    const space = spaces[0] as { id: string; itemId: string };
    const account = await editorOf(space.id);
    const [client] = await openAll(space.itemId, await signIn(runtime, account), 1);
    const entry = (await runtime.services.spacePermissions.list(space.id)).find(
      (candidate) => candidate.principalId === account,
    );
    expect(node.server.hocuspocus.getConnectionsCount()).toBe(OPEN_CONNECTIONS);
    await before();
    const started = performance.now();
    await runtime.services.spacePermissions.apply(accountPrincipal(admin), space.id, {
      action: "change",
      permissionId: entry?.id ?? "",
      role: "reader",
    });
    await waitFor(() => client?.closeReasons.includes("permissionRevoked") ?? false, 30_000);
    const elapsed = performance.now() - started;
    await waitFor(() => node.server.hocuspocus.getConnectionsCount() === OPEN_CONNECTIONS - 1);
    return elapsed;
  }

  it("closes the connection of a person who lost the edit permission within the bound", async () => {
    expect(await revocationTime()).toBeLessThan(REVOCATION_BOUND_MS);
  });

  it("closes it within the bound while every open connection is being rechecked", async () => {
    const elapsed = await revocationTime(async () => {
      await runtime.pool.query("select pg_notify($1, $2)", [
        AUDIT_CHANGES_CHANNEL,
        JSON.stringify({ scope: "instance", organizationId: null, target: "organization" }),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(elapsed).toBeLessThan(REVOCATION_BOUND_MS);
  });
});
