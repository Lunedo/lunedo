import { attrOf, defineModule, optional, required } from "../module.js";
import { element, inlineCode, markdownUrl, wrapDelimited } from "../text.js";
import { colorValue, hrefValue, uuidValue } from "../values.js";

export const linkModule = defineModule({
  name: "link",
  marks: [
    {
      name: "link",
      spec: { inclusive: false },
      attrs: { href: required(hrefValue) },
      html: (mark, content, renderer) => {
        const href = renderer.safeHref(attrOf<string>(mark, "href"));
        if (!href) return content;
        return element("a", { href, rel: "noopener noreferrer" }, content);
      },
      markdown: (mark, content, renderer) => {
        const href = renderer.safeHref(attrOf<string>(mark, "href"));
        if (!href) return content;
        return `[${content}](${markdownUrl(href)})`;
      },
    },
  ],
});

const codeExcludes = "bold italic underline strike textColor highlight subscript superscript";

export const formattingModule = defineModule({
  name: "formatting",
  marks: [
    {
      name: "bold",
      spec: {},
      html: (_mark, content) => element("strong", {}, content),
      markdown: (_mark, content) => wrapDelimited(content, "**"),
    },
    {
      name: "italic",
      spec: {},
      html: (_mark, content) => element("em", {}, content),
      markdown: (_mark, content) => wrapDelimited(content, "*"),
    },
    {
      name: "underline",
      spec: {},
      html: (_mark, content) => element("u", {}, content),
      markdown: (_mark, content) => `<u>${content}</u>`,
    },
    {
      name: "strike",
      spec: {},
      html: (_mark, content) => element("s", {}, content),
      markdown: (_mark, content) => wrapDelimited(content, "~~"),
    },
    {
      name: "subscript",
      spec: { excludes: "superscript" },
      html: (_mark, content) => element("sub", {}, content),
      markdown: (_mark, content) => `<sub>${content}</sub>`,
    },
    {
      name: "superscript",
      spec: { excludes: "subscript" },
      html: (_mark, content) => element("sup", {}, content),
      markdown: (_mark, content) => `<sup>${content}</sup>`,
    },
    {
      name: "code",
      spec: { excludes: codeExcludes, code: true },
      html: (_mark, content) => element("code", {}, content),
      markdown: (_mark, content) => inlineCode(content),
    },
  ],
});

export const colorsModule = defineModule({
  name: "colors",
  marks: [
    {
      name: "textColor",
      spec: {},
      attrs: { color: required(colorValue) },
      html: (mark, content) =>
        element("span", { class: "ph-text-color", "data-color": attrOf<string>(mark, "color") }, content),
      markdown: (_mark, content) => content,
    },
    {
      name: "highlight",
      spec: {},
      attrs: { color: optional(colorValue, "yellow") },
      html: (mark, content) =>
        element("mark", { class: "ph-highlight", "data-color": attrOf<string>(mark, "color") }, content),
      markdown: (_mark, content) => content,
    },
  ],
});

export const inlineCommentModule = defineModule({
  name: "inlineComment",
  marks: [
    {
      name: "inlineComment",
      spec: { inclusive: false },
      attrs: { threadId: required(uuidValue) },
      html: (mark, content) =>
        element("span", { class: "ph-comment", "data-thread-id": attrOf<string>(mark, "threadId") }, content),
      markdown: (_mark, content) => content,
    },
  ],
});
