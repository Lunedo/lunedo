import { firstSourceElement, type MacroConverter, sourceElements } from "../importing.js";
import { attrOf, defineModule, optional, required } from "../module.js";
import { element, prefixLines } from "../text.js";
import { uuidValue } from "../values.js";
import { wordText } from "../word.js";

export const topicUpdateModule = defineModule({
  name: "topicUpdate",
  nodes: [
    {
      name: "topicUpdate",
      spec: { content: "block+", group: "block", defining: true, isolating: true },
      attrs: { topicId: required(uuidValue) },
      html: (node, renderer) => {
        const topicId = attrOf<string>(node, "topicId");
        const title = renderer.topicTitle(topicId);
        return element(
          "section",
          { class: "ph-topic-update", "data-topic-id": topicId },
          `${element("p", { class: "ph-topic-update-title" }, renderer.escape(title))}${element("div", { class: "ph-topic-update-content" }, renderer.children(node))}`,
        );
      },
      word: (node, renderer) => [
        {
          type: "box",
          variant: "neutral",
          title: [wordText(renderer.topicTitle(attrOf<string>(node, "topicId")), { bold: true })],
          content: renderer.blocks(node),
        },
      ],
      markdown: (node, renderer) =>
        `**${renderer.escape(renderer.topicTitle(attrOf<string>(node, "topicId")))}**\n\n${renderer.blocks(node)}`,
    },
  ],
});

const decisionImporter: MacroConverter = {
  source: "confluence",
  macros: ["adf:decision-list"],
  convert: (macro, context) => {
    const list = macro.name === "ac:adf-node" ? macro : firstSourceElement(macro, "ac:adf-node");
    if (list?.attributes.type !== "decision-list") return null;
    const items = sourceElements(list, "ac:adf-node").filter(
      (item) => item.attributes.type === "decision-item",
    );
    if (items.length === 0) return null;
    return items.map((item) => {
      const statement = firstSourceElement(item, "ac:adf-content");
      const content = statement ? context.inline(statement.children) : [];
      return {
        type: "decision",
        content: [{ type: "paragraph", ...(content.length > 0 ? { content } : {}) }],
      };
    });
  },
};

export const decisionModule = defineModule({
  name: "decision",
  nodes: [
    {
      name: "decision",
      spec: { content: "paragraph+", group: "block", defining: true, isolating: true },
      attrs: {
        id: optional(uuidValue.nullable(), null),
        topicId: optional(uuidValue.nullable(), null),
      },
      html: (node, renderer) =>
        element(
          "aside",
          {
            class: "ph-decision",
            "data-decision-id": attrOf<string | null>(node, "id"),
            "data-topic-id": attrOf<string | null>(node, "topicId"),
            role: "note",
            "aria-label": renderer.label("decision"),
          },
          `${element("span", { class: "ph-decision-label" }, renderer.escape(renderer.label("decision")))}${element("div", { class: "ph-decision-content" }, renderer.children(node))}`,
        ),
      word: (node, renderer) => [
        {
          type: "box",
          variant: "decision",
          title: [wordText(renderer.label("decision"), { bold: true })],
          content: renderer.blocks(node),
        },
      ],
      markdown: (node, renderer) =>
        prefixLines(
          `**${renderer.escape(renderer.label("decision"))}**\n\n${renderer.blocks(node)}`,
          "> ",
          "> ",
        ),
    },
  ],
  importers: [decisionImporter],
});
