import { describe, expect, it } from "vitest";
import {
  type DocumentJson,
  modules,
  type PortableContext,
  portableTemplateDocument,
  rewriteFileReferences,
  validateDocument,
} from "./index.js";

const id = (n: number) => `01929b1e-0000-7000-8000-${String(n).padStart(12, "0")}`;
const local = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const PAGE = id(1);
const SPACE = id(2);
const PERSON = id(3);
const IMAGE = id(10);
const MISSING_IMAGE = id(11);
const FILE = id(12);
const SCENE = id(13);
const SCENE_PREVIEW = id(14);
const THUMBNAIL = id(15);
const TEMPLATE = id(16);
const TOPIC = id(17);

const text = (value: string, marks?: DocumentJson["marks"]) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});

const source = {
  type: "doc",
  content: [
    { type: "image", attrs: { attachmentId: IMAGE, alt: "Team" } },
    { type: "image", attrs: { attachmentId: MISSING_IMAGE } },
    { type: "file", attrs: { attachmentId: FILE, name: "plan.pdf" } },
    {
      type: "drawing",
      attrs: { id: id(20), sceneId: SCENE, sceneVersion: 3, previewId: SCENE_PREVIEW, previewVersion: 3 },
    },
    { type: "embed", attrs: { url: "https://example.org/video", thumbnailId: THUMBNAIL } },
    {
      type: "paragraph",
      content: [
        { type: "pageLink", attrs: { pageId: PAGE, spaceId: SPACE, title: null } },
        { type: "mention", attrs: { id: PERSON } },
        text("inside", [{ type: "link", attrs: { href: `/spaces/HR/pages/${PAGE}` } }]),
        text("outside", [{ type: "link", attrs: { href: "https://example.org/guide" } }]),
        text("commented", [{ type: "inlineComment", attrs: { threadId: id(21) } }, { type: "bold" }]),
      ],
    },
    {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { id: id(22), assignee: PERSON, dueDate: "2026-11-01" },
          content: [{ type: "paragraph", content: [text("Prepare")] }],
        },
      ],
    },
    { type: "childPages", attrs: { pageId: PAGE } },
    { type: "includePage", attrs: { pageId: PAGE } },
    { type: "drawioReference", attrs: { id: id(23), pageId: PAGE, diagramId: id(24), name: "Network" } },
    { type: "whiteboard", attrs: { whiteboardId: id(25) } },
    { type: "templateButton", attrs: { templateId: TEMPLATE, label: "New" } },
    { type: "templateButton", attrs: { templateId: "builtin:meeting-notes", label: "Notes" } },
    { type: "taskReport", attrs: { spaceId: SPACE, pageIds: [PAGE], assignee: PERSON } },
    { type: "pageReport", attrs: { spaceId: SPACE, labels: ["howto"] } },
    { type: "decisionReport", attrs: { spaceId: SPACE, parentId: PAGE } },
    { type: "propertiesReport", attrs: { spaceIds: [SPACE] } },
    { type: "contentByLabel", attrs: { spaceIds: [SPACE], labels: ["howto"] } },
    {
      type: "topicUpdate",
      attrs: { topicId: TOPIC },
      content: [{ type: "paragraph", content: [text("Kept text")] }],
    },
    {
      type: "decision",
      attrs: { id: id(26), topicId: TOPIC },
      content: [{ type: "paragraph", content: [text("Decided")] }],
    },
  ],
} as DocumentJson;

function problemsOf(document: DocumentJson) {
  const result = validateDocument(document);
  return result.ok ? [] : result.problems;
}

function context(): Omit<PortableContext, "removed" | "strips" | "renewsIds"> {
  let next = 0;
  const files = new Map([
    [IMAGE, local(100)],
    [SCENE, local(101)],
    [SCENE_PREVIEW, local(102)],
    [THUMBNAIL, local(103)],
  ]);
  return {
    file: (reference) => {
      const mapped = files.get(reference.id);
      return mapped ? { id: mapped, version: reference.version === null ? null : 1 } : null;
    },
    isInternalHref: (href) => href.startsWith("/"),
    isBuiltInTemplate: (templateId) => templateId === "builtin:meeting-notes",
    localId: () => local(++next),
  };
}

function nodes(document: DocumentJson, type: string) {
  const found: NonNullable<DocumentJson["content"]> = [];
  const walk = (node: DocumentJson | NonNullable<DocumentJson["content"]>[number]) => {
    if (node.type === type) found.push(node);
    for (const child of node.content ?? []) walk(child);
  };
  walk(document);
  return found;
}

describe("portable template documents", () => {
  it("starts from a valid document", () => {
    expect(problemsOf(source)).toEqual([]);
  });

  it("keeps the template's own files and empties images whose file is not part of it", () => {
    const { document } = portableTemplateDocument(source, context());
    expect(nodes(document, "image").map((node) => node.attrs?.attachmentId)).toEqual([local(100), null]);
    expect(nodes(document, "image")[0]?.attrs?.alt).toBe("Team");
    expect(nodes(document, "file")).toEqual([]);
    expect(nodes(document, "drawing")[0]?.attrs).toMatchObject({
      sceneId: local(101),
      sceneVersion: 1,
      previewId: local(102),
      previewVersion: 1,
    });
    expect(nodes(document, "embed")[0]?.attrs).toMatchObject({
      url: "https://example.org/video",
      thumbnailId: local(103),
    });
  });

  it("removes every reference to pages, spaces, people, comments and other objects of the instance", () => {
    const { document } = portableTemplateDocument(source, context());
    const serialized = JSON.stringify(document);
    for (const value of [PAGE, SPACE, PERSON, TEMPLATE, TOPIC, id(20), id(21), id(22), id(25), id(26)]) {
      expect(serialized).not.toContain(value);
    }
    expect(serialized).not.toContain("Network");
    expect(nodes(document, "pageLink")).toEqual([]);
    expect(nodes(document, "mention")).toEqual([]);
    expect(nodes(document, "topicUpdate")).toEqual([]);
    expect(serialized).toContain("Kept text");
    expect(serialized).toContain("https://example.org/guide");
    expect(nodes(document, "templateButton").map((node) => node.attrs?.templateId)).toEqual([
      "builtin:meeting-notes",
    ]);
    expect(nodes(document, "taskItem")[0]?.attrs).toEqual({
      id: null,
      assignee: null,
      dueDate: "2026-11-01",
    });
    const paragraph = nodes(document, "paragraph").find((node) =>
      (node.content ?? []).some((child) => child.text === "commented"),
    );
    expect(paragraph?.content?.map((child) => child.marks ?? [])).toEqual([
      [],
      [{ type: "link", attrs: { href: "https://example.org/guide" } }],
      [{ type: "bold" }],
    ]);
  });

  it("tells for each file which role it plays", () => {
    const roles: string[] = [];
    const files = context();
    portableTemplateDocument(source, {
      ...files,
      file: (reference, role) => {
        roles.push(`${reference.id}:${role}`);
        return files.file(reference, role);
      },
    });
    expect(roles).toEqual([
      `${IMAGE}:image`,
      `${MISSING_IMAGE}:image`,
      `${FILE}:file`,
      `${SCENE}:drawingScene`,
      `${SCENE_PREVIEW}:drawingPreview`,
      `${THUMBNAIL}:image`,
    ]);
  });

  it("counts what it removed by kind", () => {
    const { removed } = portableTemplateDocument(source, context());
    expect(removed).toEqual({
      file: 2,
      pageLink: 2,
      mention: 1,
      comment: 1,
      person: 1,
      report: 6,
      include: 1,
      diagramReference: 1,
      whiteboard: 1,
      templateButton: 1,
      meetingTopic: 2,
    });
  });

  it("gives blocks that need an ID a fresh one and produces a valid document", () => {
    const { document } = portableTemplateDocument(source, context());
    expect(nodes(document, "drawing")[0]?.attrs?.id).toBe(local(1));
    expect(problemsOf(document)).toEqual([]);
  });

  it("empties a drawing whose scene is not part of the template", () => {
    const only = {
      type: "doc",
      content: [
        {
          type: "drawing",
          attrs: {
            id: id(20),
            sceneId: id(30),
            sceneVersion: 1,
            previewId: SCENE_PREVIEW,
            previewVersion: 1,
          },
        },
      ],
    } as DocumentJson;
    const { document } = portableTemplateDocument(only, context());
    expect(document.content?.[0]?.attrs).toMatchObject({
      sceneId: null,
      sceneVersion: null,
      previewId: null,
      previewVersion: null,
    });
    expect(validateDocument(document).ok).toBe(true);
  });

  it("rewrites only file references when a template keeps its place in the instance", () => {
    const files = context();
    const { document, missing } = rewriteFileReferences(source, files.file);
    expect(missing).toBe(2);
    expect(nodes(document, "image").map((node) => node.attrs?.attachmentId)).toEqual([local(100), null]);
    expect(nodes(document, "file")).toEqual([]);
    expect(nodes(document, "drawing")[0]?.attrs).toMatchObject({ id: id(20), sceneId: local(101) });
    expect(nodes(document, "mention")).toHaveLength(1);
    expect(nodes(document, "pageLink")).toHaveLength(1);
    expect(nodes(document, "taskItem")[0]?.attrs).toEqual({
      id: id(22),
      assignee: PERSON,
      dueDate: "2026-11-01",
    });
    expect(nodes(document, "includePage")[0]?.attrs).toEqual({ pageId: PAGE });
    expect(nodes(document, "templateButton")).toHaveLength(2);
    expect(problemsOf(document)).toEqual([]);
  });

  it("has a portable rule for every node and mark attribute that can hold an ID", () => {
    const sample = id(99);
    const accepts = (schema: { safeParse(value: unknown): { success: boolean } }, value: string) =>
      schema.safeParse(value).success || schema.safeParse([value]).success;
    const holdsId = (schema: { safeParse(value: unknown): { success: boolean } }) =>
      accepts(schema, sample) && !accepts(schema, "label");
    const missing = [
      ...modules.nodes().map((node) => ({ name: node.name, attrs: node.attrs, portable: node.portable })),
      ...modules.marks().map((mark) => ({ name: mark.name, attrs: mark.attrs, portable: mark.portable })),
    ]
      .filter((definition) => !definition.portable)
      .filter((definition) => Object.values(definition.attrs ?? {}).some((spec) => holdsId(spec.schema)))
      .map((definition) => definition.name);
    expect(missing).toEqual([]);
  });
});
