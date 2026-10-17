import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  applyScene,
  boundText,
  copyScene,
  emptyScene,
  hasOnlySceneTypes,
  isAllowedElementLink,
  isStickyNote,
  MAX_ELEMENTS,
  MAX_SCENE_BYTES,
  pruneDeletedElements,
  SCENE_ELEMENTS,
  type Scene,
  sceneFromYDoc,
  sceneText,
  validateScene,
  visibleScene,
  yDocFromScene,
} from "./scene.js";

function base(id: string, type: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    type,
    x: 10,
    y: 20,
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
    seed: 1234,
    version: 3,
    versionNonce: 99,
    index: "a0",
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: 1_700_000_000_000,
    link: null,
    locked: false,
    ...extra,
  };
}

function textElement(id: string, text: string, extra: Record<string, unknown> = {}) {
  return base(id, "text", {
    fontSize: 20,
    fontFamily: 5,
    text,
    originalText: text,
    textAlign: "left",
    verticalAlign: "top",
    containerId: null,
    autoResize: true,
    lineHeight: 1.25,
    ...extra,
  });
}

function arrow(id: string) {
  return base(id, "arrow", {
    points: [
      [0, 0],
      [100, 40],
    ],
    lastCommittedPoint: null,
    startBinding: { elementId: "box", focus: 0, gap: 4 },
    endBinding: null,
    startArrowhead: null,
    endArrowhead: "arrow",
    elbowed: false,
  });
}

function scene(elements: unknown[], files: Record<string, unknown> = {}) {
  return { elements, files, settings: { viewBackgroundColor: "#ffffff" } };
}

function valid(value: unknown): Scene {
  const result = validateScene(value);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.scene;
}

function problems(value: unknown): string[] {
  const result = validateScene(value);
  return result.ok ? [] : result.problems.map((problem) => problem.code);
}

describe("validateScene", () => {
  it("accepts every supported element type and orders elements by their index", () => {
    const result = valid(
      scene([
        textElement("t1", "Uplink", { index: "a5" }),
        base("box", "rectangle", { index: "a1", customData: { stickyNote: true } }),
        base("d", "diamond", { index: "a2" }),
        base("e", "ellipse", { index: "a3" }),
        { ...arrow("arr"), index: "a4" },
        base("l", "line", {
          index: "a6",
          points: [
            [0, 0],
            [5, 5],
          ],
          lastCommittedPoint: null,
          startBinding: null,
          endBinding: null,
          startArrowhead: null,
          endArrowhead: null,
        }),
        base("f", "freedraw", {
          index: "a7",
          points: [
            [0, 0],
            [1, 2],
          ],
          pressures: [0.5, 0.6],
          simulatePressure: false,
          lastCommittedPoint: null,
        }),
        base("img", "image", { index: "a8", fileId: "file1", status: "saved", scale: [1, 1], crop: null }),
        base("fr", "frame", { index: "a9", name: "Phase 1" }),
      ]),
    );
    expect(result.elements.map((element) => element.id)).toEqual([
      "box",
      "d",
      "e",
      "arr",
      "t1",
      "l",
      "f",
      "img",
      "fr",
    ]);
    expect(result.settings.viewBackgroundColor).toBe("#ffffff");
  });

  it("refuses element types that embed web content or are not stored", () => {
    for (const type of ["embeddable", "iframe", "magicframe", "selection", "script"]) {
      expect(problems(scene([base("x", type)]))).toContain("unknownElementType");
    }
    expect(problems(scene([base("x", "__proto__")]))).toContain("unknownElementType");
    expect(problems(scene([base("x", "toString")]))).toContain("unknownElementType");
  });

  it("refuses unknown fields, wrong types and custom data", () => {
    expect(problems(scene([base("x", "rectangle", { onclick: "alert(1)" })]))).toContain("unknownField");
    expect(problems(scene([base("x", "rectangle", { x: "10" })]))).toContain("invalidElement");
    expect(problems(scene([base("x", "rectangle", { x: Number.POSITIVE_INFINITY })]))).toContain(
      "invalidElement",
    );
    expect(problems(scene([base("x", "rectangle", { customData: { html: "<b>" } })]))).toContain(
      "unknownField",
    );
    expect(
      problems(scene([base("x", "rectangle", { strokeColor: "url(https://evil.example/x)" })])),
    ).toContain("invalidElement");
    expect(problems(scene([base("../x", "rectangle")]))).toContain("invalidElement");
    expect(problems({ elements: [], files: {}, settings: {}, extra: 1 })).toContain("unknownField");
    expect(problems([])).toEqual(["notAnObject"]);
    expect(problems(scene(["text"]))).toContain("notAnObject");
  });

  it("allows links to the web and to Pagehall only", () => {
    expect(valid(scene([base("a", "rectangle", { link: "https://example.com/a" })])).elements).toHaveLength(
      1,
    );
    expect(valid(scene([base("a", "rectangle", { link: "/spaces/IT/pages/1" })])).elements).toHaveLength(1);
    for (const link of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "//evil.example/x",
      "mailto:a@example.com",
      "file:///etc/passwd",
      " https://example.com",
      "https://example.com/\u0000",
      "/\\evil.example",
    ]) {
      expect(problems(scene([base("a", "rectangle", { link })]))).toContain("invalidLink");
    }
    expect(isAllowedElementLink("http://intranet.local/")).toBe(true);
  });

  it("allows images only from attachments of the board", () => {
    const attachment = "0b3f2a52-6fd6-4fbb-9a0e-3c3d2b0f6a11";
    expect(
      valid(scene([], { file1: { attachmentId: attachment, mimeType: "image/png" } })).files.file1
        ?.attachmentId,
    ).toBe(attachment);
    expect(
      problems(scene([], { file1: { dataURL: "https://evil.example/a.png", mimeType: "image/png" } })),
    ).toContain("invalidFile");
    expect(
      problems(
        scene([], {
          file1: { attachmentId: attachment, mimeType: "image/png", dataURL: "data:image/png;base64,AA" },
        }),
      ),
    ).toContain("invalidFile");
    expect(problems(scene([], { file1: { attachmentId: attachment, mimeType: "text/html" } }))).toContain(
      "invalidFile",
    );
    expect(problems(scene([], { file1: { attachmentId: "not-a-uuid", mimeType: "image/png" } }))).toContain(
      "invalidFile",
    );
  });

  it("enforces the limits of the scene and of each element", () => {
    const many = Array.from({ length: MAX_ELEMENTS + 1 }, (_, index) => base(`e${index}`, "rectangle"));
    expect(problems(scene(many))).toEqual(["tooManyElements"]);
    const huge = textElement("t", "x".repeat(20_001));
    expect(problems(scene([huge]))).toContain("invalidElement");
    const points = Array.from({ length: 20_001 }, (_, index) => [index, index]);
    expect(
      problems(
        scene([
          base("f", "freedraw", { points, pressures: [], simulatePressure: true, lastCommittedPoint: null }),
        ]),
      ),
    ).toContain("invalidElement");
    const big = {
      elements: [],
      files: {},
      settings: { viewBackgroundColor: null },
      padding: "x".repeat(MAX_SCENE_BYTES),
    };
    expect(problems(big)).toEqual(["tooLarge"]);
    expect(problems(scene([base("same", "rectangle"), base("same", "ellipse")]))).toContain(
      "duplicateElement",
    );
  });

  it("refuses values that cannot be serialized", () => {
    const cyclic: Record<string, unknown> = { elements: [] };
    cyclic.self = cyclic;
    expect(problems(cyclic)).toEqual(["notSerializable"]);
  });
});

describe("scene text", () => {
  it("collects the text of text elements, sticky notes and frames, but not of deleted elements", () => {
    const result = valid(
      scene([
        base("note", "rectangle", { customData: { stickyNote: true }, index: "a1" }),
        textElement("t1", "SFP+ vorhanden?", { containerId: "note", index: "a2" }),
        textElement("t2", "gone", { isDeleted: true, index: "a3" }),
        base("fr", "frame", { name: "Phase 1", index: "a4" }),
      ]),
    );
    expect(sceneText(result)).toBe("SFP+ vorhanden?\nPhase 1");
    const note = result.elements[0];
    if (!note) throw new Error("missing");
    expect(isStickyNote(note)).toBe(true);
    expect(boundText(result, note)).toBe("SFP+ vorhanden?");
    expect(visibleScene(result).elements.map((element) => element.id)).toEqual(["note", "t1", "fr"]);
  });
});

describe("scenes in Yjs", () => {
  it("round-trips a scene and converges when two documents edit different elements", () => {
    const start = valid(scene([base("a", "rectangle"), base("b", "ellipse", { index: "a1" })]));
    const first = yDocFromScene(start);
    const second = new Y.Doc();
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    first.getMap(SCENE_ELEMENTS).set("a", { ...base("a", "rectangle"), x: 500, version: 4 });
    second.getMap(SCENE_ELEMENTS).set("b", { ...base("b", "ellipse", { index: "a1" }), y: 700, version: 4 });
    Y.applyUpdate(first, Y.encodeStateAsUpdate(second));
    Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
    expect(sceneFromYDoc(first)).toEqual(sceneFromYDoc(second));
    const merged = valid(sceneFromYDoc(first));
    expect(merged.elements.find((element) => element.id === "a")?.x).toBe(500);
    expect(merged.elements.find((element) => element.id === "b")?.y).toBe(700);
  });

  it("restores an earlier scene with higher versions so every client takes it over", () => {
    const earlier = valid(scene([base("a", "rectangle")]));
    const doc = yDocFromScene(
      valid(scene([{ ...base("a", "rectangle"), x: 99, version: 10 }, base("b", "ellipse")])),
    );
    applyScene(doc, earlier);
    const result = valid(sceneFromYDoc(doc));
    const a = result.elements.find((element) => element.id === "a");
    const b = result.elements.find((element) => element.id === "b");
    expect(a?.x).toBe(10);
    expect(a?.version).toBe(11);
    expect(b?.isDeleted).toBe(true);
    expect(visibleScene(result).elements.map((element) => element.id)).toEqual(["a"]);
  });

  it("prunes deleted elements after a while and detects foreign shared types", () => {
    const doc = yDocFromScene(
      valid(
        scene([
          base("old", "rectangle", { isDeleted: true, updated: 1 }),
          base("new", "rectangle", { isDeleted: true }),
        ]),
      ),
    );
    expect(pruneDeletedElements(doc, 1000)).toBe(1);
    expect([...doc.getMap(SCENE_ELEMENTS).keys()]).toEqual(["new"]);
    expect(hasOnlySceneTypes(doc)).toBe(true);
    doc.getXmlFragment("default");
    expect(hasOnlySceneTypes(doc)).toBe(false);
    expect(validateScene(sceneFromYDoc(yDocFromScene(emptyScene())))).toEqual({
      ok: true,
      scene: emptyScene(),
    });
  });
});

describe("copyScene", () => {
  it("points image files to the copied attachments and rewrites element links", () => {
    const scene: Scene = {
      elements: [
        {
          ...base("a", "rectangle"),
          link: "/spaces/HR/pages/old/intro",
        } as unknown as Scene["elements"][number],
        base("b", "ellipse") as unknown as Scene["elements"][number],
      ],
      files: { image: { attachmentId: "01929b1e-0000-7000-8000-000000000001", mimeType: "image/png" } },
      settings: { viewBackgroundColor: null },
    };
    const copied = copyScene(scene, {
      attachment: () => "01929b1e-0000-7000-8000-000000000002",
      href: (href) => href.replace("old", "new"),
    });
    expect(copied.files.image?.attachmentId).toBe("01929b1e-0000-7000-8000-000000000002");
    expect(copied.elements[0]?.link).toBe("/spaces/HR/pages/new/intro");
    expect(copied.elements[1]).toEqual(scene.elements[1]);
    expect(scene.files.image?.attachmentId).toBe("01929b1e-0000-7000-8000-000000000001");
  });
});
