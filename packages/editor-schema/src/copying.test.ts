import { describe, expect, it } from "vitest";
import {
  type CopyMapping,
  copyPageDocument,
  type DocumentJson,
  documentAttachments,
  validateDocument,
} from "./index.js";

const id = (n: number) => `01929b1e-0000-7000-8000-${String(n).padStart(12, "0")}`;

const SOURCE_PAGE = id(1);
const OUTSIDE_PAGE = id(2);
const COPIED_PAGE = id(3);
const TARGET_SPACE = id(4);
const SOURCE_SPACE = id(5);
const IMAGE = id(10);
const FILE = id(11);
const SCENE = id(12);
const SCENE_PREVIEW = id(13);
const DRAWIO = id(14);
const DRAWIO_PREVIEW = id(15);
const MERMAID_PREVIEW = id(16);
const THUMBNAIL = id(17);
const FOREIGN = id(18);
const BLOCK = id(20);
const THREAD = id(21);
const WHITEBOARD = id(22);

const text = (value: string, marks?: DocumentJson["marks"]) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});

const source: DocumentJson = {
  type: "doc",
  content: [
    { type: "image", attrs: { attachmentId: IMAGE } },
    { type: "file", attrs: { attachmentId: FILE, name: "plan.pdf" } },
    { type: "file", attrs: { attachmentId: FOREIGN, name: "elsewhere.pdf" } },
    {
      type: "drawing",
      attrs: { id: BLOCK, sceneId: SCENE, sceneVersion: 3, previewId: SCENE_PREVIEW, previewVersion: 3 },
    },
    {
      type: "drawio",
      attrs: { id: id(23), sourceId: DRAWIO, sourceVersion: 2, previewId: DRAWIO_PREVIEW, previewVersion: 2 },
    },
    {
      type: "mermaid",
      attrs: { id: id(24), source: "graph TD; A-->B", previewId: MERMAID_PREVIEW, previewVersion: 1 },
    },
    { type: "embed", attrs: { url: "https://example.org/video", thumbnailId: THUMBNAIL } },
    {
      type: "paragraph",
      content: [
        { type: "pageLink", attrs: { pageId: SOURCE_PAGE, spaceId: SOURCE_SPACE, title: null } },
        { type: "pageLink", attrs: { pageId: OUTSIDE_PAGE, spaceId: SOURCE_SPACE, title: null } },
        text("inside", [{ type: "link", attrs: { href: `/spaces/HR/pages/${SOURCE_PAGE}/intro` } }]),
        text("outside", [{ type: "link", attrs: { href: `/spaces/HR/pages/${OUTSIDE_PAGE}/other` } }]),
        text("commented", [{ type: "inlineComment", attrs: { threadId: THREAD } }, { type: "bold" }]),
      ],
    },
    { type: "childPages", attrs: { pageId: SOURCE_PAGE } },
    { type: "includePage", attrs: { pageId: SOURCE_PAGE } },
    { type: "drawioReference", attrs: { id: id(25), pageId: SOURCE_PAGE, diagramId: id(23) } },
    { type: "whiteboard", attrs: { whiteboardId: WHITEBOARD } },
  ],
};

function mapping(): CopyMapping {
  return {
    attachment: (reference) =>
      reference.id === FOREIGN
        ? reference
        : {
            id: reference.id.replace("8000-0000", "9000-0000"),
            version: reference.version === null ? null : 1,
          },
    page: (pageId) => (pageId === SOURCE_PAGE ? { id: COPIED_PAGE, spaceId: TARGET_SPACE } : null),
    href: (href) => href.replace(`/spaces/HR/pages/${SOURCE_PAGE}`, `/spaces/OPS/pages/${COPIED_PAGE}`),
  };
}

const copied = (n: number) => id(n).replace("8000-0000", "9000-0000");

function nodeOf(document: DocumentJson, type: string, index = 0) {
  return (document.content ?? []).filter((node) => node.type === type)[index];
}

describe("copying documents", () => {
  it("starts from a valid document", () => {
    expect(validateDocument(source).ok).toBe(true);
  });

  it("finds every attachment the document references, with versions where blocks pin one", () => {
    expect(documentAttachments(source)).toEqual(
      expect.arrayContaining([
        { id: IMAGE, version: null },
        { id: FILE, version: null },
        { id: FOREIGN, version: null },
        { id: SCENE, version: 3 },
        { id: SCENE_PREVIEW, version: 3 },
        { id: DRAWIO, version: 2 },
        { id: DRAWIO_PREVIEW, version: 2 },
        { id: MERMAID_PREVIEW, version: 1 },
        { id: THUMBNAIL, version: null },
      ]),
    );
    expect(documentAttachments(source)).toHaveLength(9);
  });

  it("points images, files, drawings, diagrams and embed thumbnails to the copied attachments", () => {
    const result = copyPageDocument(source, mapping());
    expect(nodeOf(result, "image")?.attrs).toMatchObject({ attachmentId: copied(10) });
    expect(nodeOf(result, "file")?.attrs).toMatchObject({ attachmentId: copied(11), name: "plan.pdf" });
    expect(nodeOf(result, "file", 1)?.attrs).toMatchObject({ attachmentId: FOREIGN });
    expect(nodeOf(result, "drawing")?.attrs).toMatchObject({
      id: BLOCK,
      sceneId: copied(12),
      sceneVersion: 1,
      previewId: copied(13),
      previewVersion: 1,
    });
    expect(nodeOf(result, "drawio")?.attrs).toMatchObject({
      sourceId: copied(14),
      sourceVersion: 1,
      previewId: copied(15),
      previewVersion: 1,
    });
    expect(nodeOf(result, "mermaid")?.attrs).toMatchObject({ previewId: copied(16), previewVersion: 1 });
    expect(nodeOf(result, "embed")?.attrs).toMatchObject({ thumbnailId: copied(17) });
    expect(validateDocument(result).ok).toBe(true);
  });

  it("rewrites links to copied pages and keeps links to other pages", () => {
    const result = copyPageDocument(source, mapping());
    const inline = nodeOf(result, "paragraph")?.content ?? [];
    expect(inline[0]?.attrs).toEqual({ pageId: COPIED_PAGE, spaceId: TARGET_SPACE, title: null });
    expect(inline[1]?.attrs).toEqual({ pageId: OUTSIDE_PAGE, spaceId: SOURCE_SPACE, title: null });
    expect(inline[2]?.marks).toEqual([
      { type: "link", attrs: { href: `/spaces/OPS/pages/${COPIED_PAGE}/intro` } },
    ]);
    expect(inline[3]?.marks).toEqual([
      { type: "link", attrs: { href: `/spaces/HR/pages/${OUTSIDE_PAGE}/other` } },
    ]);
    expect(nodeOf(result, "childPages")?.attrs).toMatchObject({ pageId: COPIED_PAGE });
  });

  it("drops inline comment marks and keeps other marks", () => {
    const result = copyPageDocument(source, mapping());
    expect((nodeOf(result, "paragraph")?.content ?? [])[4]?.marks).toEqual([{ type: "bold" }]);
  });

  it("keeps includes, live diagram references and whiteboard blocks on their original targets", () => {
    const result = copyPageDocument(source, mapping());
    expect(nodeOf(result, "includePage")?.attrs).toEqual({ pageId: SOURCE_PAGE });
    expect(nodeOf(result, "drawioReference")?.attrs).toMatchObject({
      pageId: SOURCE_PAGE,
      diagramId: id(23),
    });
    expect(nodeOf(result, "whiteboard")?.attrs).toEqual({ whiteboardId: WHITEBOARD });
  });

  it("rewrites the pages of roadmap bars that were copied", () => {
    const roadmap = {
      type: "doc",
      content: [
        {
          type: "roadmap",
          attrs: {
            roadmap: {
              lanes: [
                {
                  title: "Lane",
                  color: "blue",
                  bars: [
                    { title: "A", start: "2026-01-01", end: "2026-02-01", row: 0, pageId: SOURCE_PAGE },
                    { title: "B", start: "2026-01-01", end: "2026-02-01", row: 1, pageId: OUTSIDE_PAGE },
                  ],
                },
              ],
              markers: [],
              timeline: { start: "2026-01-01", end: "2026-12-31", display: "months" },
            },
          },
        },
      ],
    } as DocumentJson;
    const result = copyPageDocument(roadmap, mapping());
    const copiedRoadmap = nodeOf(result, "roadmap")?.attrs?.roadmap as
      | { lanes: { bars: { pageId: string }[] }[] }
      | undefined;
    const bars = copiedRoadmap?.lanes[0]?.bars;
    expect(bars?.map((bar) => bar.pageId)).toEqual([COPIED_PAGE, OUTSIDE_PAGE]);
  });

  it("leaves nodes without a copy rule unchanged", () => {
    const unknown = { type: "doc", content: [{ type: "futureBlock", attrs: { pageId: SOURCE_PAGE } }] };
    expect(copyPageDocument(unknown as DocumentJson, mapping())).toEqual(unknown);
  });
});
