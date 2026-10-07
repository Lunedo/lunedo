import { describe, expect, it } from "vitest";
import {
  type DocumentJson,
  editorSchemaVersion,
  MigrationError,
  migrateDocument,
  migrations,
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
