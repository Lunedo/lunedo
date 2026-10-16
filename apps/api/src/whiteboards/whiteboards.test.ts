import { randomBytes } from "node:crypto";
import { accountAttemptLimitSetting, clientAttemptLimitSetting, recordClient } from "@pagehall/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  addTotp,
  completeConfiguredSetup,
  configuredSetupEnv,
  createAccount,
  firstOrganizationId,
  OWNER,
  signedInClient,
} from "../testing/accounts.js";
import { type AuthTestApp, createAuthTestApp, databaseBaseUrl, TestClient } from "../testing/auth-app.js";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(200)]);
const SVG_NS = 'xmlns="http://www.w3.org/2000/svg"';

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
    backgroundColor: "#ffec99",
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
    backgroundColor: "transparent",
    fontSize: 20,
    fontFamily: 5,
    text: value,
    originalText: value,
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
    index: "a1",
    ...extra,
  });
}

describe.skipIf(!databaseBaseUrl)("whiteboards through the API", () => {
  let test: AuthTestApp;
  let owner: TestClient;
  let ownerId: string;
  let organizationId: string;
  let counter = 0;

  beforeAll(async () => {
    test = await createAuthTestApp(configuredSetupEnv);
    await completeConfiguredSetup(test);
    await test.runtime.settings.set(clientAttemptLimitSetting, {}, "instance", 10_000);
    await test.runtime.settings.set(accountAttemptLimitSetting, {}, "instance", 1000);
    owner = new TestClient(test.app);
    await owner.post("/api/v1/auth/sign-in", OWNER);
    await addTotp(owner);
    ownerId = (
      await test.runtime.pool.query<{ id: string }>("select id from accounts where email = $1", [OWNER.email])
    ).rows[0]?.id as string;
    organizationId = await firstOrganizationId(test);
  });

  afterAll(async () => {
    await test?.close();
  });

  async function person() {
    counter += 1;
    const email = `boards${counter}@pagehall.test`;
    const password = "a long enough passphrase";
    const { id } = await createAccount(test, email, password);
    return { id, client: await signedInClient(test, email, password) };
  }

  async function space(grants: unknown[] = []) {
    counter += 1;
    const created = await owner.post(`/api/v1/organizations/${organizationId}/spaces`, {
      name: `Boards ${counter}`,
      key: `B${counter}W`,
      visibility: "private",
      grants,
    });
    expect(created.statusCode, created.body).toBe(201);
    return created.json().id as string;
  }

  async function board(spaceId: string, parentId: string | null = null) {
    const created = await owner.post(`/api/v1/spaces/${spaceId}/items`, {
      kind: "whiteboard",
      title: "Netzwerk-Umbau 2027",
      parentId,
    });
    expect(created.statusCode, created.body).toBe(201);
    return created.json() as { id: string; kind: string; mode: string };
  }

  async function draw(itemId: string, actorId: string, change: (doc: Y.Doc) => void): Promise<number> {
    const stored = await test.runtime.services.whiteboards.stored(itemId);
    const doc = new Y.Doc();
    if (stored) Y.applyUpdate(doc, stored.state);
    await recordClient(test.runtime.database, itemId, doc.clientID, actorId);
    change(doc);
    const revision = await test.runtime.services.whiteboards.store(itemId, doc, { actorId });
    doc.destroy();
    return revision;
  }

  function svg(body: string) {
    return Buffer.from(`<svg ${SVG_NS} viewBox="0 0 10 10">${body}</svg>`);
  }

  it("creates, renames, moves, trashes and restores a whiteboard like a page", async () => {
    const spaceId = await space();
    const folder = await owner.post(`/api/v1/spaces/${spaceId}/items`, {
      kind: "folder",
      title: "Netzwerk",
      parentId: null,
    });
    const created = await board(spaceId);
    expect(created).toMatchObject({ kind: "whiteboard", mode: "live" });
    const scene = await owner.get(`/api/v1/whiteboards/${created.id}/scene`);
    expect(scene.statusCode, scene.body).toBe(200);
    expect(scene.json()).toMatchObject({
      scene: { elements: [], files: {}, settings: { viewBackgroundColor: null } },
      preview: false,
    });
    const renamed = await owner.patch(`/api/v1/items/${created.id}`, { title: "Umbau Graz" });
    expect(renamed.json()).toMatchObject({ title: "Umbau Graz" });
    const moved = await owner.post(`/api/v1/items/${created.id}/move`, {
      spaceId,
      parentId: folder.json().id,
    });
    expect(moved.statusCode, moved.body).toBe(200);
    const below = await owner.post(`/api/v1/spaces/${spaceId}/items`, {
      kind: "page",
      title: "Below a board",
      parentId: created.id,
    });
    expect(below.statusCode).toBe(400);
    expect((await owner.delete(`/api/v1/items/${created.id}`)).statusCode).toBe(200);
    expect((await owner.get(`/api/v1/whiteboards/${created.id}/scene`)).statusCode).toBe(404);
    const trash = await owner.get(`/api/v1/spaces/${spaceId}/trash`);
    const entry = (trash.json() as { id: string; itemKind: string }[]).find(
      (candidate) => candidate.itemKind === "whiteboard",
    );
    const restored = await owner.post(`/api/v1/spaces/${spaceId}/trash/${entry?.id}/restore`, {});
    expect(restored.statusCode, restored.body).toBe(200);
    expect((await owner.get(`/api/v1/whiteboards/${created.id}/scene`)).statusCode).toBe(200);
    const archived = await owner.post(`/api/v1/items/${created.id}/archive`, {});
    expect(archived.statusCode, archived.body).toBe(204);
    expect((await owner.get(`/api/v1/whiteboards/${created.id}/scene`)).statusCode).toBe(200);
    const readOnly = await owner.put(`/api/v1/whiteboards/${created.id}/preview?revision=1`, svg("<rect/>"), {
      "content-type": "application/octet-stream",
    });
    expect(readOnly.statusCode).toBe(403);
  });

  it("lets readers see a board but not change it, and keeps people without access out", async () => {
    const reader = await person();
    const outsider = await person();
    const spaceId = await space([{ principalKind: "account", principalId: reader.id, role: "reader" }]);
    const { id } = await board(spaceId);
    const revision = await draw(id, ownerId, (doc) => doc.getMap("elements").set("t", text("t", "Wartung")));
    expect(
      (
        await owner.put(`/api/v1/whiteboards/${id}/preview?revision=${revision}`, svg("<rect/>"), {
          "content-type": "application/octet-stream",
        })
      ).statusCode,
    ).toBe(200);
    await test.runtime.services.whiteboards.versionLiveSession(id);
    for (const path of ["scene", "preview", "versions", "versions/1", "preview?version=1"]) {
      expect((await reader.client.get(`/api/v1/whiteboards/${id}/${path}`)).statusCode, path).toBe(200);
      expect((await outsider.client.get(`/api/v1/whiteboards/${id}/${path}`)).statusCode, path).toBe(404);
    }
    expect(
      (
        await reader.client.put(`/api/v1/whiteboards/${id}/preview?revision=${revision}`, svg("<rect/>"), {
          "content-type": "application/octet-stream",
        })
      ).statusCode,
    ).toBe(403);
    expect((await reader.client.post(`/api/v1/whiteboards/${id}/versions/1/restore`, {})).statusCode).toBe(
      403,
    );
    expect((await outsider.client.get(`/api/v1/pages/${id}/comments`)).statusCode).toBe(404);
  });

  it("follows view restrictions and shares", async () => {
    const reader = await person();
    const guest = await person();
    const spaceId = await space([{ principalKind: "account", principalId: reader.id, role: "reader" }]);
    const { id } = await board(spaceId);
    const restricted = await owner.post(`/api/v1/pages/${id}/access`, {
      changes: [{ action: "restrict", kind: "view" }],
    });
    expect(restricted.statusCode, restricted.body).toBe(200);
    expect((await reader.client.get(`/api/v1/whiteboards/${id}/scene`)).statusCode).toBe(404);
    expect((await reader.client.get(`/api/v1/whiteboards/${id}/preview`)).statusCode).toBe(404);
    const shared = await owner.post(`/api/v1/pages/${id}/access`, {
      changes: [{ action: "share", holderKind: "account", holderId: guest.id, role: "reader" }],
    });
    expect(shared.statusCode, shared.body).toBe(200);
    expect((await guest.client.get(`/api/v1/whiteboards/${id}/scene`)).statusCode).toBe(200);
    const notified = await test.runtime.pool.query<{ params: { itemKind: string } }>(
      "select params from notifications where recipient_id = $1 and type = 'page.shared' and target_id = $2",
      [guest.id, id],
    );
    expect(notified.rows[0]?.params.itemKind).toBe("whiteboard");
  });

  it("stores previews sanitized, serves them in a sandbox and ignores outdated ones", async () => {
    const spaceId = await space();
    const { id } = await board(spaceId);
    const first = await draw(id, ownerId, (doc) => doc.getMap("elements").set("a", element("a")));
    const second = await draw(id, ownerId, (doc) =>
      doc.getMap("elements").set("b", element("b", { index: "a1" })),
    );
    const upload = (revision: number, body: Buffer) =>
      owner.put(`/api/v1/whiteboards/${id}/preview?revision=${revision}`, body, {
        "content-type": "application/octet-stream",
      });
    const stored = await upload(second, svg('<script>alert(1)</script><rect onload="alert(2)" width="5"/>'));
    expect(stored.json()).toEqual({ kept: true });
    expect((await upload(first, svg("<rect/>"))).json()).toEqual({ kept: false });
    expect((await upload(second + 5, svg("<rect/>"))).statusCode).toBe(409);
    expect((await upload(second, Buffer.from("<html/>"))).statusCode).toBe(400);
    const served = await owner.get(`/api/v1/whiteboards/${id}/preview`);
    expect(served.statusCode).toBe(200);
    expect(served.headers["content-type"]).toBe("image/svg+xml");
    expect(served.headers["content-security-policy"]).toMatch(/^sandbox;/);
    expect(served.headers["x-content-type-options"]).toBe("nosniff");
    expect(served.body).toContain('<rect width="5">');
    expect(served.body).not.toMatch(/script|onload|alert/);
  });

  it("keeps versions with their image and restores them as a new version", async () => {
    const spaceId = await space();
    const { id } = await board(spaceId);
    const revision = await draw(id, ownerId, (doc) =>
      doc.getMap("elements").set("t", text("t", "Erste Fassung")),
    );
    await test.runtime.services.whiteboards.versionLiveSession(id);
    await owner.put(
      `/api/v1/whiteboards/${id}/preview?revision=${revision}`,
      svg('<text x="1">Erste</text>'),
      {
        "content-type": "application/octet-stream",
      },
    );
    await draw(id, ownerId, (doc) =>
      doc.getMap("elements").set("t", text("t", "Zweite Fassung", { version: 3 })),
    );
    await test.runtime.services.whiteboards.versionLiveSession(id);
    const versions = await owner.get(`/api/v1/whiteboards/${id}/versions`);
    expect(versions.json()).toMatchObject([
      { number: 2, reason: "session", preview: false },
      { number: 1, reason: "session", preview: true, contributors: [{ id: ownerId }] },
    ]);
    expect((await owner.get(`/api/v1/whiteboards/${id}/preview?version=1`)).body).toContain("Erste");
    expect((await owner.get(`/api/v1/whiteboards/${id}/preview?version=2`)).statusCode).toBe(404);
    const restored = await owner.post(`/api/v1/whiteboards/${id}/versions/1/restore`, {});
    expect(restored.json()).toEqual({ version: 3 });
    const scene = await owner.get(`/api/v1/whiteboards/${id}/scene`);
    expect(JSON.stringify(scene.json().scene)).toContain("Erste Fassung");
    const latest = await owner.get(`/api/v1/whiteboards/${id}/versions/3`);
    expect(latest.json()).toMatchObject({ reason: "restored", restoredFrom: 1, createdBy: { id: ownerId } });
    expect((await owner.post(`/api/v1/whiteboards/${id}/versions/9/restore`, {})).statusCode).toBe(404);
  });

  it("anchors comments to elements and keeps threads of removed elements", async () => {
    const colleague = await person();
    const spaceId = await space([{ principalKind: "account", principalId: colleague.id, role: "editor" }]);
    const { id } = await board(spaceId);
    await draw(id, ownerId, (doc) => {
      doc.getMap("elements").set("note", element("note", { customData: { stickyNote: true } }));
      doc.getMap("elements").set("label", text("label", "Uplink auf 10G?", { containerId: "note" }));
    });
    const body = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "mention", attrs: { id: colleague.id } },
            { type: "text", text: " passt das?" },
          ],
        },
      ],
    };
    const created = await owner.post(`/api/v1/pages/${id}/comments`, { body, elementId: "note" });
    expect(created.statusCode, created.body).toBe(201);
    const onText = await owner.post(`/api/v1/pages/${id}/comments`, {
      body,
      anchor: { exact: "Uplink", prefix: "", suffix: "" },
    });
    expect(onText.statusCode).toBe(400);
    const missing = await owner.post(`/api/v1/pages/${id}/comments`, { body, elementId: "gone" });
    expect(missing.statusCode).toBe(409);
    const listed = await colleague.client.get(`/api/v1/pages/${id}/comments`);
    expect(listed.json().threads).toMatchObject([
      { anchor: "element", elementId: "note", quote: "Uplink auf 10G?" },
    ]);
    const mentioned = await test.runtime.pool.query(
      "select 1 from notifications where recipient_id = $1 and type = 'content.mentioned' and target_id = $2",
      [colleague.id, id],
    );
    expect(mentioned.rowCount).toBe(1);
    expect(
      (await owner.put(`/api/v1/comments/${created.json().id}/resolved`, { resolved: true })).statusCode,
    ).toBe(204);
    await draw(id, ownerId, (doc) =>
      doc.getMap("elements").set("note", element("note", { isDeleted: true, version: 2 })),
    );
    const after = await owner.get(`/api/v1/pages/${id}/comments`);
    expect(after.json().threads).toMatchObject([
      { anchor: "detached", elementId: "note", quote: "Uplink auf 10G?" },
    ]);
    await draw(id, ownerId, (doc) => doc.getMap("elements").set("note", element("note", { version: 3 })));
    expect((await owner.get(`/api/v1/pages/${id}/comments`)).json().threads[0].anchor).toBe("element");
  });

  it("finds the text of whiteboards with their own type, only for people who may read them", async () => {
    const reader = await person();
    const outsider = await person();
    const word = `whiteboardword${counter}x`;
    const spaceId = await space([{ principalKind: "account", principalId: reader.id, role: "reader" }]);
    const { id } = await board(spaceId);
    await draw(id, ownerId, (doc) => {
      doc.getMap("elements").set("t", text("t", `Wartungsfenster ${word}`));
      doc
        .getMap("elements")
        .set("gone", text("gone", `removedword${word}`, { isDeleted: true, index: "a2" }));
    });
    await test.runtime.pool.query("update search_pending_items set due_at = now()");
    await test.runtime.services.search.indexer.drain();
    const found = await reader.client.get(
      `/api/v1/organizations/${organizationId}/search?q=${word}&types=whiteboard`,
    );
    expect(found.statusCode, found.body).toBe(200);
    expect(found.json().results).toMatchObject([{ type: "whiteboard", itemType: "whiteboard", itemId: id }]);
    const pagesOnly = await reader.client.get(
      `/api/v1/organizations/${organizationId}/search?q=${word}&types=page`,
    );
    expect(pagesOnly.json().total).toBe(0);
    const byOperator = await reader.client.get(
      `/api/v1/organizations/${organizationId}/search?q=${encodeURIComponent(`${word} type:whiteboard`)}`,
    );
    expect(byOperator.json().total).toBe(1);
    expect(
      (await outsider.client.get(`/api/v1/organizations/${organizationId}/search?q=${word}`)).json().total,
    ).toBe(0);
    const removed = await reader.client.get(
      `/api/v1/organizations/${organizationId}/search?q=removedword${word}`,
    );
    expect(removed.json().total).toBe(0);
  });

  it("notifies watchers once per version, not per change", async () => {
    const watcher = await person();
    const spaceId = await space([{ principalKind: "account", principalId: watcher.id, role: "reader" }]);
    const { id } = await board(spaceId);
    expect((await watcher.client.put(`/api/v1/items/${id}/watch`, { state: "watching" })).statusCode).toBe(
      200,
    );
    for (let index = 0; index < 5; index += 1) {
      await draw(id, ownerId, (doc) => doc.getMap("elements").set(`e${index}`, element(`e${index}`)));
    }
    const count = async () =>
      (
        await test.runtime.pool.query<{ count: number }>(
          "select coalesce(sum(count), 0)::int as count from notifications where recipient_id = $1 and type = 'content.changed' and target_id = $2",
          [watcher.id, id],
        )
      ).rows[0]?.count;
    expect(await count()).toBe(0);
    await test.runtime.services.whiteboards.versionLiveSession(id);
    expect(await count()).toBe(1);
    const notification = await test.runtime.pool.query<{ params: Record<string, unknown> }>(
      "select params from notifications where recipient_id = $1 and type = 'content.changed' and target_id = $2",
      [watcher.id, id],
    );
    expect(notification.rows[0]?.params).toMatchObject({ itemKind: "whiteboard", version: 1 });
  });

  it("stores images of a board as its attachments and keeps foreign files out of the scene", async () => {
    const spaceId = await space();
    const { id } = await board(spaceId);
    const other = await board(spaceId);
    const image = await owner.post(`/api/v1/pages/${id}/attachments?name=rack.png`, PNG, {
      "content-type": "application/octet-stream",
    });
    expect(image.statusCode, image.body).toBe(201);
    const foreign = await owner.post(`/api/v1/pages/${other.id}/attachments?name=other.png`, PNG, {
      "content-type": "application/octet-stream",
    });
    await draw(id, ownerId, (doc) => {
      doc.getMap("files").set("own", { attachmentId: image.json().id, mimeType: "image/png" });
      doc.getMap("files").set("foreign", { attachmentId: foreign.json().id, mimeType: "image/png" });
      doc
        .getMap("elements")
        .set(
          "i1",
          element("i1", { type: "image", fileId: "own", status: "saved", scale: [1, 1], crop: null }),
        );
      doc.getMap("elements").set(
        "i2",
        element("i2", {
          type: "image",
          fileId: "foreign",
          status: "saved",
          scale: [1, 1],
          crop: null,
          index: "a1",
        }),
      );
    });
    const scene = await owner.get(`/api/v1/whiteboards/${id}/scene`);
    expect(Object.keys(scene.json().scene.files)).toEqual(["own"]);
  });

  describe("drawing blocks", () => {
    async function page(grants: unknown[] = []) {
      const spaceId = await space(grants);
      const created = await owner.post(`/api/v1/spaces/${spaceId}/items`, {
        kind: "page",
        title: "Standort Graz",
        parentId: null,
        mode: "publish",
      });
      return created.json().id as string;
    }

    const blockId = "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5aa0";
    const octet = { "content-type": "application/octet-stream" };

    it("store a validated scene and a sanitized image as attachment versions of the page", async () => {
      const pageId = await page();
      const scene = {
        elements: [text("t", "Serverraum EG")],
        files: {},
        settings: { viewBackgroundColor: null },
      };
      const first = await owner.put(
        `/api/v1/pages/${pageId}/drawings/${blockId}/scene`,
        Buffer.from(JSON.stringify(scene)),
        octet,
      );
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json()).toMatchObject({ sceneVersion: 1, text: "Serverraum EG" });
      const second = await owner.put(
        `/api/v1/pages/${pageId}/drawings/${blockId}/scene`,
        Buffer.from(JSON.stringify(scene)),
        octet,
      );
      expect(second.json()).toMatchObject({ sceneId: first.json().sceneId, sceneVersion: 2 });
      const image = await owner.put(
        `/api/v1/pages/${pageId}/drawings/${blockId}/preview`,
        svg('<a href="javascript:alert(1)"><text>x</text></a><image href="https://evil.example/t.png"/>'),
        octet,
      );
      expect(image.statusCode, image.body).toBe(200);
      const served = await owner.get(
        `/api/v1/attachments/${image.json().previewId}/content?version=${image.json().previewVersion}`,
      );
      expect(served.body).not.toMatch(/javascript|evil\.example/);
      const old = await owner.get(`/api/v1/attachments/${first.json().sceneId}/content?version=1`);
      expect(JSON.parse(old.body)).toMatchObject({ elements: [{ id: "t" }] });
    });

    it("refuse crafted scenes and images and people who cannot edit the page", async () => {
      const reader = await person();
      const pageId = await page([{ principalKind: "account", principalId: reader.id, role: "reader" }]);
      expect((await owner.post(`/api/v1/pages/${pageId}/publish`, {})).statusCode).toBe(200);
      const crafted = [
        "not json",
        JSON.stringify({ elements: [element("e", { type: "embeddable", link: "https://evil.example" })] }),
        JSON.stringify({ elements: [element("e", { link: "javascript:alert(1)" })] }),
        JSON.stringify({
          elements: [
            element("i", { type: "image", fileId: "f", status: "saved", scale: [1, 1], crop: null }),
          ],
          files: { f: { attachmentId: blockId, mimeType: "image/png" } },
        }),
      ];
      for (const body of crafted) {
        const response = await owner.put(
          `/api/v1/pages/${pageId}/drawings/${blockId}/scene`,
          Buffer.from(body),
          octet,
        );
        expect(response.statusCode, body).toBe(400);
        expect(response.json().type).toContain("invalidScene");
      }
      const image = await owner.put(
        `/api/v1/pages/${pageId}/drawings/${blockId}/preview`,
        Buffer.from("<html/>"),
        octet,
      );
      expect(image.statusCode).toBe(400);
      const denied = await reader.client.put(
        `/api/v1/pages/${pageId}/drawings/${blockId}/scene`,
        Buffer.from(JSON.stringify({ elements: [] })),
        octet,
      );
      expect(denied.statusCode).toBe(403);
      const attachments = await owner.get(`/api/v1/pages/${pageId}/attachments`);
      expect(attachments.json()).toEqual([]);
    });
  });
});
