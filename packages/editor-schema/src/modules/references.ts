import { z } from "zod";
import { copyPageAttribute } from "../copying.js";
import type { ValidNode } from "../json.js";
import { attrOf, defineModule, optional, type PageLinkTarget, required } from "../module.js";
import { removedNode } from "../portable.js";
import { element, markdownUrl } from "../text.js";
import { emojiValue, isoDateValue, uuidValue } from "../values.js";
import { wordText } from "../word.js";

const inlineAtom = { inline: true, group: "inline", atom: true } as const;

function linkTarget(node: ValidNode): PageLinkTarget {
  return {
    pageId: attrOf<string | null>(node, "pageId"),
    spaceId: attrOf<string | null>(node, "spaceId"),
    title: attrOf<string | null>(node, "title"),
  };
}

export const mentionModule = defineModule({
  name: "mention",
  nodes: [
    {
      name: "mention",
      spec: { ...inlineAtom, selectable: true },
      attrs: { id: required(uuidValue) },
      portable: removedNode("mention"),
      html: (node, renderer) =>
        element(
          "span",
          { class: "ld-mention", "data-account-id": attrOf<string>(node, "id") },
          renderer.escape(`@${renderer.mentionName(attrOf<string>(node, "id"))}`),
        ),
      word: (node, renderer) => [
        wordText(`@${renderer.mentionName(attrOf<string>(node, "id"))}`, { bold: true }),
      ],
      markdown: (node, renderer) => renderer.escape(`@${renderer.mentionName(attrOf<string>(node, "id"))}`),
      text: () => "",
    },
  ],
});

export const pageLinkModule = defineModule({
  name: "pageLink",
  nodes: [
    {
      name: "pageLink",
      spec: inlineAtom,
      attrs: {
        pageId: optional(uuidValue.nullable(), null),
        spaceId: optional(uuidValue.nullable(), null),
        title: optional(z.string().max(255).nullable(), null),
      },
      copy: copyPageAttribute("pageId", "spaceId"),
      portable: removedNode("pageLink"),
      validate: (node) => {
        if (attrOf<string | null>(node, "pageId") !== null) return null;
        const title = attrOf<string | null>(node, "title");
        if (attrOf<string | null>(node, "spaceId") !== null && title !== null && title.trim().length > 0) {
          return null;
        }
        return "A page link needs a page, or a space and a title for a page that does not exist yet";
      },
      html: (node, renderer) => {
        const target = linkTarget(node);
        const resolved = renderer.pageLink(target);
        const missing = target.pageId === null ? "true" : null;
        if (resolved?.inTrash) {
          return element(
            "span",
            { class: "ld-page-link", "data-state": "trash" },
            renderer.escape(
              `${resolved.title || renderer.label("untitledPage")} (${renderer.label("inTrash")})`,
            ),
          );
        }
        if (resolved && !resolved.accessible) {
          return element(
            "span",
            { class: "ld-page-link", "data-access": "none" },
            renderer.escape(renderer.label("noAccess")),
          );
        }
        const title = resolved?.title || target.title || renderer.label("untitledPage");
        const href = resolved ? renderer.safeHref(resolved.href) : null;
        if (!href) {
          return element("span", { class: "ld-page-link", "data-missing": missing }, renderer.escape(title));
        }
        return element("a", { class: "ld-page-link", href, "data-missing": missing }, renderer.escape(title));
      },
      word: (node, renderer) => {
        const target = linkTarget(node);
        const resolved = renderer.pageLink(target);
        if (resolved?.inTrash) {
          return [
            wordText(`${resolved.title || renderer.label("untitledPage")} (${renderer.label("inTrash")})`, {
              muted: true,
            }),
          ];
        }
        if (resolved && !resolved.accessible) {
          return [wordText(renderer.label("noAccess"), { muted: true, italic: true })];
        }
        const title = resolved?.title || target.title || renderer.label("untitledPage");
        const href = resolved ? renderer.safeHref(resolved.href) : null;
        return [wordText(title, href ? { link: href } : {})];
      },
      markdown: (node, renderer) => {
        const target = linkTarget(node);
        const resolved = renderer.pageLink(target);
        if (resolved?.inTrash) {
          return renderer.escape(
            `${resolved.title || renderer.label("untitledPage")} (${renderer.label("inTrash")})`,
          );
        }
        if (resolved && !resolved.accessible) return renderer.escape(renderer.label("noAccess"));
        const title = renderer.escape(resolved?.title || target.title || renderer.label("untitledPage"));
        const href = resolved ? renderer.safeHref(resolved.href) : null;
        return href ? `[${title}](${markdownUrl(href)})` : title;
      },
      text: () => "",
    },
  ],
});

export const emojiModule = defineModule({
  name: "emoji",
  nodes: [
    {
      name: "emoji",
      spec: inlineAtom,
      attrs: { emoji: required(emojiValue) },
      html: (node, renderer) =>
        element("span", { class: "ld-emoji" }, renderer.escape(attrOf<string>(node, "emoji"))),
      word: (node) => [wordText(attrOf<string>(node, "emoji"))],
      markdown: (node) => attrOf<string>(node, "emoji"),
      text: (node) => attrOf<string>(node, "emoji"),
    },
  ],
});

export const dateModule = defineModule({
  name: "date",
  nodes: [
    {
      name: "date",
      spec: inlineAtom,
      attrs: { date: required(isoDateValue) },
      html: (node, renderer) => {
        const date = attrOf<string>(node, "date");
        return element(
          "time",
          { class: "ld-date", datetime: date },
          renderer.escape(renderer.formatDate(date)),
        );
      },
      word: (node, renderer) => [wordText(renderer.formatDate(attrOf<string>(node, "date")))],
      markdown: (node, renderer) => renderer.escape(renderer.formatDate(attrOf<string>(node, "date"))),
      text: (node) => attrOf<string>(node, "date"),
    },
  ],
});
