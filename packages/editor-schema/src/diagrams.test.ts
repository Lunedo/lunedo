import { describe, expect, it } from "vitest";
import type { FileReference, MacroImportContext, MacroNote, SourceElement } from "./importing.js";
import {
  type DocumentJson,
  modules,
  plainText,
  type ReferencedDiagram,
  renderHtml,
  renderMarkdown,
  renderWord,
  validateDocument,
} from "./index.js";

const BLOCK = "01929b1e-0000-7000-8000-000000000001";
const SOURCE = "01929b1e-0000-7000-8000-000000000002";
const PREVIEW = "01929b1e-0000-7000-8000-000000000003";
const PAGE = "01929b1e-0000-7000-8000-000000000004";
const DIAGRAM = "01929b1e-0000-7000-8000-000000000005";

function diagram(type: string, attrs: Record<string, unknown>): DocumentJson {
  return { type: "doc", content: [{ type, attrs: { id: BLOCK, ...attrs } }] };
}

const context = {
  attachment: (id: string, version?: number) => ({ href: `/files/${id}?version=${version ?? "current"}` }),
};

describe("diagram blocks", () => {
  it("show the stored image of exactly the version the page refers to", () => {
    for (const type of ["drawio", "mermaid", "plantuml"]) {
      const document = diagram(type, { previewId: PREVIEW, previewVersion: 4 });
      const html = renderHtml(document, context);
      expect(html).toContain(`data-diagram="${type}"`);
      expect(html).toContain(`src="/files/${PREVIEW}?version=4"`);
      expect(renderHtml(document, { ...context, target: "print" })).toContain(
        `src="/files/${PREVIEW}?version=4"`,
      );
      expect(renderMarkdown(document, context)).toContain(`(/files/${PREVIEW}?version=4)`);
      expect(renderWord(document, context)).toContainEqual(
        expect.objectContaining({ type: "image", attachmentId: PREVIEW }),
      );
    }
  });

  it("show the source of text diagrams that have no image yet", () => {
    const document = diagram("plantuml", { source: "@startuml\nAlice -> Bob: <b>Hi</b>\n@enduml" });
    const html = renderHtml(document, context);
    expect(html).toContain("PlantUML diagram has no image yet");
    expect(html).toContain("Alice -&gt; Bob: &lt;b&gt;Hi&lt;/b&gt;");
    expect(html).not.toContain("<img");
    expect(renderMarkdown(document, context)).toContain("```plantuml\n@startuml");
    expect(renderWord(document, context)).toContainEqual(expect.objectContaining({ type: "code" }));
  });

  it("keep the source next to the image on screen but not in print", () => {
    const document = diagram("mermaid", {
      source: "flowchart LR\n  A --> B",
      previewId: PREVIEW,
      previewVersion: 1,
    });
    expect(renderHtml(document, context)).toContain('<details class="ph-diagram-source">');
    expect(renderHtml(document, { ...context, target: "print" })).not.toContain("<details");
  });

  it("show a placeholder for draw.io diagrams without an image or without access to it", () => {
    expect(renderHtml(diagram("drawio", {}))).toContain('class="ph-diagram-empty"');
    expect(
      renderHtml(diagram("drawio", { previewId: PREVIEW, previewVersion: 1 }), { attachment: () => null }),
    ).not.toContain("<img");
    expect(renderMarkdown(diagram("drawio", {}))).toBe("*draw.io diagram*\n");
  });

  it("give the text inside the diagram to search, and the source when there is no text", () => {
    expect(plainText(diagram("drawio", { text: "Core switch" }))).toContain("Core switch");
    expect(plainText(diagram("mermaid", { source: "flowchart LR\n  A[Router]" }))).toContain("Router");
    expect(
      plainText(diagram("mermaid", { source: "flowchart LR\n  A[Router]", text: "Router" })),
    ).not.toContain("flowchart");
  });

  it("refuse half references, unknown formats and oversized sources", () => {
    expect(validateDocument(diagram("drawio", { sourceId: SOURCE })).ok).toBe(false);
    expect(validateDocument(diagram("drawio", { previewId: PREVIEW })).ok).toBe(false);
    expect(validateDocument(diagram("drawio", { sourceFormat: "visio" })).ok).toBe(false);
    expect(
      validateDocument(diagram("drawio", { sourceId: "https://example.com/x", sourceVersion: 1 })).ok,
    ).toBe(false);
    expect(validateDocument(diagram("mermaid", { source: "x".repeat(50_001) })).ok).toBe(false);
    expect(validateDocument(diagram("plantuml", { sourceId: SOURCE, sourceVersion: 1 })).ok).toBe(false);
    expect(validateDocument(diagram("drawio", { previewId: PREVIEW, previewVersion: 1 })).ok).toBe(true);
    expect(
      validateDocument(
        diagram("drawio", {
          sourceFormat: "gliffy",
          sourceId: SOURCE,
          sourceVersion: 1,
          previewId: PREVIEW,
          previewVersion: 1,
        }),
      ).ok,
    ).toBe(true);
  });
});

describe("draw.io diagrams of other pages", () => {
  const document = diagram("drawioReference", { pageId: PAGE, diagramId: DIAGRAM, name: "Shared" });
  const resolved = (found: Partial<ReferencedDiagram> | null) => ({
    ...context,
    diagramReference: (pageId: string, diagramId: string) =>
      pageId === PAGE && diagramId === DIAGRAM && found
        ? {
            title: "Network <core>",
            href: `/spaces/NET/pages/${PAGE}/network`,
            found: true,
            previewId: PREVIEW,
            previewVersion: 7,
            ...found,
          }
        : null,
  });

  it("show the current image of the diagram with a link to its page", () => {
    const html = renderHtml(document, resolved({}));
    expect(html).toContain(`src="/files/${PREVIEW}?version=7"`);
    expect(html).toContain(`From <a href="/spaces/NET/pages/${PAGE}/network">Network &lt;core&gt;</a>`);
    expect(renderMarkdown(document, resolved({}))).toContain(
      `![draw.io diagram](/files/${PREVIEW}?version=7)\n\n*From [Network \\<core\\>](/spaces/NET/pages/${PAGE}/network)*`,
    );
    expect(renderWord(document, resolved({}))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "image", attachmentId: PREVIEW }),
        expect.objectContaining({
          content: [
            expect.objectContaining({
              text: "From Network <core>",
              style: expect.objectContaining({ link: `/spaces/NET/pages/${PAGE}/network` }),
            }),
          ],
        }),
      ]),
    );
  });

  it("say when the diagram is no longer on its page", () => {
    const html = renderHtml(document, resolved({ found: false, previewId: null, previewVersion: null }));
    expect(html).toContain("The draw.io diagram was removed from its page.");
    expect(html).not.toContain("<img");
  });

  it("show nothing of a page the reader cannot see, and no title in placeholders", () => {
    expect(renderHtml(document, resolved(null))).toBe("");
    expect(renderMarkdown(document, resolved(null)).trim()).toBe("");
    expect(renderWord(document, resolved(null))).toEqual([]);
    const placeholder = renderHtml(document, { ...resolved(null), showPlaceholders: true });
    expect(placeholder).toContain("Restricted content");
    expect(placeholder).not.toContain("Network");
    expect(
      renderHtml(diagram("drawioReference", { name: "Shared" }), {
        ...resolved(null),
        showPlaceholders: true,
      }),
    ).toContain("The draw.io diagram Shared is on a page that was not imported.");
  });

  it("leave the image to the client when the page has no resolver, and stay out of search", () => {
    const html = renderHtml(document, context);
    expect(html).toContain(`data-page-id="${PAGE}"`);
    expect(html).toContain(`data-diagram-ref="${DIAGRAM}"`);
    expect(html).not.toContain("<img");
    expect(plainText(document).trim()).toBe("");
  });

  it("refuse a reference with only one of page and diagram", () => {
    expect(validateDocument(diagram("drawioReference", { pageId: PAGE })).ok).toBe(false);
    expect(validateDocument(diagram("drawioReference", { diagramId: DIAGRAM })).ok).toBe(false);
    expect(validateDocument(document).ok).toBe(true);
  });
});

function parameter(name: string, value: string): SourceElement {
  return { name: "ac:parameter", attributes: { "ac:name": name }, children: [value] };
}

function macro(name: string, children: SourceElement[]): SourceElement {
  return { name: "ac:structured-macro", attributes: { "ac:name": name }, children };
}

function plain(text: string): SourceElement {
  return { name: "ac:plain-text-body", attributes: {}, children: [text] };
}

function importContext(files: Record<string, number>, pages: Record<string, string> = {}) {
  const notes: MacroNote[] = [];
  const requested: FileReference[] = [];
  let next = 0;
  const context: MacroImportContext = {
    blocks: () => [],
    inline: () => [],
    attachment: () => null,
    file: (reference) => {
      requested.push(reference);
      const key = `own/${reference.fileName}`;
      const version = files[key];
      return version ? { attachmentId: `id:${key}`, name: reference.fileName, version } : null;
    },
    page: () => null,
    pageById: (sourceId) => pages[sourceId] ?? null,
    space: () => null,
    template: () => null,
    note: (note) => notes.push(note),
    newId: () => `01929b1e-0000-7000-8000-00000000010${(next++).toString(16)}`,
    diagramId: (name, pageSourceId) => `diagram:${pageSourceId ?? "own"}/${name}`,
  };
  return { context, notes, requested };
}

function convert(source: SourceElement, files: Record<string, number>, pages: Record<string, string> = {}) {
  const importer = modules.importer("confluence", source.attributes["ac:name"] ?? "");
  if (!importer) throw new Error("No converter");
  const { context, notes, requested } = importContext(files, pages);
  return {
    blocks: importer.convert(source, context),
    notes,
    requested,
    references: importer.references?.(source),
  };
}

describe("diagram macros from Confluence", () => {
  it("turn a draw.io macro into a block with the diagram file and its preview", () => {
    const { blocks, notes, references } = convert(macro("drawio", [parameter("diagramName", "Network")]), {
      "own/Network": 3,
      "own/Network.png": 3,
    });
    expect(blocks).toEqual([
      {
        type: "drawio",
        attrs: expect.objectContaining({
          id: "diagram:own/Network",
          sourceFormat: "drawio",
          sourceId: "id:own/Network",
          sourceVersion: 3,
          previewId: "id:own/Network.png",
          previewVersion: 3,
        }),
      },
    ]);
    expect(notes).toEqual([]);
    expect(references?.files).toContainEqual({ fileName: "Network.drawio" });
  });

  it("finds the diagram file with the .drawio extension of newer versions", () => {
    const { blocks } = convert(macro("drawio", [parameter("diagramName", "Plan")]), {
      "own/Plan.drawio": 1,
      "own/Plan.drawio.png": 1,
    });
    expect(blocks?.[0]?.attrs).toMatchObject({
      sourceId: "id:own/Plan.drawio",
      previewId: "id:own/Plan.drawio.png",
    });
  });

  it("keeps the preview and reports a draw.io diagram whose file is missing", () => {
    const { blocks, notes } = convert(macro("drawio", [parameter("diagramName", "Lost")]), {
      "own/Lost.png": 2,
    });
    expect(blocks?.[0]?.attrs).toMatchObject({
      sourceId: null,
      sourceVersion: null,
      previewId: "id:own/Lost.png",
    });
    expect(notes).toEqual([{ code: "diagramFileMissing", macro: "drawio", name: "Lost" }]);
  });

  it("turns an included diagram into a reference to the diagram block of its page", () => {
    const included = macro("inc-drawio", [parameter("diagramName", "Shared"), parameter("pageId", "98765")]);
    const { blocks, notes, references, requested } = convert(
      included,
      { "own/Shared": 1 },
      { "98765": PAGE },
    );
    expect(blocks).toEqual([
      {
        type: "drawioReference",
        attrs: { id: expect.any(String), pageId: PAGE, diagramId: "diagram:98765/Shared", name: "Shared" },
      },
    ]);
    expect(notes).toEqual([]);
    expect(requested).toEqual([]);
    expect(references).toEqual({ pageIds: ["98765"] });
  });

  it("reports an included diagram whose page was not imported", () => {
    const included = macro("inc-drawio", [parameter("diagramName", "Shared"), parameter("pageId", "98765")]);
    const { blocks, notes } = convert(included, {});
    expect(blocks?.[0]?.attrs).toMatchObject({ pageId: null, diagramId: null, name: "Shared" });
    expect(notes).toEqual([{ code: "diagramPageMissing", name: "Shared" }]);
    expect(validateDocument({ type: "doc", content: blocks ?? [] }).ok).toBe(true);
  });

  it("keeps a Gliffy diagram with its preview for conversion on first edit", () => {
    const { blocks, notes } = convert(macro("gliffy", [parameter("name", "Floor plan")]), {
      "own/Floor plan": 2,
      "own/Floor plan.png": 2,
    });
    expect(blocks?.[0]?.attrs).toMatchObject({
      sourceFormat: "gliffy",
      sourceId: "id:own/Floor plan",
      previewId: "id:own/Floor plan.png",
    });
    expect(notes).toEqual([{ code: "gliffyDiagram", name: "Floor plan" }]);
  });

  it("leaves macros without a diagram name to the placeholder", () => {
    expect(convert(macro("drawio", []), {}).blocks).toBeNull();
    expect(convert(macro("gliffy", [parameter("name", "x".repeat(256))]), {}).blocks).toBeNull();
  });

  it("turn Mermaid and PlantUML macros into blocks with their source", () => {
    const mermaid = convert(macro("mermaid", [plain("graph TD\r\n  A-->B\r\n")]), {});
    expect(mermaid.blocks).toEqual([
      { type: "mermaid", attrs: { id: expect.any(String), source: "graph TD\n  A-->B" } },
    ]);
    const plantuml = convert(macro("plantuml", [plain("@startuml\nA -> B\n@enduml")]), {});
    expect(plantuml.blocks?.[0]).toMatchObject({
      type: "plantuml",
      attrs: { source: "@startuml\nA -> B\n@enduml" },
    });
    for (const blocks of [mermaid.blocks, plantuml.blocks]) {
      expect(validateDocument({ type: "doc", content: blocks ?? [] }).ok).toBe(true);
    }
  });

  it("leave text diagram macros whose source is not recognizable to the placeholder", () => {
    expect(
      convert(macro("mermaid-cloud", [parameter("data", "eJzLSM3JyQcABiwCFQ==")]), {}).blocks,
    ).toBeNull();
    expect(convert(macro("plantuml", [plain("x".repeat(50_001))]), {}).blocks).toBeNull();
  });
});
