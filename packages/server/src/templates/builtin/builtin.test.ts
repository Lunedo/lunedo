import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type NodeJson, validateDocument } from "@pagehall/editor-schema";
import { describe, expect, it } from "vitest";
import { templateFieldsSchema } from "../fields.js";
import { templateCategories } from "../schema.js";
import { builtInTemplates } from "./index.js";
import { templateLanguages } from "./types.js";

const expectedOrder = [
  "meeting-notes",
  "decision",
  "how-to",
  "troubleshooting",
  "project-plan",
  "retrospective",
  "requirements",
  "incident-postmortem",
  "onboarding-checklist",
  "team-home",
  "team-meeting",
  "one-on-one",
];

const supportFiles = new Set(["index.ts", "nodes.ts", "types.ts", "builtin.test.ts"]);

function allNodes(node: NodeJson): NodeJson[] {
  return [node, ...(node.content ?? []).flatMap(allNodes)];
}

function collect(node: NodeJson, type: string): NodeJson[] {
  return allNodes(node).filter((candidate) => candidate.type === type);
}

function titleKeys(title: string): string[] {
  return [...title.matchAll(/\{([^}]*)\}/g)].map((match) => match[1] ?? "");
}

const cases = builtInTemplates.flatMap((template) =>
  templateLanguages.map((language) => ({ key: template.key, language, text: template.text[language] })),
);

describe("built-in templates", () => {
  it("are listed in the documented order with unique keys", () => {
    expect(builtInTemplates.map((template) => template.key)).toEqual(expectedOrder);
    expect(new Set(builtInTemplates.map((template) => template.key)).size).toBe(builtInTemplates.length);
  });

  it("have one module per template named after its key", () => {
    const directory = fileURLToPath(new URL(".", import.meta.url));
    const modules = readdirSync(directory)
      .filter((file) => file.endsWith(".ts") && !supportFiles.has(file))
      .map((file) => file.slice(0, -".ts".length))
      .sort();
    expect(modules).toEqual([...expectedOrder].sort());
  });

  it("use known categories", () => {
    for (const template of builtInTemplates) {
      expect(templateCategories).toContain(template.category);
    }
  });

  it("define the same field keys and types in every language", () => {
    for (const template of builtInTemplates) {
      const shapes = templateLanguages.map((language) =>
        template.text[language].fields.map((field) => ({
          key: field.key,
          type: field.type,
          required: field.required,
          options: field.options?.length ?? 0,
        })),
      );
      for (const shape of shapes) expect(shape, template.key).toEqual(shapes[0]);
    }
  });

  it("differ between languages in their visible texts", () => {
    for (const template of builtInTemplates) {
      expect(template.text.de.name, template.key).not.toBe(template.text.en.name);
    }
  });

  describe.each(cases)("$key ($language)", ({ text }) => {
    const fieldKeys = new Set(text.fields.map((field) => field.key));

    it("has a document that validates against the editor schema", () => {
      const result = validateDocument(text.document);
      expect(result.ok ? [] : result.problems).toEqual([]);
    });

    it("has fields that parse", () => {
      expect(templateFieldsSchema.safeParse(text.fields).success).toBe(true);
      expect(text.fields.length).toBeLessThanOrEqual(4);
    });

    it("has a short name and a one-sentence description", () => {
      expect(text.name.trim()).not.toBe("");
      expect(text.description.length).toBeLessThanOrEqual(90);
      expect(text.description).toMatch(/^[^.]+\.$/);
    });

    it("refers only to defined fields in the document", () => {
      for (const node of collect(text.document, "templateField")) {
        expect(fieldKeys).toContain(node.attrs?.field);
      }
    });

    it("refers only to defined text and date fields in the title", () => {
      for (const key of titleKeys(text.title)) {
        const field = text.fields.find((candidate) => candidate.key === key);
        expect(field, key).toBeDefined();
        expect(["text", "date"]).toContain(field?.type);
      }
    });

    it("uses every field in the document", () => {
      const used = new Set(collect(text.document, "templateField").map((node) => node.attrs?.field));
      for (const key of fieldKeys) expect(used, key).toContain(key);
    });

    it("puts every placeholder alone into its block", () => {
      for (const node of allNodes(text.document)) {
        if (node.content?.some((child) => child.type === "placeholder")) {
          expect(node.type).toBe("paragraph");
          expect(node.content).toHaveLength(1);
        }
      }
    });
  });
});
