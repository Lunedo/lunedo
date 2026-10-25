import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { type DocumentJson, migrateDocument, schema as reference, validateDocument } from "@lunedo/editor-schema";
import { Editor, getSchema } from "@tiptap/core";
import type { MarkType, NodeType, Schema } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";
import { schemaExtensions } from "./extensions.js";

function attributes(type: NodeType | MarkType) {
  return Object.fromEntries(
    Object.entries(type.spec.attrs ?? {}).map(([name, spec]) => [
      name,
      Object.hasOwn(spec, "default") ? { default: spec.default } : { required: true },
    ]),
  );
}

function describeNodes(schema: Schema) {
  const marks = Object.values(schema.marks);
  return Object.fromEntries(
    Object.values(schema.nodes).map((type) => [
      type.name,
      {
        content: type.spec.content ?? "",
        group: type.spec.group ?? "",
        inline: type.isInline,
        atom: type.isAtom,
        leaf: type.isLeaf,
        defining: type.spec.defining === true,
        isolating: type.spec.isolating === true,
        code: type.spec.code === true,
        selectable: type.spec.selectable !== false,
        draggable: type.spec.draggable === true,
        tableRole: type.spec.tableRole ?? null,
        marks: marks
          .filter((mark) => type.allowsMarkType(schema.marks[mark.name] as MarkType))
          .map((mark) => mark.name),
        attributes: attributes(type),
      },
    ]),
  );
}

function describeMarks(schema: Schema) {
  const marks = Object.values(schema.marks);
  return Object.fromEntries(
    marks.map((type) => [
      type.name,
      {
        inclusive: type.spec.inclusive !== false,
        spanning: type.spec.spanning !== false,
        code: type.spec.code === true,
        excludes: marks.filter((other) => type.excludes(other)).map((other) => other.name),
        attributes: attributes(type),
      },
    ]),
  );
}

const fixtureRoot = path.resolve("../../packages/editor-schema/src/fixtures");

function fixtures(): { name: string; document: unknown }[] {
  return readdirSync(fixtureRoot).flatMap((version) =>
    readdirSync(path.join(fixtureRoot, version))
      .filter((file) => file.endsWith(".json"))
      .map((file) => ({
        name: `${version}/${file}`,
        document: migrateDocument(
          JSON.parse(readFileSync(path.join(fixtureRoot, version, file), "utf8")) as DocumentJson,
          Number(version.slice(1)),
        ) as unknown,
      })),
  );
}

describe("editor schema in the client", () => {
  const schema = getSchema(schemaExtensions());

  it("has exactly the nodes and marks of the shared schema", () => {
    expect(Object.keys(schema.nodes).sort()).toEqual(Object.keys(reference.nodes).sort());
    expect(Object.keys(schema.marks).sort()).toEqual(Object.keys(reference.marks).sort());
  });

  it("matches every node of the shared schema", () => {
    expect(describeNodes(schema)).toEqual(describeNodes(reference));
  });

  it("matches every mark of the shared schema", () => {
    expect(describeMarks(schema)).toEqual(describeMarks(reference));
  });

  it("keeps every stored fixture valid after a round trip through the editor", () => {
    const list = fixtures();
    expect(list.length).toBeGreaterThan(0);
    for (const { name, document } of list) {
      const editor = new Editor({ extensions: schemaExtensions(), content: document as object });
      const result = validateDocument(editor.getJSON());
      expect(result.ok ? [] : result.problems, name).toEqual([]);
      const original = validateDocument(document);
      expect(result.ok && original.ok && result.document, name).toEqual(original.ok && original.document);
      editor.destroy();
    }
  });
});
