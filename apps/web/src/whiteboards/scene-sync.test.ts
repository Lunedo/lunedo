import { SCENE_ELEMENTS, SCENE_FILES } from "@pagehall/editor-schema/scene";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  type FileStore,
  type LocalFile,
  newerThan,
  reconcileByVersion,
  SceneSync,
  type SceneTarget,
  type SyncElement,
} from "./scene-sync.js";

function element(id: string, extra: Record<string, unknown> = {}): SyncElement {
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
    versionNonce: 5,
    index: "a0",
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    customData: undefined,
    ...extra,
  };
}

class FakeCanvas implements SceneTarget {
  scene: SyncElement[] = [];
  local: Record<string, LocalFile> = {};
  background: string | null = null;
  elements() {
    return this.scene;
  }
  replaceElements(elements: readonly SyncElement[]) {
    this.scene = [...elements];
  }
  files() {
    return this.local;
  }
  addFiles(files: LocalFile[]) {
    for (const file of files) this.local[file.id] = file;
  }
  backgroundColor() {
    return this.background;
  }
  setBackgroundColor(color: string | null) {
    this.background = color;
  }
}

const noFiles: FileStore = {
  upload: async () => "01929b1e-0000-7000-8000-000000000001",
  load: async () => "data:image/png;base64,AA==",
};

function connect(a: Y.Doc, b: Y.Doc): void {
  a.on("update", (update: Uint8Array) => Y.applyUpdate(b, update, "network"));
  b.on("update", (update: Uint8Array) => Y.applyUpdate(a, update, "network"));
}

function client(doc: Y.Doc, files: FileStore = noFiles, onRefused = vi.fn()) {
  const canvas = new FakeCanvas();
  const sync = new SceneSync({
    doc,
    target: canvas,
    reconcile: reconcileByVersion,
    files,
    editable: true,
    onRefused,
  });
  return { canvas, sync, onRefused };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("reconciling elements", () => {
  it("prefers the higher version and, on a tie, the lower version nonce", () => {
    expect(newerThan(element("a", { version: 3 }), element("a", { version: 2 }))).toBe(true);
    expect(
      newerThan(element("a", { version: 2, versionNonce: 1 }), element("a", { version: 2, versionNonce: 9 })),
    ).toBe(true);
    expect(
      newerThan(element("a", { version: 2, versionNonce: 9 }), element("a", { version: 2, versionNonce: 1 })),
    ).toBe(false);
  });
});

describe("SceneSync", () => {
  it("sends local changes, receives remote ones and converges for both people", () => {
    const first = new Y.Doc();
    const second = new Y.Doc();
    connect(first, second);
    const a = client(first);
    const b = client(second);
    a.canvas.scene = [element("shape")];
    a.sync.flush();
    expect(b.canvas.scene.map((entry) => entry.id)).toEqual(["shape"]);
    b.canvas.scene = [
      element("shape", { x: 50, version: 2, versionNonce: 3 }),
      element("note", { index: "a1" }),
    ];
    b.sync.flush();
    expect(a.canvas.scene).toEqual(
      b.canvas.scene.map((entry) => expect.objectContaining({ id: entry.id, version: entry.version })),
    );
    expect(first.getMap(SCENE_ELEMENTS).toJSON()).toEqual(second.getMap(SCENE_ELEMENTS).toJSON());
    expect(JSON.stringify(first.getMap(SCENE_ELEMENTS).toJSON())).not.toContain("customData");
  });

  it("keeps a local element that is newer than the remote one", () => {
    const doc = new Y.Doc();
    const { canvas, sync } = client(doc);
    canvas.scene = [element("shape", { version: 5, x: 99 })];
    doc.getMap(SCENE_ELEMENTS).set("shape", element("shape", { version: 4, x: 1 }));
    expect(canvas.scene[0]?.x).toBe(99);
    sync.flush();
    expect((doc.getMap(SCENE_ELEMENTS).get("shape") as SyncElement).x).toBe(99);
  });

  it("refuses elements the server would reject instead of sending them", () => {
    const doc = new Y.Doc();
    const { canvas, sync, onRefused } = client(doc);
    canvas.scene = [
      element("embed", { type: "embeddable", link: "https://example.com" }),
      element("script", { link: "javascript:alert(1)" }),
      element("fine", { link: "https://example.com", index: "a1" }),
    ];
    sync.flush();
    expect([...doc.getMap(SCENE_ELEMENTS).keys()]).toEqual(["fine"]);
    expect(onRefused).toHaveBeenCalledWith([
      expect.objectContaining({ element: expect.objectContaining({ id: "embed" }) }),
      expect.objectContaining({ element: expect.objectContaining({ id: "script" }) }),
    ]);
  });

  it("sends nothing while the board is read-only", () => {
    const doc = new Y.Doc();
    const canvas = new FakeCanvas();
    const sync = new SceneSync({
      doc,
      target: canvas,
      reconcile: reconcileByVersion,
      files: noFiles,
      editable: false,
    });
    canvas.scene = [element("shape")];
    sync.flush();
    expect(doc.getMap(SCENE_ELEMENTS).size).toBe(0);
  });

  it("coalesces changes made while drawing into one update", () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    const updates = vi.fn();
    doc.on("update", updates);
    const { canvas, sync } = client(doc);
    for (let version = 1; version <= 20; version += 1) {
      canvas.scene = [element("stroke", { version })];
      sync.changed();
    }
    expect(updates).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(updates).toHaveBeenCalledTimes(1);
  });

  it("uploads images once as attachments and loads images others added", async () => {
    const first = new Y.Doc();
    const second = new Y.Doc();
    connect(first, second);
    const store: FileStore = {
      upload: vi.fn(async () => "01929b1e-0000-7000-8000-000000000002"),
      load: vi.fn(async () => "data:image/png;base64,BBBB"),
    };
    const a = client(first, store);
    const b = client(second, store);
    a.canvas.local = {
      file1: { id: "file1", mimeType: "image/png", dataURL: "data:image/png;base64,AAAA", created: 1 },
    };
    a.canvas.scene = [
      element("image", { type: "image", fileId: "file1", status: "saved", scale: [1, 1], crop: null }),
    ];
    a.sync.flush();
    a.sync.flush();
    await vi.waitFor(() => expect(second.getMap(SCENE_FILES).get("file1")).toBeTruthy());
    expect(store.upload).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(b.canvas.local.file1?.dataURL).toBe("data:image/png;base64,BBBB"));
    expect(store.load).toHaveBeenCalledWith("01929b1e-0000-7000-8000-000000000002", "image/png");
  });
});
