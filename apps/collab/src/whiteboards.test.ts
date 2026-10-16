import { MAX_SCENE_BYTES, SCENE_ELEMENTS, SCENE_FILES } from "@pagehall/editor-schema/scene";
import { accountPrincipal, type ServerRuntime } from "@pagehall/server";
import { testDatabaseBaseUrl } from "@pagehall/server/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
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

function element(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    type: "rectangle",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roundness: null,
    roughness: 1,
    opacity: 100,
    seed: 1,
    version: 1,
    versionNonce: 1,
    index: "a0",
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: Date.now(),
    link: null,
    locked: false,
    ...extra,
  };
}

function text(id: string, value: string, extra: Record<string, unknown> = {}) {
  return element(id, {
    type: "text",
    fontSize: 20,
    fontFamily: 5,
    text: value,
    originalText: value,
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
    ...extra,
  });
}

function stroke(id: string, points: number) {
  return element(id, {
    type: "freedraw",
    points: Array.from({ length: points }, (_, index) => [100_000.123456 + index, 100_000.123456 + index]),
    pressures: [],
    simulatePressure: true,
    lastCommittedPoint: null,
  });
}

describe.skipIf(!baseUrl)("whiteboards in the collaboration server", () => {
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

  function runtime(): ServerRuntime {
    return cluster.runtimes[0] as ServerRuntime;
  }

  function open(url: string, itemId: string, options: Parameters<typeof connect>[2] = {}): Client {
    const client = connect(url, itemId, { kind: "whiteboard", ...options });
    clients.push(client);
    return client;
  }

  async function board(role: "editor" | "reader" = "editor") {
    const { organization, member, space } = cluster.fixtures;
    const org = await organization();
    const admin = await member(org.id);
    const person = await member(org.id);
    const created = await space(org.id, admin, {
      grants: [{ principalKind: "account", principalId: person, role }],
    });
    const item = await runtime().services.tree.create(accountPrincipal(admin), created.id, {
      kind: "whiteboard",
      title: `Board ${Math.random().toString(36).slice(2, 8)}`,
      placement: { parentId: null },
    });
    return { org, admin, person, space: created, itemId: item.id, token: await signIn(runtime(), person) };
  }

  async function scene(itemId: string) {
    return (await runtime().services.whiteboards.scene(itemId))?.scene;
  }

  async function rejections(itemId: string) {
    const result = await runtime().pool.query<{ fields: Record<string, unknown> }>(
      "select fields from audit_events where name = 'whiteboard.updateRejected' and target_id = $1",
      [itemId],
    );
    return result.rows.map((row) => row.fields);
  }

  async function refusal(client: Client): Promise<string> {
    return client.authenticated.then(
      () => "accepted",
      (error: Error) => error.message,
    );
  }

  async function closed(node: Node, itemId: string) {
    const name = `whiteboard:${itemId}`;
    const server = node.server.hocuspocus;
    await waitFor(() => !server.documents.has(name) && !server.unloadingDocuments.has(name));
  }

  it("lets two people draw at once and converges on one scene", async () => {
    const target = await board();
    const a = open(first.url, target.itemId, { token: target.token });
    const b = open(first.url, target.itemId, { token: target.token });
    await Promise.all([a.authenticated, b.authenticated]);
    a.doc.getMap(SCENE_ELEMENTS).set("shape", element("shape"));
    b.doc.getMap(SCENE_ELEMENTS).set("note", text("note", "Uplink auf 10G?", { index: "a1" }));
    a.doc.getMap(SCENE_ELEMENTS).set("shape", element("shape", { x: 300, version: 2, versionNonce: 7 }));
    await waitFor(() => a.doc.getMap(SCENE_ELEMENTS).size === 2 && b.doc.getMap(SCENE_ELEMENTS).size === 2);
    await waitFor(() => (b.doc.getMap(SCENE_ELEMENTS).get("shape") as { x?: number } | undefined)?.x === 300);
    expect(a.doc.getMap(SCENE_ELEMENTS).toJSON()).toEqual(b.doc.getMap(SCENE_ELEMENTS).toJSON());
    await waitFor(async () => (await scene(target.itemId))?.elements.length === 2);
    const stored = await scene(target.itemId);
    expect(stored?.elements.map((entry) => entry.id)).toEqual(["shape", "note"]);
    await waitFor(() => a.stateless.some((message) => message.type === "saved"));
  });

  it("refuses readers, people without access and the wrong document kind", async () => {
    const reader = await board("reader");
    expect(await refusal(open(first.url, reader.itemId, { token: reader.token }))).toBe("noEditPermission");
    const outsider = await cluster.fixtures.member(reader.org.id);
    expect(await refusal(open(first.url, reader.itemId, { token: await signIn(runtime(), outsider) }))).toBe(
      "pageNotFound",
    );
    const editor = await board();
    expect(await refusal(open(first.url, editor.itemId, { token: editor.token, kind: "page" }))).toBe(
      "pageNotFound",
    );
    const page = await runtime().services.tree.create(accountPrincipal(editor.admin), editor.space.id, {
      kind: "page",
      title: "A page",
      mode: "live",
      placement: { parentId: null },
    });
    expect(await refusal(open(first.url, page.id, { token: editor.token }))).toBe("pageNotFound");
    expect(await refusal(open(first.url, editor.itemId, { token: editor.token }))).toBe("accepted");
  });

  describe("rejects updates", () => {
    it("with element types that embed web content, and stores nothing", async () => {
      const target = await board();
      const client = open(first.url, target.itemId, { token: target.token });
      await client.authenticated;
      client.doc
        .getMap(SCENE_ELEMENTS)
        .set("frame", element("frame", { type: "embeddable", link: "https://evil.example" }));
      await waitFor(() => client.closeReasons.includes("updateRejected"));
      await closed(first, target.itemId);
      expect((await scene(target.itemId))?.elements).toEqual([]);
      const [event] = await rejections(target.itemId);
      expect(event).toMatchObject({ reason: "invalidScene", problems: ["unknownElementType"] });
      expect(JSON.stringify(event)).not.toContain("evil.example");
    });

    it("with links to scripts, images from other places and foreign shared types", async () => {
      const cases: ((doc: Y.Doc) => void)[] = [
        (doc) => doc.getMap(SCENE_ELEMENTS).set("a", element("a", { link: "javascript:alert(1)" })),
        (doc) =>
          doc
            .getMap(SCENE_FILES)
            .set("file", { dataURL: "https://evil.example/a.png", mimeType: "image/png" }),
        (doc) => doc.getMap(SCENE_ELEMENTS).set("a", element("b")),
        (doc) => doc.getXmlFragment("default").push([new Y.XmlElement("paragraph")]),
      ];
      for (const change of cases) {
        const target = await board();
        const client = open(first.url, target.itemId, { token: target.token });
        await client.authenticated;
        change(client.doc);
        await waitFor(() => client.closeReasons.includes("updateRejected"));
        expect(await rejections(target.itemId)).toHaveLength(1);
      }
    });

    it("that take the scene above its size limit across several updates", async () => {
      const target = await board();
      const client = open(first.url, target.itemId, { token: target.token });
      await client.authenticated;
      const perElement = JSON.stringify(stroke("x", 12_000)).length;
      const needed = Math.ceil(MAX_SCENE_BYTES / perElement) + 1;
      for (let index = 0; index < needed && !client.closeReasons.includes("updateRejected"); index += 1) {
        client.doc.getMap(SCENE_ELEMENTS).set(`s${index}`, stroke(`s${index}`, 12_000));
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await waitFor(() => client.closeReasons.includes("updateRejected"), 20_000);
      expect(await rejections(target.itemId)).toEqual([
        expect.objectContaining({ reason: "invalidScene", problems: ["tooLarge"] }),
      ]);
    }, 60_000);
  });

  it("disconnects a person at once when their access to the board ends during a session", async () => {
    const target = await board();
    const client = open(first.url, target.itemId, { token: target.token });
    await client.authenticated;
    const services = (cluster.runtimes[1] as ServerRuntime).services;
    const entry = (await services.spacePermissions.list(target.space.id)).find(
      (candidate) => candidate.principalId === target.person,
    );
    await services.spacePermissions.apply(accountPrincipal(target.admin), target.space.id, {
      action: "remove",
      permissionId: entry?.id ?? "",
    });
    await waitFor(() => client.closeReasons.includes("permissionRevoked"), 3000);
  });

  it("keeps a version with its contributors when the last person leaves", async () => {
    const target = await board();
    const client = open(second.url, target.itemId, { token: target.token });
    await client.authenticated;
    client.doc.getMap(SCENE_ELEMENTS).set("t", text("t", "Wartungsfenster Sa 06:00"));
    await waitFor(async () => (await scene(target.itemId))?.elements.length === 1);
    client.destroy();
    await closed(second, target.itemId);
    await waitFor(async () => (await runtime().services.whiteboards.list(target.itemId)).length === 1);
    const [version] = await runtime().services.whiteboards.list(target.itemId);
    expect(version).toMatchObject({ number: 1, reason: "session" });
    expect(version?.contributors.map((person) => person.id)).toEqual([target.person]);
    const content = await runtime().services.whiteboards.get(target.itemId, 1);
    expect(content?.scene.elements.map((entry) => entry.id)).toEqual(["t"]);
  });

  it("brings a restored version to open boards at once", async () => {
    const target = await board();
    const client = open(first.url, target.itemId, { token: target.token });
    await client.authenticated;
    client.doc.getMap(SCENE_ELEMENTS).set("t", text("t", "Erste Fassung"));
    await waitFor(async () => (await scene(target.itemId))?.elements.length === 1);
    await (cluster.runtimes[1] as ServerRuntime).services.whiteboards.versionLiveSession(target.itemId);
    client.doc.getMap(SCENE_ELEMENTS).set("t", text("t", "Zweite Fassung", { version: 5 }));
    await waitFor(async () => JSON.stringify(await scene(target.itemId)).includes("Zweite Fassung"));
    await (cluster.runtimes[1] as ServerRuntime).services.whiteboards.restore(
      accountPrincipal(target.admin),
      target.itemId,
      1,
    );
    await waitFor(() => JSON.stringify(client.doc.getMap(SCENE_ELEMENTS).get("t")).includes("Erste Fassung"));
  });
});
