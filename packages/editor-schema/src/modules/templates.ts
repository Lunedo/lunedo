import { z } from "zod";
import { type MacroConverter, macroSpaceKeys, macroText, singleLine } from "../importing.js";
import { attrOf, defineModule, optional, required } from "../module.js";
import { element } from "../text.js";
import { templateIdValue } from "../values.js";
import { wordText } from "../word.js";

export const MAX_PLACEHOLDER_LENGTH = 500;
export const TEMPLATE_FIELD_KEY = /^[a-z][a-zA-Z0-9]{0,39}$/;
export const MAX_TEMPLATE_BUTTON_LABEL = 100;
export const MAX_TEMPLATE_TITLE_PATTERN = 255;

const inlineAtom = { inline: true, group: "inline", atom: true } as const;

const BLUEPRINTS: Readonly<Record<string, string>> = {
  "kb-how-to-article-blueprint": "builtin:how-to",
  "meeting-notes-blueprint": "builtin:meeting-notes",
};

export function templateFieldKey(name: string): string | null {
  const words = name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) return null;
  const joined = words
    .map((word, index) =>
      index === 0
        ? word.charAt(0).toLowerCase() + word.slice(1)
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join("");
  const key = (/^[a-z]/.test(joined) ? joined : `field${joined}`).slice(0, 40);
  return TEMPLATE_FIELD_KEY.test(key) ? key : null;
}

export function templateTitlePattern(title: string): string | null {
  let valid = true;
  const pattern = singleLine(title).replace(/@([A-Za-z][A-Za-z0-9_]*)@?/g, (_match, name: string) => {
    const key = templateFieldKey(name);
    if (!key) valid = false;
    return `{${key}}`;
  });
  return valid && pattern.length <= MAX_TEMPLATE_TITLE_PATTERN ? pattern : null;
}

export function titlePatternFields(pattern: string): string[] {
  return [
    ...new Set([...pattern.matchAll(/\{([a-z][a-zA-Z0-9]{0,39})\}/g)].map((match) => match[1] as string)),
  ];
}

function buttonLabel(value: string | null): string {
  return singleLine(value).slice(0, MAX_TEMPLATE_BUTTON_LABEL);
}

const templateButtonImporter: MacroConverter = {
  source: "confluence",
  macros: ["create-from-template"],
  convert: (macro, context) => {
    const keys = macroSpaceKeys(macro, "spaceKey");
    if (keys.length > 1 || (keys[0] !== undefined && !context.space(keys[0]))) return null;
    const sourceId = macroText(macro, "templateId") ?? "";
    if (sourceId.length > 0) {
      const templateId = /^\d{1,19}$/.test(sourceId) ? context.template(sourceId) : null;
      const title = templateTitlePattern(macroText(macro, "title") ?? "");
      if (!templateId || title === null) return null;
      return [
        {
          type: "templateButton",
          attrs: { templateId, label: buttonLabel(macroText(macro, "buttonLabel")), title },
        },
      ];
    }
    const blueprint = (macroText(macro, "blueprintModuleCompleteKey") ?? "").split(":").at(-1) ?? "";
    const templateId = BLUEPRINTS[blueprint];
    if (!templateId) return null;
    return [
      {
        type: "templateButton",
        attrs: {
          templateId,
          label: buttonLabel(macroText(macro, "createButtonLabel") ?? macroText(macro, "buttonLabel")),
          title: "",
        },
      },
    ];
  },
};

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
      word: (node, renderer) =>
        renderer.context.showPlaceholders
          ? [wordText(attrOf<string>(node, "text"), { muted: true, italic: true })]
          : [],
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
      word: (node) => [wordText(`{${attrOf<string>(node, "field")}}`, { code: true })],
      markdown: (node, renderer) => renderer.escape(`{${attrOf<string>(node, "field")}}`),
      text: () => "",
    },
  ],
});

export const templateButtonModule = defineModule({
  name: "templateButton",
  nodes: [
    {
      name: "templateButton",
      spec: { group: "block", atom: true, selectable: true, draggable: true },
      attrs: {
        templateId: required(templateIdValue),
        label: optional(z.string().max(MAX_TEMPLATE_BUTTON_LABEL), ""),
        title: optional(z.string().max(MAX_TEMPLATE_TITLE_PATTERN), ""),
      },
      portable: (attrs, context) => {
        if (!context.strips("templateButton") || context.isBuiltInTemplate(String(attrs.templateId))) {
          return attrs;
        }
        context.removed("templateButton");
        return null;
      },
      html: (node, renderer) => {
        const label = attrOf<string>(node, "label").trim() || renderer.label("templateButton");
        return element(
          "div",
          {
            class: "ph-template-button",
            "data-template-id": attrOf<string>(node, "templateId"),
            "data-label": attrOf<string>(node, "label") || null,
            "data-title": attrOf<string>(node, "title") || null,
          },
          element("span", { class: "ph-template-button-label" }, renderer.escape(label)),
        );
      },
      word: (node, renderer) => [
        {
          type: "paragraph",
          content: [
            wordText(attrOf<string>(node, "label").trim() || renderer.label("templateButton"), {
              italic: true,
              muted: true,
            }),
          ],
        },
      ],
      markdown: (node, renderer) =>
        `*${renderer.escape(attrOf<string>(node, "label").trim() || renderer.label("templateButton"))}*`,
      text: () => "",
    },
  ],
  importers: [templateButtonImporter],
});
