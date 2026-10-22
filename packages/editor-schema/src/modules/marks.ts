import { attrOf, defineModule, optional, required } from "../module.js";
import { removedNode } from "../portable.js";
import { element, inlineCode, markdownUrl, wrapDelimited } from "../text.js";
import { type ContentColor, colorValue, hrefValue, uuidValue } from "../values.js";

export const linkModule = defineModule({
  name: "link",
  marks: [
    {
      name: "link",
      spec: { inclusive: false },
      attrs: { href: required(hrefValue) },
      copy: (attrs, mapping) => ({ ...attrs, href: mapping.href(String(attrs.href)) }),
      portable: (attrs, context) => {
        if (!context.strips("pageLink") || !context.isInternalHref(String(attrs.href))) return attrs;
        context.removed("pageLink");
        return null;
      },
      html: (mark, content, renderer) => {
        const href = renderer.safeHref(attrOf<string>(mark, "href"));
        if (!href) return content;
        return element("a", { href, rel: "noopener noreferrer" }, content);
      },
      word: (mark, style, renderer) => {
        const href = renderer.safeHref(attrOf<string>(mark, "href"));
        return href ? { ...style, link: href } : style;
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
      word: (_mark, style) => ({ ...style, bold: true }),
      markdown: (_mark, content) => wrapDelimited(content, "**"),
    },
    {
      name: "italic",
      spec: {},
      html: (_mark, content) => element("em", {}, content),
      word: (_mark, style) => ({ ...style, italic: true }),
      markdown: (_mark, content) => wrapDelimited(content, "*"),
    },
    {
      name: "underline",
      spec: {},
      html: (_mark, content) => element("u", {}, content),
      word: (_mark, style) => ({ ...style, underline: true }),
      markdown: (_mark, content) => `<u>${content}</u>`,
    },
    {
      name: "strike",
      spec: {},
      html: (_mark, content) => element("s", {}, content),
      word: (_mark, style) => ({ ...style, strike: true }),
      markdown: (_mark, content) => wrapDelimited(content, "~~"),
    },
    {
      name: "subscript",
      spec: { excludes: "superscript" },
      html: (_mark, content) => element("sub", {}, content),
      word: (_mark, style) => ({ ...style, subscript: true }),
      markdown: (_mark, content) => `<sub>${content}</sub>`,
    },
    {
      name: "superscript",
      spec: { excludes: "subscript" },
      html: (_mark, content) => element("sup", {}, content),
      word: (_mark, style) => ({ ...style, superscript: true }),
      markdown: (_mark, content) => `<sup>${content}</sup>`,
    },
    {
      name: "code",
      spec: { excludes: codeExcludes, code: true },
      html: (_mark, content) => element("code", {}, content),
      word: (_mark, style) => ({ ...style, code: true }),
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
        element("span", { class: "ld-text-color", "data-color": attrOf<string>(mark, "color") }, content),
      word: (mark, style) => ({ ...style, color: attrOf<ContentColor>(mark, "color") }),
      markdown: (_mark, content) => content,
    },
    {
      name: "highlight",
      spec: {},
      attrs: { color: optional(colorValue, "yellow") },
      html: (mark, content) =>
        element("mark", { class: "ld-highlight", "data-color": attrOf<string>(mark, "color") }, content),
      word: (mark, style) => ({ ...style, highlight: attrOf<ContentColor>(mark, "color") }),
      markdown: (_mark, content) => content,
    },
  ],
});

export const inlineCommentModule = defineModule({
  name: "inlineComment",
  marks: [
    {
      name: "inlineComment",
      spec: { inclusive: false, excludes: "" },
      attrs: { threadId: required(uuidValue) },
      copy: () => null,
      portable: removedNode("comment"),
      html: (mark, content) =>
        element("span", { class: "ld-comment", "data-thread-id": attrOf<string>(mark, "threadId") }, content),
      word: (_mark, style) => style,
      markdown: (_mark, content) => content,
    },
  ],
});
