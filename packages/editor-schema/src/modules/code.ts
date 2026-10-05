import { toHtml } from "hast-util-to-html";
import { common, createLowlight } from "lowlight";
import { z } from "zod";
import type { ValidNode } from "../json.js";
import { attrOf, defineModule, optional } from "../module.js";
import { element, escapeHtml, fenceFor } from "../text.js";
import { codeLanguages } from "../values.js";

const lowlight = createLowlight(common);

function codeText(node: ValidNode): string {
  return node.content.map((child) => child.text ?? "").join("");
}

export function highlightCode(code: string, language: string | null): string {
  if (!language || !lowlight.registered(language)) return escapeHtml(code);
  return toHtml(lowlight.highlight(language, code));
}

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
      markdown: (node) => {
        const code = codeText(node);
        const fence = fenceFor(code);
        return `${fence}${attrOf<string | null>(node, "language") ?? ""}\n${code}\n${fence}`;
      },
      text: codeText,
    },
  ],
});
