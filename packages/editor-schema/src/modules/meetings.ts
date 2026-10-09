import { attrOf, defineModule, optional, required } from "../module.js";
import { element, prefixLines } from "../text.js";
import { uuidValue } from "../values.js";

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
      markdown: (node, renderer) =>
        `**${renderer.escape(renderer.topicTitle(attrOf<string>(node, "topicId")))}**\n\n${renderer.blocks(node)}`,
    },
  ],
});

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
      markdown: (node, renderer) =>
        prefixLines(
          `**${renderer.escape(renderer.label("decision"))}**\n\n${renderer.blocks(node)}`,
          "> ",
          "> ",
        ),
    },
  ],
});
