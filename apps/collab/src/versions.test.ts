import { documentFromYDoc } from "@lunedo/editor-schema/yjs";
import { accountPrincipal, type PageMode, type ServerRuntime } from "@lunedo/server";
import { testDatabaseBaseUrl } from "@lunedo/server/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type * as Y from "yjs";
import {
  appendParagraph,
  type Client,
  type Cluster,
  connect,
  createCluster,
  type Node,
  signIn,
  waitFor,
} from "./harness.testing.js";

const baseUrl = testDatabaseBaseUrl();

function textOf(doc: Y.Doc): string {
  return JSON.stringify(documentFromYDoc(doc));
}

function documentWith(text: string) {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

describe.skipIf(!baseUrl)("versions with open editors", () => {
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

  function services() {
    return (cluster.runtimes[0] as ServerRuntime).services;
  }

  async function page(mode: PageMode) {
    const { organization, member, space } = cluster.fixtures;
    const org = await organization();
    const admin = await member(org.id);
    const created = await space(org.id, admin);
    const item = await services().tree.create(accountPrincipal(admin), created.id, {
      kind: "page",
      title: `Page ${Math.random().toString(36).slice(2, 8)}`,
      mode,
      placement: { parentId: null },
    });
    const token = await signIn(cluster.runtimes[0] as ServerRuntime, admin);
    return { admin: accountPrincipal(admin), itemId: item.id, token };
  }

  async function closed(node: Node, itemId: string) {
    const name = `page:${itemId}`;
    const server = node.server.hocuspocus;
    await waitFor(() => !server.documents.has(name) && !server.unloadingDocuments.has(name));
  }

  async function stored(itemId: string, text: string) {
    await waitFor(async () =>
      JSON.stringify((await services().documents.snapshot(itemId))?.document).includes(text),
    );
  }

  it("creates exactly one version of a live session edited on two nodes", async () => {
    const target = await page("live");
    const left = open(first.url, target.itemId, { token: target.token });
    const right = open(second.url, target.itemId, { token: target.token });
    await Promise.all([left.authenticated, right.authenticated]);
    appendParagraph(left.doc, "Left");
    appendParagraph(right.doc, "Right");
    await stored(target.itemId, "Left");
    await stored(target.itemId, "Right");
    left.destroy();
    await closed(first, target.itemId);
    expect(await services().versions.list(target.itemId)).toHaveLength(0);
    right.destroy();
    await closed(second, target.itemId);
    const versions = await services().versions.list(target.itemId);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.reason).toBe("session");
  });

  it("shows a restored version to an open editor in publish mode without publishing it", async () => {
    const target = await page("publish");
    await services().documents.replace(target.admin, target.itemId, documentWith("Version one"));
    await services().versions.publish(target.admin, target.itemId);
    const client = open(first.url, target.itemId, { token: target.token });
    await client.authenticated;
    appendParagraph(client.doc, "Draft work");
    await stored(target.itemId, "Draft work");
    await (cluster.runtimes[1] as ServerRuntime).services.versions.restore(target.admin, target.itemId, 1);
    await waitFor(
      () => !textOf(client.doc).includes("Draft work") && textOf(client.doc).includes("Version one"),
    );
    expect((await services().versions.list(target.itemId)).map((version) => version.number)).toEqual([1]);
  });

  it("shows a restored version to an open editor in live mode as a new version", async () => {
    const target = await page("live");
    await services().documents.replace(target.admin, target.itemId, documentWith("First state"));
    await services().versions.versionLiveSession(target.itemId);
    await services().documents.replace(target.admin, target.itemId, documentWith("Second state"));
    const client = open(second.url, target.itemId, { token: target.token });
    await client.authenticated;
    await services().versions.restore(target.admin, target.itemId, 1);
    await waitFor(() => textOf(client.doc).includes("First state"));
    expect((await services().versions.list(target.itemId))[0]).toMatchObject({
      reason: "restored",
      restoredFrom: 1,
    });
  });

  it("resets the draft of open editors when someone discards it", async () => {
    const target = await page("publish");
    await services().documents.replace(target.admin, target.itemId, documentWith("Published"));
    await services().versions.publish(target.admin, target.itemId);
    const client = open(first.url, target.itemId, { token: target.token });
    await client.authenticated;
    appendParagraph(client.doc, "Throwaway");
    await stored(target.itemId, "Throwaway");
    await (cluster.runtimes[1] as ServerRuntime).services.versions.discard(target.admin, target.itemId);
    await waitFor(() => !textOf(client.doc).includes("Throwaway"));
  });

  it("makes archived pages read-only for open and new editors", async () => {
    const target = await page("live");
    const client = open(first.url, target.itemId, { token: target.token });
    await client.authenticated;
    await (cluster.runtimes[1] as ServerRuntime).services.archive.archive(target.admin, target.itemId);
    await waitFor(() => client.closeReasons.includes("permissionRevoked"), 3000);
    const again = open(second.url, target.itemId, { token: target.token });
    expect(
      await again.authenticated.then(
        () => "accepted",
        (error: Error) => error.message,
      ),
    ).toBe("noEditPermission");
  });
});
