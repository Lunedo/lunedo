import { describe, expect, it } from "vitest";
import {
  type DocumentJson,
  migrateDocument,
  plainText,
  renderHtml,
  renderMarkdown,
  validateDocument,
} from "./index.js";
import { migrations } from "./migrations.js";

const BLOCK = "01929b1e-0000-7000-8000-000000000001";
const SCENE = "01929b1e-0000-7000-8000-000000000002";
const PREVIEW = "01929b1e-0000-7000-8000-000000000003";

function drawing(attrs: Record<string, unknown>): DocumentJson {
  return { type: "doc", content: [{ type: "drawing", attrs: { id: BLOCK, ...attrs } }] };
}

const saved = drawing({
  sceneId: SCENE,
  sceneVersion: 3,
  previewId: PREVIEW,
  previewVersion: 3,
  text: "Serverraum EG",
});

describe("drawing blocks", () => {
  it("render the stored preview of exactly the version the page refers to", () => {
    const context = {
      attachment: (id: string, version?: number) => ({
        href: `/files/${id}?version=${version ?? "current"}`,
      }),
    };
    const html = renderHtml(saved, context);
    expect(html).toContain(`data-drawing-id="${BLOCK}"`);
    expect(html).toContain(`src="/files/${PREVIEW}?version=3"`);
    expect(html).toContain('alt="Drawing"');
    expect(renderMarkdown(saved, context)).toBe(`![Drawing](/files/${PREVIEW}?version=3)\n`);
  });

  it("show a placeholder without a preview or without access to it", () => {
    expect(renderHtml(drawing({}))).toContain('class="ph-drawing-empty"');
    expect(renderHtml(saved, { attachment: () => null })).not.toContain("<img");
    expect(renderMarkdown(drawing({}))).toBe("*Drawing*\n");
  });

  it("give their text to search", () => {
    expect(plainText(saved)).toContain("Serverraum EG");
  });

  it("refuse half references and invalid values", () => {
    expect(validateDocument(drawing({ sceneId: SCENE })).ok).toBe(false);
    expect(validateDocument(drawing({ previewId: PREVIEW, previewVersion: 1 })).ok).toBe(false);
    expect(validateDocument(drawing({ sceneId: SCENE, sceneVersion: 0 })).ok).toBe(false);
    expect(validateDocument(drawing({ sceneId: "https://example.com/x", sceneVersion: 1 })).ok).toBe(false);
    expect(validateDocument(drawing({ text: "x".repeat(20_001) })).ok).toBe(false);
    expect(validateDocument({ type: "doc", content: [{ type: "drawing", attrs: {} }] }).ok).toBe(false);
    expect(validateDocument(saved).ok).toBe(true);
  });
});

describe("migration from schema version 6", () => {
  it("keeps version 6 documents unchanged, as drawings are new", () => {
    const stored: DocumentJson = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }],
    };
    expect(migrateDocument(stored, 6, migrations, 7)).toEqual(stored);
  });
});
