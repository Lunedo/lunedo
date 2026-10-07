import { z } from "zod";
import { attrOf, defineModule, required } from "../module.js";
import { element } from "../text.js";

export const MAX_PLACEHOLDER_LENGTH = 500;
export const TEMPLATE_FIELD_KEY = /^[a-z][a-zA-Z0-9]{0,39}$/;

const inlineAtom = { inline: true, group: "inline", atom: true } as const;

export const templatesModule = defineModule({
  name: "templates",
  nodes: [
    {
      name: "placeholder",
      spec: { ...inlineAtom, selectable: true },
      attrs: {
        text: required(
          z
            .string()
            .max(MAX_PLACEHOLDER_LENGTH)
            .refine((value) => value.trim().length > 0, "A placeholder needs an instruction"),
        ),
      },
      html: (node, renderer) =>
        renderer.context.showPlaceholders
          ? element("span", { class: "ph-placeholder" }, renderer.escape(attrOf<string>(node, "text")))
          : "",
      markdown: () => "",
      text: () => "",
    },
    {
      name: "templateField",
      spec: { ...inlineAtom, selectable: true },
      attrs: { field: required(z.string().regex(TEMPLATE_FIELD_KEY, "Expected a field key")) },
      html: (node, renderer) =>
        element(
          "span",
          { class: "ph-template-field", "data-field": attrOf<string>(node, "field") },
          renderer.escape(`{${attrOf<string>(node, "field")}}`),
        ),
      markdown: (node, renderer) => renderer.escape(`{${attrOf<string>(node, "field")}}`),
      text: () => "",
    },
  ],
});
