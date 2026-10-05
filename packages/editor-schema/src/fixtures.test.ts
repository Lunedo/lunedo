import { describe, expect, it } from "vitest";
import { fixtureVersions, loadFixtures } from "./fixtures.testing.js";
import { editorSchemaVersion, migrateDocument, modules, type NodeJson, validateDocument } from "./index.js";

function collect(node: NodeJson, found: { nodes: Set<string>; marks: Set<string>; attrs: Set<string> }) {
  found.nodes.add(node.type);
  for (const name of Object.keys(node.attrs ?? {})) found.attrs.add(`${node.type}.${name}`);
  for (const mark of node.marks ?? []) {
    found.marks.add(mark.type);
    for (const name of Object.keys(mark.attrs ?? {})) found.attrs.add(`${mark.type}.${name}`);
  }
  for (const child of node.content ?? []) collect(child, found);
}

describe("stored documents of every schema version", () => {
  it("has fixtures for every version up to the current one", () => {
    const versions = fixtureVersions();
    expect(versions[0]).toBe(1);
    expect(versions.at(-1)).toBe(editorSchemaVersion);
  });

  for (const version of fixtureVersions()) {
    for (const { name, document } of loadFixtures(version)) {
      it(`migrates and validates v${version}/${name}`, () => {
        const migrated = migrateDocument(document, version);
        const result = validateDocument(migrated);
        expect(result.ok ? [] : result.problems).toEqual([]);
      });
    }
  }

  it("cover every node, mark and attribute of the current schema", () => {
    const found = { nodes: new Set<string>(), marks: new Set<string>(), attrs: new Set<string>() };
    for (const { document } of loadFixtures(editorSchemaVersion)) collect(document, found);
    const missing: string[] = [];
    for (const node of modules.nodes()) {
      if (!found.nodes.has(node.name)) missing.push(node.name);
      for (const attr of Object.keys(node.attrs ?? {})) {
        if (!found.attrs.has(`${node.name}.${attr}`)) missing.push(`${node.name}.${attr}`);
      }
    }
    for (const mark of modules.marks()) {
      if (!found.marks.has(mark.name)) missing.push(mark.name);
      for (const attr of Object.keys(mark.attrs ?? {})) {
        if (!found.attrs.has(`${mark.name}.${attr}`)) missing.push(`${mark.name}.${attr}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
