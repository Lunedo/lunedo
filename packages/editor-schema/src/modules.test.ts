import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  attrOf,
  createDefaultRegistry,
  createEditorKit,
  defaultModules,
  defineModule,
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
});
