import { randomUUID } from "node:crypto";
import { documentFromYDoc } from "@pagehall/editor-schema/yjs";
import {
  AUDIT_CHANGES_CHANNEL,
  accountPrincipal,
  type ServerRuntime,
  SPACE_CHANGES_CHANNEL,
  SYSTEM,
} from "@pagehall/server";
import { testDatabaseBaseUrl, testRedisUrl } from "@pagehall/server/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  appendParagraph,
  type Client,
  type Cluster,
  connect,
  createCluster,
  type Node,
  ORIGIN,
  signIn,
  waitFor,
} from "./harness.testing.js";
import { MAX_UPDATE_BYTES, STORE_DEBOUNCE_MS } from "./limits.js";

const baseUrl = testDatabaseBaseUrl();
const redisUrl = testRedisUrl();

const DELIVERED_CHANNEL = "pagehall_test_delivered";

function textOf(doc: Y.Doc): string {
  return JSON.stringify(documentFromYDoc(doc));
}

function rechecksOf(calls: unknown[][], itemId: string): Record<string, unknown>[] {
  return calls
    .filter(([, message]) => message === "Collaboration permission rechecked")
    .map(([fields]) => fields as Record<string, unknown>)
    .filter((fields) => fields.itemId === itemId);
}

describe.skipIf(!baseUrl)("collaboration server", () => {
  let cluster: Cluster;
  let first: Node;
  let second: Node;
  const clients: Client[] = [];
  const delivered = new Set<string>();

  beforeAll(async () => {
    cluster = await createCluster(baseUrl ?? "");
    first = await cluster.node();
    second = await cluster.node();
    await first.runtime.listener.listen(DELIVERED_CHANNEL, (payload) => delivered.add(payload));
  });

  afterAll(async () => {
    for (const client of clients) client.destroy();
    await cluster?.close();
  });

  function open(...args: Parameters<typeof connect>): Client {
    const client = connect(...args);
    clients.push(client);
    return client;
  }

  async function page(options: { editors?: string[]; readers?: string[] } = {}) {
    const { organization, member, space } = cluster.fixtures;
    const org = await organization();
    const admin = await member(org.id);
    const created = await space(org.id, admin, {
      grants: [
        ...(options.editors ?? []).map((id) => ({
          principalKind: "account" as const,
          principalId: id,
          role: "editor" as const,
        })),
        ...(options.readers ?? []).map((id) => ({
          principalKind: "account" as const,
          principalId: id,
          role: "reader" as const,
        })),
      ],
    });
    const runtime = cluster.runtimes[0] as ServerRuntime;
    const item = await runtime.services.tree.create(accountPrincipal(admin), created.id, {
      kind: "page",
      title: `Page ${Math.random().toString(36).slice(2, 8)}`,
      mode: "live",
      placement: { parentId: null },
    });
    return { org, admin, space: created, itemId: item.id };
  }

  async function editor() {
    const { organization, member } = cluster.fixtures;
    const org = await organization();
    const target = await page();
    const account = await member(target.org.id);
    await cluster.runtimes[0]?.services.spacePermissions.apply(
      accountPrincipal(target.admin),
      target.space.id,
      {
        action: "grant",
        principalKind: "account",
        principalId: account,
        role: "editor",
      },
    );
    expect(org.id).toBeTruthy();
    return { ...target, account, token: await signIn(cluster.runtimes[0] as ServerRuntime, account) };
  }

  async function notify(channel: string, payload: object): Promise<void> {
    await first.runtime.pool.query("select pg_notify($1, $2)", [channel, JSON.stringify(payload)]);
  }

  async function signalsDelivered(): Promise<void> {
    const marker = randomUUID();
    await notify(DELIVERED_CHANNEL, { marker });
    await waitFor(() => delivered.has(JSON.stringify({ marker })));
  }

  async function snapshot(itemId: string) {
    return JSON.stringify((await cluster.runtimes[0]?.services.documents.snapshot(itemId))?.document);
  }

  async function rejections(itemId: string) {
    const result = await (cluster.runtimes[0] as ServerRuntime).pool.query<{
      fields: Record<string, unknown>;
    }>("select fields from audit_events where name = 'page.updateRejected' and target_id = $1", [itemId]);
    return result.rows.map((row) => row.fields);
  }

  it("stores edits after a short pause and reports what it stored", async () => {
    const { itemId, token } = await editor();
    const client = open(first.url, itemId, { token });
    await client.authenticated;
    appendParagraph(client.doc, "Stored after typing");
    await waitFor(async () => (await snapshot(itemId)).includes("Stored after typing"));
    await waitFor(() => client.stateless.some((message) => message.type === "saved"));
    const saved = client.stateless.find((message) => message.type === "saved");
    const stored = Y.decodeStateVector(Buffer.from(saved?.stateVector ?? "", "base64"));
    expect(stored.get(client.doc.clientID)).toBe(Y.getState(client.doc.store, client.doc.clientID));
  });

  it("tells editors when storing fails", async () => {
    const { itemId, token } = await editor();
    const client = open(first.url, itemId, { token });
    await client.authenticated;
    await (cluster.runtimes[0] as ServerRuntime).pool.query("delete from page_documents where item_id = $1", [
      itemId,
    ]);
    appendParagraph(client.doc, "Cannot be stored");
    await waitFor(() => client.stateless.some((message) => message.type === "saveFailed"));
    expect(client.stateless.some((message) => message.type === "saved")).toBe(false);
  });

  it("records which account each Yjs client belongs to", async () => {
    const { itemId, token, account } = await editor();
    const client = open(first.url, itemId, { token });
    await client.authenticated;
    appendParagraph(client.doc, "Attributed");
    await waitFor(async () => {
      const result = await (cluster.runtimes[0] as ServerRuntime).pool.query<{ account_id: string }>(
        "select account_id from collaboration_clients where item_id = $1 and client_id = $2",
        [itemId, client.doc.clientID],
      );
      return result.rows[0]?.account_id === account;
    });
  });

  describe("refuses connections", () => {
    async function refusal(client: Client): Promise<string> {
      return client.authenticated.then(
        () => "accepted",
        (error: Error) => error.message,
      );
    }

    it("from readers and people without access", async () => {
      const { member } = cluster.fixtures;
      const target = await page();
      const reader = await member(target.org.id);
      await cluster.runtimes[0]?.services.spacePermissions.apply(
        accountPrincipal(target.admin),
        target.space.id,
        {
          action: "grant",
          principalKind: "account",
          principalId: reader,
          role: "reader",
        },
      );
      const outsider = await member(target.org.id);
      const runtime = cluster.runtimes[0] as ServerRuntime;
      expect(await refusal(open(first.url, target.itemId, { token: await signIn(runtime, reader) }))).toBe(
        "noEditPermission",
      );
      expect(await refusal(open(first.url, target.itemId, { token: await signIn(runtime, outsider) }))).toBe(
        "pageNotFound",
      );
    });

    it("from other origins, without an origin and with an API token", async () => {
      const { itemId, token } = await editor();
      expect(await refusal(open(first.url, itemId, { token, origin: "https://evil.example" }))).toBe(
        "originNotAllowed",
      );
      expect(await refusal(open(first.url, itemId, { token, origin: null }))).toBe("originNotAllowed");
      expect(
        await refusal(open(first.url, itemId, { token, headers: { authorization: "Bearer ph_token" } })),
      ).toBe("tokenNotAllowed");
      expect(await refusal(open(first.url, itemId, { token }))).toBe("accepted");
    });

    it("with an ended or a missing session", async () => {
      const { itemId, token, account } = await editor();
      const runtime = cluster.runtimes[0] as ServerRuntime;
      await runtime.pool.query("delete from sessions where account_id = $1", [account]);
      expect(await refusal(open(first.url, itemId, { token }))).toBe("notSignedIn");
      expect(await refusal(open(first.url, itemId, {}))).toBe("notSignedIn");
      expect(ORIGIN).toBe("https://pagehall.test");
    });

    it("on other paths", async () => {
      const { itemId, token } = await editor();
      const client = open(first.url.replace(/\/collab$/, "/other"), itemId, { token });
      expect(
        await Promise.race([
          refusal(client),
          new Promise((resolve) => setTimeout(() => resolve("none"), 1500)),
        ]),
      ).toBe("none");
    });
  });

  describe("rejects updates", () => {
    it("that do not match the editor schema, and stores nothing", async () => {
      const { itemId, token } = await editor();
      const client = open(first.url, itemId, { token });
      await client.authenticated;
      const before = await snapshot(itemId);
      client.doc.getXmlFragment("default").push([new Y.XmlElement("script")]);
      await waitFor(() => client.closeReasons.includes("updateRejected"));
      const server = first.server.hocuspocus;
      await waitFor(
        () => !server.documents.has(`page:${itemId}`) && !server.unloadingDocuments.has(`page:${itemId}`),
      );
      expect(await snapshot(itemId)).toBe(before);
      const [event] = await rejections(itemId);
      expect(event).toMatchObject({ reason: "invalidDocument", problems: ["unknownNode"] });
      expect(JSON.stringify(event)).not.toContain("script");
    });

    it("above the size limit", async () => {
      const { itemId, token } = await editor();
      const client = open(first.url, itemId, { token });
      await client.authenticated;
      appendParagraph(client.doc, "x".repeat(MAX_UPDATE_BYTES + 1000));
      await waitFor(() => client.closeReasons.includes("updateRejected"));
      expect(await rejections(itemId)).toEqual([expect.objectContaining({ reason: "tooLarge" })]);
      expect(await snapshot(itemId)).not.toContain("xxxxxxxxxx");
    });

    it("that carry the Yjs client of another account", async () => {
      const target = await editor();
      const { member } = cluster.fixtures;
      const other = await member(target.org.id);
      await cluster.runtimes[0]?.services.spacePermissions.apply(
        accountPrincipal(target.admin),
        target.space.id,
        {
          action: "grant",
          principalKind: "account",
          principalId: other,
          role: "editor",
        },
      );
      const honest = open(first.url, target.itemId, { token: target.token });
      await honest.authenticated;
      appendParagraph(honest.doc, "Honest");
      await waitFor(async () => (await snapshot(target.itemId)).includes("Honest"));
      const spoof = open(second.url, target.itemId, {
        token: await signIn(cluster.runtimes[0] as ServerRuntime, other),
      });
      await spoof.authenticated;
      const forger = new Y.Doc();
      Y.applyUpdate(forger, Y.encodeStateAsUpdate(honest.doc));
      forger.clientID = honest.doc.clientID;
      appendParagraph(forger, "Forged");
      Y.applyUpdate(spoof.doc, Y.encodeStateAsUpdate(forger, Y.encodeStateVector(spoof.doc)));
      await waitFor(() => spoof.closeReasons.includes("updateRejected"));
      expect(await rejections(target.itemId)).toEqual([expect.objectContaining({ reason: "foreignClient" })]);
      expect(await snapshot(target.itemId)).not.toContain("Forged");
    });
  });

  it("disconnects a person at once when another node takes away the edit permission", async () => {
    const target = await editor();
    const client = open(first.url, target.itemId, { token: target.token });
    await client.authenticated;
    const otherNode = cluster.runtimes[1] as ServerRuntime;
    const entry = (await otherNode.services.spacePermissions.list(target.space.id)).find(
      (candidate) => candidate.principalId === target.account,
    );
    await otherNode.services.spacePermissions.apply(accountPrincipal(target.admin), target.space.id, {
      action: "change",
      permissionId: entry?.id ?? "",
      role: "reader",
    });
    await waitFor(() => client.closeReasons.includes("permissionRevoked"), 3000);
  });

  it("disconnects a person who loses the edit permission in the space a page was moved to", async () => {
    const target = await editor();
    const runtime = cluster.runtimes[0] as ServerRuntime;
    const destination = await cluster.fixtures.space(target.org.id, target.admin, {
      grants: [{ principalKind: "account", principalId: target.account, role: "editor" }],
    });
    const client = open(first.url, target.itemId, { token: target.token });
    await client.authenticated;
    const logged = vi.spyOn(first.runtime.logger, "info");
    try {
      await runtime.services.tree.move(accountPrincipal(target.admin), target.itemId, {
        spaceId: destination.id,
        parentId: null,
      });
      await waitFor(() =>
        rechecksOf(logged.mock.calls, target.itemId).some((fields) => fields.reason === "tree"),
      );
      const entry = (await runtime.services.spacePermissions.list(destination.id)).find(
        (candidate) => candidate.principalId === target.account,
      );
      await runtime.services.spacePermissions.apply(accountPrincipal(target.admin), destination.id, {
        action: "change",
        permissionId: entry?.id ?? "",
        role: "reader",
      });
      await waitFor(() => client.closeReasons.includes("permissionRevoked"), 3000);
    } finally {
      logged.mockRestore();
    }
  });

  it("disconnects a person who leaves the group that gave them the edit permission", async () => {
    const target = await page();
    const runtime = cluster.runtimes[0] as ServerRuntime;
    const account = await cluster.fixtures.member(target.org.id);
    const group = await cluster.fixtures.group(target.org.id, [account]);
    await runtime.services.spacePermissions.apply(accountPrincipal(target.admin), target.space.id, {
      action: "grant",
      principalKind: "group",
      principalId: group,
      role: "editor",
    });
    const client = open(first.url, target.itemId, { token: await signIn(runtime, account) });
    await client.authenticated;
    await cluster.runtimes[1]?.services.groups.removeMember(SYSTEM, group, account);
    await waitFor(() => client.closeReasons.includes("permissionRevoked"), 3000);
  });

  it("disconnects a person whose membership in the organization of the page ends", async () => {
    const target = await page();
    const runtime = cluster.runtimes[0] as ServerRuntime;
    const home = await cluster.fixtures.organization();
    const account = await cluster.fixtures.member(home.id);
    await cluster.fixtures.join(target.org.id, account);
    await runtime.services.spacePermissions.apply(accountPrincipal(target.admin), target.space.id, {
      action: "grant",
      principalKind: "account",
      principalId: account,
      role: "editor",
    });
    const client = open(first.url, target.itemId, { token: await signIn(runtime, account) });
    await client.authenticated;
    await cluster.runtimes[1]?.services.memberships.remove(
      accountPrincipal(target.org.owner),
      target.org.id,
      account,
    );
    await waitFor(() => client.closeReasons.includes("permissionRevoked"), 3000);
  });

  it("logs every recheck and revocation with page, account, node, reason, duration and result only", async () => {
    const target = await editor();
    await signalsDelivered();
    const client = open(first.url, target.itemId, { token: target.token });
    await client.authenticated;
    const logged = vi.spyOn(first.runtime.logger, "info");
    try {
      await first.runtime.services.spaces.update(accountPrincipal(target.admin), target.space.id, {
        description: "Changed",
      });
      const entry = (await first.runtime.services.spacePermissions.list(target.space.id)).find(
        (candidate) => candidate.principalId === target.account,
      );
      await first.runtime.services.spacePermissions.apply(accountPrincipal(target.admin), target.space.id, {
        action: "change",
        permissionId: entry?.id ?? "",
        role: "reader",
      });
      await waitFor(() => client.closeReasons.includes("permissionRevoked"), 3000);
      const lines = rechecksOf(logged.mock.calls, target.itemId);
      expect(lines.at(-1)).toEqual({
        itemId: target.itemId,
        accountId: target.account,
        node: first.runtime.services.documents.origin,
        reason: "access",
        durationMs: expect.any(Number),
        result: "permissionRevoked",
      });
      expect(lines.slice(0, -1).every((fields) => fields.result === "kept")).toBe(true);
    } finally {
      logged.mockRestore();
    }
  });

  it("names the most specific signal when one recheck answers several", async () => {
    const target = await editor();
    const client = open(first.url, target.itemId, { token: target.token });
    await client.authenticated;
    const services = first.runtime.services;
    const explain = services.authorization.explain.bind(services.authorization);
    let holding: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      holding = resolve;
    });
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const checking = vi.spyOn(services.authorization, "explain").mockImplementation(async (...args) => {
      if (args[2].id === target.itemId) {
        holding();
        await released;
      }
      return explain(...args);
    });
    const logged = vi.spyOn(first.runtime.logger, "info");
    try {
      await notify(SPACE_CHANGES_CHANNEL, { spaceId: target.space.id, kind: "tree", itemId: null });
      await held;
      logged.mockClear();
      await notify(AUDIT_CHANGES_CHANNEL, {
        scope: "organization",
        organizationId: target.org.id,
        target: "group",
      });
      await notify(SPACE_CHANGES_CHANNEL, { spaceId: target.space.id, kind: "access", itemId: null });
      await signalsDelivered();
      release();
      await waitFor(() => rechecksOf(logged.mock.calls, target.itemId).length === 2);
      expect(rechecksOf(logged.mock.calls, target.itemId)[1]).toEqual({
        itemId: target.itemId,
        accountId: target.account,
        node: services.documents.origin,
        reason: "access",
        durationMs: expect.any(Number),
        result: "kept",
      });
    } finally {
      release();
      checking.mockRestore();
      logged.mockRestore();
    }
  });

  it("disconnects a person whose connection was being opened while they lost the edit permission", async () => {
    const target = await editor();
    const runtime = cluster.runtimes[0] as ServerRuntime;
    const other = await runtime.services.tree.create(accountPrincipal(target.admin), target.space.id, {
      kind: "page",
      title: "Second page",
      mode: "live",
      placement: { parentId: null },
    });
    const editing = open(first.url, target.itemId, { token: target.token });
    await editing.authenticated;
    const documents = first.runtime.services.documents;
    const stored = documents.stored.bind(documents);
    let loading: () => void = () => undefined;
    const loadingStarted = new Promise<void>((resolve) => {
      loading = resolve;
    });
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held = vi.spyOn(documents, "stored").mockImplementation(async (itemId) => {
      if (itemId === other.id) {
        loading();
        await released;
      }
      return stored(itemId);
    });
    try {
      const opening = open(first.url, other.id, { token: target.token });
      await loadingStarted;
      const entry = (await runtime.services.spacePermissions.list(target.space.id)).find(
        (candidate) => candidate.principalId === target.account,
      );
      await cluster.runtimes[1]?.services.spacePermissions.apply(
        accountPrincipal(target.admin),
        target.space.id,
        {
          action: "change",
          permissionId: entry?.id ?? "",
          role: "reader",
        },
      );
      await waitFor(() => editing.closeReasons.includes("permissionRevoked"), 3000);
      release();
      await opening.authenticated;
      await waitFor(() => opening.closeReasons.includes("permissionRevoked"), 3000);
    } finally {
      release();
      held.mockRestore();
    }
  });

  it("closes connections whose permission cannot be checked instead of keeping them", async () => {
    const target = await editor();
    const client = open(first.url, target.itemId, { token: target.token });
    await client.authenticated;
    const services = first.runtime.services;
    const failing = vi.spyOn(services.authorization, "explain").mockRejectedValue(new Error("database down"));
    try {
      await services.spaces.update(accountPrincipal(target.admin), target.space.id, {
        description: "Changed",
      });
      await services.spaces.changeVisibility(accountPrincipal(target.admin), target.space.id, "organization");
      await waitFor(() => client.closeReasons.includes("unavailable"), 3000);
    } finally {
      failing.mockRestore();
    }
  });

  it("closes connections whose recheck fails unexpectedly and keeps rechecking the others", async () => {
    const concurrency = Math.floor(first.runtime.config.database.poolSize / 2);
    const failing = await editor();
    const broken = Array.from({ length: concurrency }, () =>
      open(first.url, failing.itemId, { token: failing.token }),
    );
    await Promise.all(broken.map((client) => client.authenticated));
    const target = await editor();
    const client = open(first.url, target.itemId, { token: target.token });
    await client.authenticated;
    const logger = first.runtime.logger;
    const info = logger.info.bind(logger);
    const logged = vi.spyOn(logger, "info").mockImplementation(((...args: unknown[]) => {
      const [fields, message] = args as [Record<string, unknown>, string];
      if (message === "Collaboration permission rechecked" && fields.itemId === failing.itemId) {
        throw new Error("log sink failed");
      }
      return (info as (...rest: unknown[]) => void)(...args);
    }) as typeof logger.info);
    try {
      await notify(SPACE_CHANGES_CHANNEL, { spaceId: failing.space.id, kind: "access", itemId: null });
      await waitFor(() => broken.every((opened) => opened.closeReasons.includes("unavailable")), 3000);
      const entry = (await first.runtime.services.spacePermissions.list(target.space.id)).find(
        (candidate) => candidate.principalId === target.account,
      );
      await first.runtime.services.spacePermissions.apply(accountPrincipal(target.admin), target.space.id, {
        action: "change",
        permissionId: entry?.id ?? "",
        role: "reader",
      });
      await waitFor(() => client.closeReasons.includes("permissionRevoked"), 3000);
    } finally {
      logged.mockRestore();
    }
  });

  it("brings content written through the API to open editors at once", async () => {
    const target = await editor();
    const client = open(first.url, target.itemId, { token: target.token });
    await client.authenticated;
    await cluster.runtimes[1]?.services.documents.replace(accountPrincipal(target.admin), target.itemId, {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Written through the API" }] }],
    });
    await waitFor(() => textOf(client.doc).includes("Written through the API"), 3000);
  });

  it("loses no update when two nodes without Redis store the same page", async () => {
    const target = await editor();
    const left = open(first.url, target.itemId, { token: target.token });
    const right = open(second.url, target.itemId, { token: target.token });
    await Promise.all([left.authenticated, right.authenticated]);
    appendParagraph(left.doc, "From the left node");
    appendParagraph(right.doc, "From the right node");
    await waitFor(async () => {
      const stored = await snapshot(target.itemId);
      return stored.includes("From the left node") && stored.includes("From the right node");
    });
    await waitFor(() => textOf(left.doc) === textOf(right.doc));
    expect(textOf(left.doc)).toContain("From the right node");
  });

  describe.skipIf(!redisUrl)("with Redis", () => {
    it("keeps clients on different nodes identical", async () => {
      const target = await editor();
      const one = await cluster.node({ redisUrl });
      const two = await cluster.node({ redisUrl });
      const writers = [
        open(one.url, target.itemId, { token: target.token }),
        open(two.url, target.itemId, { token: target.token }),
      ];
      await Promise.all(writers.map((writer) => writer.authenticated));
      for (let round = 0; round < 10; round++) {
        appendParagraph(writers[0]?.doc as Y.Doc, `One ${round}`);
        appendParagraph(writers[1]?.doc as Y.Doc, `Two ${round}`);
      }
      await waitFor(
        () => textOf(writers[0]?.doc as Y.Doc) === textOf(writers[1]?.doc as Y.Doc),
        STORE_DEBOUNCE_MS - 100,
      );
      const text = textOf(writers[0]?.doc as Y.Doc);
      expect(text).toContain("One 9");
      expect(text).toContain("Two 9");
      await waitFor(async () => (await snapshot(target.itemId)).includes("Two 9"));
    });
  });
});
