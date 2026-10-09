import { documentFromYDoc } from "@pagehall/editor-schema/yjs";
import { accountPrincipal, type ServerRuntime } from "@pagehall/server";
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

function textOf(doc: Y.Doc): string {
  return JSON.stringify(documentFromYDoc(doc));
}

describe.skipIf(!baseUrl)("collaboration server", () => {
  let cluster: Cluster;
  let first: Node;
  let second: Node;
  const clients: Client[] = [];

  beforeAll(async () => {
    cluster = await createCluster(baseUrl ?? "");
    first = await cluster.node();
    second = await cluster.node();
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
