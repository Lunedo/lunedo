import { randomUUID } from "node:crypto";
import {
  AUDIT_CHANGES_CHANNEL,
  accountPrincipal,
  type ServerRuntime,
  SPACE_CHANGES_CHANNEL,
} from "@lunedo/server";
import { testDatabaseBaseUrl } from "@lunedo/server/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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

const DELIVERED_CHANNEL = "lunedo_test_recheck_order";
const RECHECKED = "Collaboration permission rechecked";

describe.skipIf(!baseUrl)("recheck order", () => {
  let cluster: Cluster;
  let node: Node;
  let runtime: ServerRuntime;
  const delivered = new Set<string>();

  beforeAll(async () => {
    cluster = await createCluster(baseUrl ?? "", 1);
    node = await cluster.node();
    runtime = node.runtime;
    await runtime.listener.listen(DELIVERED_CHANNEL, (payload) => delivered.add(payload));
  });

  afterAll(async () => {
    await cluster?.close();
  });

  async function notify(channel: string, payload: object): Promise<void> {
    await runtime.pool.query("select pg_notify($1, $2)", [channel, JSON.stringify(payload)]);
  }

  async function signalsDelivered(): Promise<void> {
    const marker = randomUUID();
    await notify(DELIVERED_CHANNEL, { marker });
    await waitFor(() => delivered.has(JSON.stringify({ marker })));
  }

  async function editor() {
    const { organization, member, space } = cluster.fixtures;
    const org = await organization();
    const admin = await member(org.id);
    const account = await member(org.id);
    const created = await space(org.id, admin, {
      grants: [{ principalKind: "account", principalId: account, role: "editor" }],
    });
    const item = await runtime.services.tree.create(accountPrincipal(admin), created.id, {
      kind: "page",
      title: "Page",
      mode: "live",
      placement: { parentId: null },
    });
    return { org, space: created, itemId: item.id, token: await signIn(runtime, account) };
  }

  it("rechecks lower-priority signals while space signals keep the queue full", async () => {
    const concurrency = Math.floor(runtime.config.database.poolSize / 2);
    const clients: Client[] = [];
    const busy = await editor();
    const crowd = Array.from({ length: 4 * concurrency }, () =>
      connect(node.url, busy.itemId, { token: busy.token }),
    );
    clients.push(...crowd);
    const waiting = await editor();
    const client = connect(node.url, waiting.itemId, { token: waiting.token });
    clients.push(client);
    await Promise.all(clients.map((opened) => opened.authenticated));
    await signalsDelivered();
    const explain = runtime.services.authorization.explain.bind(runtime.services.authorization);
    let started = 0;
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const checking = vi
      .spyOn(runtime.services.authorization, "explain")
      .mockImplementation(async (...args) => {
        if (args[2].id === busy.itemId) {
          started += 1;
          await released;
        }
        return explain(...args);
      });
    const logged = vi.spyOn(runtime.logger, "info");
    const order = () =>
      logged.mock.calls
        .filter(([, message]) => message === RECHECKED)
        .map(([fields]) => (fields as Record<string, unknown>).itemId);
    try {
      await notify(SPACE_CHANGES_CHANNEL, { spaceId: busy.space.id, kind: "access", itemId: null });
      await waitFor(() => started === concurrency);
      await notify(AUDIT_CHANGES_CHANNEL, {
        scope: "organization",
        organizationId: waiting.org.id,
        target: "group",
      });
      await signalsDelivered();
      release();
      await waitFor(() => order().filter((itemId) => itemId === busy.itemId).length === crowd.length);
      await waitFor(() => order().includes(waiting.itemId));
      expect(order().indexOf(waiting.itemId)).toBeLessThan(order().lastIndexOf(busy.itemId));
    } finally {
      release();
      checking.mockRestore();
      logged.mockRestore();
      for (const opened of clients) opened.destroy();
    }
  });
});
