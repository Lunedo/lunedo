import { codeLanguages, commentKit, isAllowedHref } from "@pagehall/editor-schema";
import { type AnyExtension, Mark, mergeAttributes, Node, textblockTypeInputRule } from "@tiptap/core";
import Blockquote from "@tiptap/extension-blockquote";
import Bold from "@tiptap/extension-bold";
import Code from "@tiptap/extension-code";
import { backtickInputRegex, tildeInputRegex } from "@tiptap/extension-code-block";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Document from "@tiptap/extension-document";
import HardBreak from "@tiptap/extension-hard-break";
import Heading from "@tiptap/extension-heading";
import Highlight from "@tiptap/extension-highlight";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import Italic from "@tiptap/extension-italic";
import Link from "@tiptap/extension-link";
import { BulletList, ListItem, OrderedList, TaskItem, TaskList } from "@tiptap/extension-list";
import Mention from "@tiptap/extension-mention";
import Paragraph from "@tiptap/extension-paragraph";
import Strike from "@tiptap/extension-strike";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import Text from "@tiptap/extension-text";
import Underline from "@tiptap/extension-underline";
import powershell from "highlight.js/lib/languages/powershell";
import { common, createLowlight } from "lowlight";
import {
  type AttributeCodec,
  attributeIsValid,
  dataAttribute,
  markFields,
  nodeFields,
  requiredAttributesPresent,
  schemaAttributes,
} from "./derive.js";

export const lowlight = createLowlight({ ...common, powershell });

const knownLanguages = new Set<string>(codeLanguages);

const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  py: "python",
  rb: "ruby",
  yml: "yaml",
  md: "markdown",
  html: "xml",
  xhtml: "xml",
  svg: "xml",
  cs: "csharp",
  "c#": "csharp",
  "c++": "cpp",
  hpp: "cpp",
  kt: "kotlin",
  rs: "rust",
  golang: "go",
  "objective-c": "objectivec",
  pl: "perl",
  vb: "vbnet",
  console: "shell",
  ps: "powershell",
  ps1: "powershell",
  pwsh: "powershell",
};

export function canonicalLanguage(value: string): string | null {
  const language = value.trim().toLowerCase();
  const resolved = LANGUAGE_ALIASES[language] ?? language;
  return knownLanguages.has(resolved) ? resolved : null;
}

const alignCodec: AttributeCodec = {
  parse: (element) => {
    const value = element.getAttribute("data-align") ?? element.style.textAlign;
    return value && value !== "start" ? value : undefined;
  },
  render: (value) => (value && value !== "left" ? { "data-align": String(value) } : null),
};

const indentCodec: AttributeCodec = {
  parse: (element) => {
    const value = Number(element.getAttribute("data-indent"));
    return Number.isInteger(value) && value > 0 ? value : undefined;
  },
  render: (value) => (typeof value === "number" && value > 0 ? { "data-indent": String(value) } : null),
};

const blockCodecs = { textAlign: alignCodec, indent: indentCodec };

const colwidthCodec: AttributeCodec = {
  parse: (element) => {
    const raw = element.getAttribute("data-colwidth");
    if (!raw) return undefined;
    const widths = raw.split(",").map((part) => Number(part));
    return widths.every((width) => Number.isInteger(width) && width > 0) ? widths : undefined;
  },
  render: (value) => (Array.isArray(value) ? { "data-colwidth": value.join(",") } : null),
};

const spanCodec = (name: "colspan" | "rowspan"): AttributeCodec => ({
  parse: (element) => {
    const value = Number(element.getAttribute(name) ?? "1");
    return Number.isInteger(value) && value >= 1 ? value : undefined;
  },
  render: (value) => (typeof value === "number" && value > 1 ? { [name]: String(value) } : null),
});

const cellCodecs = {
  colspan: spanCodec("colspan"),
  rowspan: spanCodec("rowspan"),
  colwidth: colwidthCodec,
  background: dataAttribute("background"),
};

const languageCodec: AttributeCodec = {
  parse: (element) => {
    const explicit = element.getAttribute("data-language");
    const fromClass = [...(element.querySelector("code")?.classList ?? element.classList)]
      .find((name) => name.startsWith("language-"))
      ?.slice("language-".length);
    return canonicalLanguage(explicit ?? fromClass ?? "") ?? undefined;
  },
  render: (value) => (typeof value === "string" ? { "data-language": value } : null),
};

function atomNode(name: string, tag: "span" | "div", codecs: Record<string, AttributeCodec> = {}) {
  return Node.create({
    name,
    ...nodeFields(name),
    addAttributes() {
      return schemaAttributes("node", name, codecs);
    },
    parseHTML() {
      return [
        {
          tag: `${tag}[data-type="${name}"]`,
          getAttrs: (element) => requiredAttributesPresent("node", name, codecs)(element as HTMLElement),
        },
      ];
    },
    renderHTML({ HTMLAttributes }) {
      return [tag, mergeAttributes(HTMLAttributes, { "data-type": name })];
    },
  });
}

function containerNode(name: string, codecs: Record<string, AttributeCodec> = {}) {
  return Node.create({
    name,
    ...nodeFields(name),
    addAttributes() {
      return schemaAttributes("node", name, codecs);
    },
    parseHTML() {
      return [
        {
          tag: `div[data-type="${name}"]`,
          getAttrs: (element) => requiredAttributesPresent("node", name, codecs)(element as HTMLElement),
        },
      ];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes(HTMLAttributes, { "data-type": name }), 0];
    },
  });
}

export const MentionNode = Mention.extend({
  ...nodeFields("mention"),
  addAttributes() {
    return schemaAttributes("node", "mention");
  },
  parseHTML() {
    return [
      {
        tag: 'span[data-type="mention"]',
        getAttrs: (element) => requiredAttributesPresent("node", "mention")(element as HTMLElement),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { "data-type": "mention" }), "@"];
  },
  renderText() {
    return "@";
  },
});

export const CodeBlock = CodeBlockLowlight.extend({
  ...nodeFields("codeBlock"),
  addAttributes() {
    return schemaAttributes("node", "codeBlock", { language: languageCodec });
  },
  addInputRules() {
    return [backtickInputRegex, tildeInputRegex].map((find) =>
      textblockTypeInputRule({
        find,
        type: this.type,
        getAttributes: (match) => ({ language: canonicalLanguage(match[1] ?? "") }),
      }),
    );
  },
}).configure({ lowlight, defaultLanguage: null });

export const LinkMark = Link.extend({
  ...markFields("link"),
  addAttributes() {
    return schemaAttributes("mark", "link", {
      href: {
        parse: (element) => {
          const href = element.getAttribute("href");
          return href && isAllowedHref(href) ? href : undefined;
        },
        render: (value) => (typeof value === "string" ? { href: value, rel: "noopener noreferrer" } : null),
      },
    });
  },
  parseHTML() {
    return [
      {
        tag: "a[href]",
        getAttrs: (element) => {
          const href = (element as HTMLElement).getAttribute("href");
          return href && isAllowedHref(href) ? null : false;
        },
      },
    ];
  },
}).configure({
  openOnClick: false,
  autolink: true,
  linkOnPaste: true,
  isAllowedUri: (url) => isAllowedHref(url),
});

export const TextColor = Mark.create({
  name: "textColor",
  ...markFields("textColor"),
  addAttributes() {
    return schemaAttributes("mark", "textColor", { color: dataAttribute("color") });
  },
  parseHTML() {
    return [
      {
        tag: "span[data-text-color]",
        getAttrs: (element) => {
          const color = (element as HTMLElement).getAttribute("data-text-color");
          return color && attributeIsValid("mark", "textColor", "color", color) ? { color } : false;
        },
      },
    ];
  },
  renderHTML({ mark, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-text-color": String(mark.attrs.color),
        class: "ph-text-color",
      }),
      0,
    ];
  },
});

export const HighlightMark = Highlight.extend({
  ...markFields("highlight"),
  addAttributes() {
    return schemaAttributes("mark", "highlight", { color: dataAttribute("color") });
  },
  parseHTML() {
    return [{ tag: "mark" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["mark", mergeAttributes(HTMLAttributes, { class: "ph-highlight" }), 0];
  },
}).configure({ multicolor: true });

export const InlineComment = Mark.create({
  name: "inlineComment",
  ...markFields("inlineComment"),
  addAttributes() {
    return schemaAttributes("mark", "inlineComment");
  },
  parseHTML() {
    return [
      {
        tag: "span[data-thread-id]",
        getAttrs: (element) => requiredAttributesPresent("mark", "inlineComment")(element as HTMLElement),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "ph-comment" }), 0];
  },
});

const COMMENT_CODE_EXCLUDES = "bold italic underline strike subscript superscript";

export function commentSchemaExtensions(): AnyExtension[] {
  const allowed = new Set([...Object.keys(commentKit.schema.nodes), ...Object.keys(commentKit.schema.marks)]);
  return schemaExtensions()
    .filter((extension) => allowed.has(extension.name))
    .map((extension) =>
      extension.name === "code"
        ? Code.extend({ ...markFields("code"), excludes: COMMENT_CODE_EXCLUDES })
        : extension,
    );
}

export function schemaExtensions(): AnyExtension[] {
  return [
    Document.extend(nodeFields("doc")),
    Text,
    Paragraph.extend({
      ...nodeFields("paragraph"),
      addAttributes() {
        return schemaAttributes("node", "paragraph", blockCodecs);
      },
    }),
    HardBreak.extend(nodeFields("hardBreak")),
    Heading.extend({
      ...nodeFields("heading"),
      addAttributes() {
        return schemaAttributes("node", "heading", {
          ...blockCodecs,
          level: {
            parse: (element) => {
              const level = Number(element.tagName.slice(1));
              return Number.isInteger(level) ? level : undefined;
            },
          },
        });
      },
    }).configure({ levels: [1, 2, 3, 4, 5, 6] }),
    Blockquote.extend(nodeFields("blockquote")),
    HorizontalRule.extend(nodeFields("horizontalRule")),
    BulletList.extend(nodeFields("bulletList")),
    OrderedList.extend({
      ...nodeFields("orderedList"),
      addAttributes() {
        return schemaAttributes("node", "orderedList", {
          start: {
            parse: (element) => {
              const start = Number(element.getAttribute("start") ?? "1");
              return Number.isInteger(start) && start >= 1 ? start : undefined;
            },
            render: (value) => (typeof value === "number" && value !== 1 ? { start: String(value) } : null),
          },
        });
      },
    }),
    ListItem.extend(nodeFields("listItem")),
    TaskList.extend(nodeFields("taskList")),
    TaskItem.extend({
      ...nodeFields("taskItem"),
      addAttributes() {
        return schemaAttributes("node", "taskItem", {
          id: dataAttribute("taskId"),
          assignee: dataAttribute("assignee"),
          dueDate: dataAttribute("dueDate"),
        });
      },
    }).configure({ nested: true }),
    CodeBlock,
    Table.extend(nodeFields("table")).configure({ resizable: true, allowTableNodeSelection: true }),
    TableRow.extend(nodeFields("tableRow")),
    TableCell.extend({
      ...nodeFields("tableCell"),
      addAttributes() {
        return schemaAttributes("node", "tableCell", cellCodecs);
      },
    }),
    TableHeader.extend({
      ...nodeFields("tableHeader"),
      addAttributes() {
        return schemaAttributes("node", "tableHeader", cellCodecs);
      },
    }),
    MentionNode,
    atomNode("pageLink", "span"),
    atomNode("emoji", "span"),
    atomNode("date", "span"),
    atomNode("status", "span"),
    atomNode("placeholder", "span"),
    atomNode("templateField", "span"),
    atomNode("inlineMath", "span"),
    atomNode("blockMath", "div"),
    atomNode("tableOfContents", "div", {
      minLevel: dataAttribute("minLevel", "number"),
      maxLevel: dataAttribute("maxLevel", "number"),
    }),
    atomNode("childPages", "div", {
      pageId: dataAttribute("pageId"),
      depth: dataAttribute("depth", "number"),
      reverse: dataAttribute("reverse", "boolean"),
    }),
    atomNode("attachmentList", "div", { fileTypes: dataAttribute("fileTypes", "json") }),
    atomNode("unsupportedMacro", "div", { data: dataAttribute("data", "json") }),
    atomNode("taskReport", "div", {
      assignedToViewer: dataAttribute("assignedToViewer", "boolean"),
      pageIds: dataAttribute("pageIds", "json"),
      labels: dataAttribute("labels", "json"),
    }),
    atomNode("pageReport", "div", {
      labels: dataAttribute("labels", "json"),
      reverse: dataAttribute("reverse", "boolean"),
      limit: dataAttribute("limit", "number"),
    }),
    atomNode("decisionReport", "div", { labels: dataAttribute("labels", "json") }),
    atomNode("propertiesReport", "div", {
      spaceIds: dataAttribute("spaceIds", "json"),
      labels: dataAttribute("labels", "json"),
      columns: dataAttribute("columns", "json"),
      reverse: dataAttribute("reverse", "boolean"),
      pageSize: dataAttribute("pageSize", "number"),
      showCreator: dataAttribute("showCreator", "boolean"),
      showLabels: dataAttribute("showLabels", "boolean"),
    }),
    atomNode("contentByLabel", "div", {
      labels: dataAttribute("labels", "json"),
      matchAll: dataAttribute("matchAll", "boolean"),
      spaceIds: dataAttribute("spaceIds", "json"),
      kinds: dataAttribute("kinds", "json"),
      reverse: dataAttribute("reverse", "boolean"),
      limit: dataAttribute("limit", "number"),
      excerpts: dataAttribute("excerpts", "boolean"),
      showLabels: dataAttribute("showLabels", "boolean"),
      showSpace: dataAttribute("showSpace", "boolean"),
    }),
    atomNode("relatedLabels", "div", { labels: dataAttribute("labels", "json") }),
    atomNode("includeExcerpt", "div", { panel: dataAttribute("panel", "boolean") }),
    atomNode("includePage", "div"),
    atomNode("roadmap", "div", { roadmap: dataAttribute("roadmap", "json") }),
    atomNode("templateButton", "div"),
    atomNode("image", "div", { width: dataAttribute("width", "number") }),
    atomNode("file", "div"),
    atomNode("drawing", "div", {
      id: dataAttribute("drawingId"),
      sceneVersion: dataAttribute("sceneVersion", "number"),
      previewVersion: dataAttribute("previewVersion", "number"),
    }),
    containerNode("section"),
    containerNode("callout"),
    containerNode("expand"),
    containerNode("columns"),
    containerNode("column", { width: dataAttribute("width", "number") }),
    containerNode("topicUpdate"),
    containerNode("decision", { id: dataAttribute("decisionId") }),
    containerNode("pageProperties", { hidden: dataAttribute("hidden", "boolean") }),
    containerNode("pageProperty"),
    containerNode("pagePropertyKey"),
    containerNode("pagePropertyValue"),
    containerNode("excerpt", { hidden: dataAttribute("hidden", "boolean") }),
    Bold.extend(markFields("bold")),
    Italic.extend(markFields("italic")),
    Underline.extend(markFields("underline")),
    Strike.extend(markFields("strike")),
    Subscript.extend(markFields("subscript")),
    Superscript.extend(markFields("superscript")),
    Code.extend(markFields("code")),
    LinkMark,
    TextColor,
    HighlightMark,
    InlineComment,
  ];
}
