import { describe, expect, it } from "vitest";
import {
  type DocumentJson,
  editorSchemaVersion,
  MigrationError,
  migrateDocument,
  migrations,
  validateDocument,
} from "./index.js";

const document: DocumentJson = { type: "doc", content: [{ type: "paragraph" }] };

describe("migrateDocument", () => {
  it("has a migration for every version below the current one", () => {
    for (let version = 1; version < editorSchemaVersion; version += 1) {
      expect(migrations[version], `migration from ${version}`).toBeTypeOf("function");
    }
  });

  it("returns documents of the current version unchanged", () => {
    expect(migrateDocument(document, editorSchemaVersion)).toBe(document);
  });

  it("applies the migrations of every later version in order", () => {
    const applied: number[] = [];
    const step = (version: number) => (doc: DocumentJson) => {
      applied.push(version);
      return { ...doc, content: [...(doc.content ?? []), { type: "paragraph", attrs: { indent: version } }] };
    };
    const migrated = migrateDocument(document, 1, { 1: step(1), 2: step(2) }, 3);
    expect(applied).toEqual([1, 2]);
    expect(migrated.content).toHaveLength(3);
  });

  it("refuses versions it cannot migrate", () => {
    expect(() => migrateDocument(document, editorSchemaVersion + 1)).toThrow(MigrationError);
    expect(() => migrateDocument(document, 0)).toThrow(MigrationError);
    expect(() => migrateDocument(document, 1.5)).toThrow(MigrationError);
    expect(() => migrateDocument(document, 1, {}, 2)).toThrow(MigrationError);
  });
});

describe("migration from schema version 12", () => {
  it("turns image widths in pixels into percent of the content width", () => {
    const stored: DocumentJson = {
      type: "doc",
      content: [
        { type: "image", attrs: { attachmentId: null, alt: "", width: 380, align: "center" } },
        { type: "image", attrs: { attachmentId: null, alt: "", width: 2000, align: "left" } },
        { type: "image", attrs: { attachmentId: null, alt: "", width: 3, align: "left" } },
        { type: "image", attrs: { attachmentId: null, alt: "", width: null, align: "left" } },
      ],
    };
    const migrated = migrateDocument(stored, 12, migrations, 13);
    expect(migrated.content?.map((node) => node.attrs?.width)).toEqual([50, 100, 1, null]);
    expect(validateDocument(migrated).ok).toBe(true);
  });
});

describe("migration from schema version 5", () => {
  it("keeps version 5 documents unchanged, as task reports without page or label filters show every page", () => {
    const stored: DocumentJson = {
      type: "doc",
      content: [{ type: "taskReport", attrs: { spaceId: null, status: "done" } }],
    };
    const migrated = migrateDocument(stored, 5, migrations, 6);
    expect(migrated).toEqual(stored);
    const result = validateDocument(migrated);
    expect(result.ok && result.document.content?.[0]?.attrs).toMatchObject({ pageIds: [], labels: [] });
  });
});

describe("migration from schema version 4", () => {
  it("keeps version 4 documents unchanged, as tables of contents start at level 1 by default", () => {
    const stored: DocumentJson = {
      type: "doc",
      content: [
        { type: "tableOfContents", attrs: { maxLevel: 2 } },
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
      ],
    };
    const migrated = migrateDocument(stored, 4, migrations, 5);
    expect(migrated).toEqual(stored);
    const result = validateDocument(migrated);
    expect(result.ok && result.document.content?.[0]?.attrs).toEqual({ minLevel: 1, maxLevel: 2 });
  });
});

describe("migration from schema version 1", () => {
  it("keeps version 1 documents unchanged, as placeholders and template fields only add nodes", () => {
    const stored: DocumentJson = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Project {name}" }] }],
    };
    expect(migrateDocument(stored, 1, migrations, 2)).toEqual(stored);
  });
});
