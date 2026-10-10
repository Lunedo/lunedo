import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  attrOf,
  codeLanguages,
  createDefaultRegistry,
  createEditorKit,
  defaultModules,
  defineModule,
  type MacroConverter,
  ModuleRegistry,
  modules,
  optional,
  required,
} from "./index.js";

const pollModule = defineModule({
  name: "poll",
  nodes: [
    {
      name: "poll",
      spec: { group: "block", atom: true },
      attrs: { question: required(z.string().min(1)), votes: optional(z.number().int().min(0), 0) },
      html: (node, renderer) =>
        `<div class="poll">${renderer.escape(attrOf<string>(node, "question"))} (${attrOf<number>(node, "votes")})</div>`,
      markdown: (node, renderer) =>
        `${renderer.escape(attrOf<string>(node, "question"))} (${attrOf<number>(node, "votes")})`,
    },
  ],
  marks: [
    {
      name: "spoiler",
      spec: {},
      html: (_mark, content) => `<span class="spoiler">${content}</span>`,
      markdown: (_mark, content) => `||${content}||`,
    },
  ],
});

describe("module registry", () => {
  it("registers every default module once", () => {
    expect(modules.modules.map((module) => module.name)).toEqual(defaultModules.map((module) => module.name));
  });

  it("refuses duplicate modules, nodes and marks", () => {
    const registry = createDefaultRegistry();
    expect(() => registry.register(pollModule, pollModule)).toThrow(/registered twice/);
    expect(() =>
      new ModuleRegistry().register(
        defineModule({ name: "a", nodes: pollModule.nodes }),
        defineModule({ name: "b", nodes: pollModule.nodes }),
      ),
    ).toThrow(/Node poll/);
    expect(() =>
      new ModuleRegistry().register(
        defineModule({ name: "a", marks: pollModule.marks }),
        defineModule({ name: "b", marks: pollModule.marks }),
      ),
    ).toThrow(/Mark spoiler/);
  });

  it("validates and renders a new module without changes to the core", () => {
    const kit = createEditorKit(createDefaultRegistry().register(pollModule));
    const document = {
      type: "doc",
      content: [
        { type: "poll", attrs: { question: "Lunch <today>?" } },
        { type: "paragraph", content: [{ type: "text", text: "secret", marks: [{ type: "spoiler" }] }] },
      ],
    };
    const result = kit.validate(document);
    expect(result.ok && result.document.content?.[0]).toEqual({
      type: "poll",
      attrs: { question: "Lunch <today>?", votes: 0 },
    });
    expect(kit.renderHtml(document)).toBe(
      '<div class="poll">Lunch &lt;today&gt;? (0)</div><p><span class="spoiler">secret</span></p>',
    );
    expect(kit.renderMarkdown(document)).toBe("Lunch \\<today\\>? (0)\n\n||secret||\n");
    expect(kit.validate({ type: "doc", content: [{ type: "poll", attrs: { question: "" } }] }).ok).toBe(
      false,
    );
    expect(modules.node("poll")).toBeUndefined();
  });

  it("finds the import converter of a macro in the module that owns it", () => {
    expect(modules.importer("confluence", "info")?.macros).toContain("note");
    expect(
      modules.modules.find((module) =>
        module.importers.includes(modules.importer("confluence", "code") as never),
      )?.name,
    ).toBe("codeBlock");
    expect(
      modules.modules.find((module) =>
        module.importers.includes(modules.importer("confluence", "adf:decision-list") as never),
      )?.name,
    ).toBe("decision");
    expect(modules.importer("confluence", "jira")).toBeUndefined();
    const importer: MacroConverter = { source: "confluence", macros: ["poll"], convert: () => [] };
    const registry = createDefaultRegistry().register(defineModule({ name: "poll", importers: [importer] }));
    expect(registry.importer("confluence", "poll")).toBe(importer);
  });

  it("refuses two converters for the same macro", () => {
    const importer: MacroConverter = { source: "confluence", macros: ["info"], convert: () => [] };
    expect(() =>
      createDefaultRegistry().register(defineModule({ name: "panel", importers: [importer] })),
    ).toThrow(/Macro info has two converters/);
    const twice: MacroConverter = { source: "confluence", macros: ["poll", "poll"], convert: () => [] };
    expect(() => new ModuleRegistry().register(defineModule({ name: "poll", importers: [twice] }))).toThrow(
      /Macro poll has two converters/,
    );
  });
});

describe("code languages", () => {
  it("include PowerShell and plain text and highlight PowerShell", () => {
    expect(codeLanguages).toContain("powershell");
    expect(codeLanguages).toContain("plaintext");
    expect(
      createEditorKit(createDefaultRegistry()).renderHtml({
        type: "doc",
        content: [
          {
            type: "codeBlock",
            attrs: { language: "powershell" },
            content: [{ type: "text", text: "Get-Service" }],
          },
        ],
      }),
    ).toContain('<span class="hljs-built_in">Get-Service</span>');
  });
});
