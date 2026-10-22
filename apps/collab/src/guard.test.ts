import { documentSize } from "@lunedo/editor-schema";
import { emptyScene, MAX_SCENE_BYTES, SCENE_ELEMENTS, yDocFromScene } from "@lunedo/editor-schema/scene";
import { documentFromYDoc, yDocFromDocument } from "@lunedo/editor-schema/yjs";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { DocumentGuard, sceneValidator } from "./guard.js";
import { appendParagraph } from "./harness.testing.js";

const owners = (known: Map<number, string> = new Map()) => ({
  owners: async (clients: number[]) =>
    new Map(
      clients.filter((client) => known.has(client)).map((client) => [client, known.get(client) as string]),
    ),
});

function largeDocument() {
  const content = Array.from({ length: 1000 }, (_, index) => ({
    type: "paragraph",
    content: [{ type: "text", text: `Paragraph ${index} ${"lorem ipsum dolor sit amet ".repeat(6)}` }],
  }));
  return { type: "doc", content };
}

function editOf(live: Y.Doc, change: (doc: Y.Doc) => void): Uint8Array {
  const replica = new Y.Doc();
  Y.applyUpdate(replica, Y.encodeStateAsUpdate(live));
  const before = Y.encodeStateVector(replica);
  change(replica);
  return Y.encodeStateAsUpdate(replica, before);
}

describe("DocumentGuard", () => {
  it("accepts valid updates and keeps following the live document", async () => {
    const live = yDocFromDocument({ type: "doc", content: [{ type: "paragraph" }] });
    const guard = new DocumentGuard(live, owners());
    const update = editOf(live, (doc) => appendParagraph(doc, "Valid"));
    expect(await guard.check(update, "account-a")).toMatchObject({ ok: true });
    Y.applyUpdate(live, update);
    const next = editOf(live, (doc) => appendParagraph(doc, "Next"));
    expect(await guard.check(next, "account-a")).toMatchObject({ ok: true });
  });

  it("rejects invalid content and recovers for the next update", async () => {
    const live = yDocFromDocument({ type: "doc", content: [{ type: "paragraph" }] });
    const guard = new DocumentGuard(live, owners());
    const invalid = editOf(live, (doc) => doc.getXmlFragment("default").push([new Y.XmlElement("iframe")]));
    expect(await guard.check(invalid, "account-a")).toEqual({
      ok: false,
      reason: "invalidDocument",
      problems: ["unknownNode"],
    });
    const valid = editOf(live, (doc) => appendParagraph(doc, "Fine"));
    expect(await guard.check(valid, "account-a")).toMatchObject({ ok: true });
  });

  it("rejects malformed updates and clients that belong to another account", async () => {
    const live = yDocFromDocument({ type: "doc", content: [{ type: "paragraph" }] });
    const writer = new Y.Doc();
    Y.applyUpdate(writer, Y.encodeStateAsUpdate(live));
    const guard = new DocumentGuard(live, owners(new Map([[writer.clientID, "account-b"]])));
    expect(await guard.check(new Uint8Array([255, 1, 2]), "account-a")).toMatchObject({
      reason: "malformed",
    });
    const before = Y.encodeStateVector(writer);
    appendParagraph(writer, "Mine");
    const update = Y.encodeStateAsUpdate(writer, before);
    expect(await guard.check(update, "account-a")).toMatchObject({ reason: "foreignClient" });
    expect(await guard.check(update, "account-b")).toMatchObject({ ok: true });
  });

  it("lets only one of two accounts claim a new client at the same moment", async () => {
    const live = yDocFromDocument({ type: "doc", content: [{ type: "paragraph" }] });
    const slowOwners = {
      owners: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new Map<number, string>();
      },
    };
    const guard = new DocumentGuard(live, slowOwners);
    const writer = new Y.Doc();
    Y.applyUpdate(writer, Y.encodeStateAsUpdate(live));
    const before = Y.encodeStateVector(writer);
    appendParagraph(writer, "Claimed");
    const update = Y.encodeStateAsUpdate(writer, before);
    const verdicts = await Promise.all([guard.check(update, "account-a"), guard.check(update, "account-b")]);
    expect(verdicts.map((verdict) => verdict.ok)).toEqual([true, false]);
    expect(verdicts[1]).toMatchObject({ reason: "foreignClient" });
  });

  it("validates a typing update on a page of about 200 KB quickly", async () => {
    const document = largeDocument();
    expect(documentSize(document)).toBeGreaterThan(190_000);
    const live = yDocFromDocument(document);
    const guard = new DocumentGuard(live, owners());
    const timings: number[] = [];
    for (let round = 0; round < 20; round++) {
      const update = editOf(live, (doc) => {
        const paragraph = doc.getXmlFragment("default").get(round) as Y.XmlElement;
        (paragraph.get(0) as Y.XmlText).insert(0, "a");
      });
      const started = performance.now();
      expect((await guard.check(update, "account-a")).ok).toBe(true);
      timings.push(performance.now() - started);
      Y.applyUpdate(live, update);
    }
    timings.sort((left, right) => left - right);
    expect(timings[Math.floor(timings.length / 2)]).toBeLessThan(150);
    expect(JSON.stringify(documentFromYDoc(live))).toContain("aParagraph 19");
  });
});

function shape(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    type: "rectangle",
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 1,
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
    updated: 1,
    link: null,
    locked: false,
    ...extra,
  };
}

function padded(id: string): Record<string, unknown> {
  return shape(id, { groupIds: Array.from({ length: 100 }, (_, index) => `${"g".repeat(120)}${index}`) });
}

describe("DocumentGuard for whiteboards", () => {
  it("checks only the elements an update changes and keeps the scene size up to date", async () => {
    const live = yDocFromScene(emptyScene());
    const guard = new DocumentGuard(live, owners(), sceneValidator);
    const element = editOf(live, (doc) => doc.getMap(SCENE_ELEMENTS).set("a", shape("a")));
    expect(await guard.check(element, "account-a")).toMatchObject({ ok: true });
    Y.applyUpdate(live, element);
    const moved = editOf(live, (doc) =>
      doc.getMap(SCENE_ELEMENTS).set("a", shape("a", { x: 5, version: 2 })),
    );
    expect(await guard.check(moved, "account-a")).toMatchObject({ ok: true });
    const invalid = editOf(live, (doc) =>
      doc.getMap(SCENE_ELEMENTS).set("b", shape("b", { type: "iframe" })),
    );
    expect(await guard.check(invalid, "account-a")).toEqual({
      ok: false,
      reason: "invalidDocument",
      problems: ["unknownElementType"],
    });
  });

  it("counts elements that arrive without a check, such as restored versions, towards the limit", async () => {
    const live = yDocFromScene(emptyScene());
    const guard = new DocumentGuard(live, owners(), sceneValidator);
    const size = JSON.stringify(padded("x")).length;
    const count = Math.floor(MAX_SCENE_BYTES / size);
    live.transact(() => {
      for (let index = 0; index < count; index += 1)
        live.getMap(SCENE_ELEMENTS).set(`e${index}`, padded(`e${index}`));
    });
    const more = editOf(live, (doc) => {
      for (let index = 0; index < 20; index += 1)
        doc.getMap(SCENE_ELEMENTS).set(`n${index}`, padded(`n${index}`));
    });
    expect(await guard.check(more, "account-a")).toEqual({
      ok: false,
      reason: "invalidDocument",
      problems: ["tooLarge"],
    });
    const removal = editOf(live, (doc) => {
      for (let index = 0; index < 40; index += 1) doc.getMap(SCENE_ELEMENTS).delete(`e${index}`);
    });
    expect(await guard.check(removal, "account-a")).toMatchObject({ ok: true });
    Y.applyUpdate(live, removal);
    expect(await guard.check(more, "account-a")).toMatchObject({ ok: true });
  });
});
