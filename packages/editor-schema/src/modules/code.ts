import { toHtml } from "hast-util-to-html";
import powershell from "highlight.js/lib/languages/powershell";
import { common, createLowlight } from "lowlight";
import { z } from "zod";
import { type MacroConverter, macroText, plainBody, richBody, titleParagraph } from "../importing.js";
import type { NodeJson, ValidNode } from "../json.js";
import { attrOf, defineModule, optional } from "../module.js";
import { element, escapeHtml, fenceFor } from "../text.js";
import { codeLanguages } from "../values.js";

const lowlight = createLowlight({ ...common, powershell });

function codeText(node: ValidNode): string {
  return node.content.map((child) => child.text ?? "").join("");
}

export function highlightCode(code: string, language: string | null): string {
  if (!language || !lowlight.registered(language)) return escapeHtml(code);
  return toHtml(lowlight.highlight(language, code));
}

const CONFLUENCE_LANGUAGES: Readonly<Record<string, string>> = {
  text: "plaintext",
  none: "plaintext",
  plain: "plaintext",
  "c#": "csharp",
  "c++": "cpp",
  js: "javascript",
  ts: "typescript",
  py: "python",
  rb: "ruby",
  vb: "vbnet",
  yml: "yaml",
  html: "xml",
  xhtml: "xml",
  sh: "bash",
  ps: "powershell",
  ps1: "powershell",
};

export function confluenceLanguage(value: string | null): string | null {
  const language = (value ?? "").trim().toLowerCase();
  const resolved = CONFLUENCE_LANGUAGES[language] ?? language;
  return codeLanguages.includes(resolved) ? resolved : null;
}

const codeImporter: MacroConverter = {
  source: "confluence",
  macros: ["code"],
  convert: (macro) => {
    if (richBody(macro)) return null;
    const text = (plainBody(macro) ?? "").replace(/\r\n?/g, "\n");
    const block: NodeJson = {
      type: "codeBlock",
      attrs: { language: confluenceLanguage(macroText(macro, "language")) },
      ...(text.length > 0 ? { content: [{ type: "text", text }] } : {}),
    };
    return [...titleParagraph(macroText(macro, "title")), block];
  },
};

export const codeBlockModule = defineModule({
  name: "codeBlock",
  nodes: [
    {
      name: "codeBlock",
      spec: { content: "text*", marks: "", group: "block", code: true, defining: true },
      attrs: {
        language: optional(
          z
            .string()
            .refine((value) => codeLanguages.includes(value), "Unknown code language")
            .nullable(),
          null,
        ),
      },
      html: (node) => {
        const language = attrOf<string | null>(node, "language");
        const code = element(
          "code",
          { class: language ? `hljs language-${language}` : "hljs" },
          highlightCode(codeText(node), language),
        );
        return element("pre", { class: "ph-code-block", "data-language": language }, code);
      },
      word: (node) => [
        { type: "code", text: codeText(node), language: attrOf<string | null>(node, "language") },
      ],
      markdown: (node) => {
        const code = codeText(node);
        const fence = fenceFor(code);
        return `${fence}${attrOf<string | null>(node, "language") ?? ""}\n${code}\n${fence}`;
      },
      text: codeText,
    },
  ],
  importers: [codeImporter],
});
