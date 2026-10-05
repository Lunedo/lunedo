import { modules } from "@pagehall/editor-schema";
import { Extension } from "@tiptap/core";
import { Fragment, type Mark, type Node as ProseMirrorNode, Slice } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: false });

const MARKDOWN_HINTS = [
  /^#{1,6}\s+\S/m,
  /^\s*[-*+]\s+\S/m,
  /^\s*\d+[.)]\s+\S/m,
  /^\s*>\s?\S/m,
  /^```/m,
  /^\s*[-*+]\s+\[[ xX]\]\s/m,
  /^\|.+\|\s*$/m,
  /\*\*[^*\n]+\*\*/,
  /\[[^\]\n]+\]\([^)\s]+\)/,
  /`[^`\n]+`/,
];

export function looksLikeMarkdown(text: string): boolean {
  return MARKDOWN_HINTS.filter((hint) => hint.test(text)).length > 0 && text.trim().length > 0;
}

const TASK_MARKER = /^\[([ xX])\]\s?/;

function firstTextNode(element: Element): Text | null {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  return walker.nextNode() as Text | null;
}

export function markdownToHtml(text: string): string {
  const document = new DOMParser().parseFromString(markdown.render(text), "text/html");
  for (const list of Array.from(document.body.querySelectorAll("ul"))) {
    const items = Array.from(list.children).filter((child) => child.tagName === "LI");
    const markers = items.map((item) => firstTextNode(item));
    if (items.length === 0 || !markers.every((node) => node && TASK_MARKER.test(node.data))) continue;
    list.setAttribute("data-type", "taskList");
    items.forEach((item, index) => {
      const node = markers[index] as Text;
      const checked = /^\[[xX]\]/.test(node.data);
      node.data = node.data.replace(TASK_MARKER, "");
      item.setAttribute("data-type", "taskItem");
      item.setAttribute("data-checked", String(checked));
    });
  }
  return document.body.innerHTML;
}

function unwrap(element: Element): void {
  element.replaceWith(...Array.from(element.childNodes));
}

function wordListMarker(paragraph: Element): string {
  const marker = paragraph.querySelector('[style*="mso-list:Ignore"], [style*="mso-list: Ignore"]');
  const text = marker?.textContent?.trim() ?? "";
  marker?.remove();
  return text;
}

function convertWordLists(root: ParentNode, document: globalThis.Document): void {
  const paragraphs = Array.from(root.querySelectorAll("p")).filter(
    (paragraph) =>
      /mso-list:/i.test(paragraph.getAttribute("style") ?? "") ||
      /MsoListParagraph/i.test(paragraph.className),
  );
  let list: Element | null = null;
  let previous: Element | null = null;
  for (const paragraph of paragraphs) {
    const marker = wordListMarker(paragraph);
    const ordered = /^[\da-zA-Z]+[.)]$/.test(marker);
    const tag = ordered ? "ol" : "ul";
    if (!list || previous?.nextElementSibling !== paragraph || list.tagName.toLowerCase() !== tag) {
      list = document.createElement(tag);
      paragraph.before(list);
    }
    const item = document.createElement("li");
    const content = document.createElement("p");
    content.append(...Array.from(paragraph.childNodes));
    item.append(content);
    list.append(item);
    paragraph.remove();
    previous = list;
  }
}

export function cleanPastedHtml(html: string): string {
  const withoutComments = html
    .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?o:p>/gi, "");
  const document = globalThis.document;
  const template = document.createElement("template");
  template.innerHTML = withoutComments;
  const body = template.content;
  for (const element of Array.from(
    body.querySelectorAll(
      "script, style, meta, link, iframe, object, embed, noscript, template, svg, math, form",
    ),
  )) {
    element.remove();
  }
  for (const element of Array.from(body.querySelectorAll('b[id^="docs-internal-guid"]'))) unwrap(element);
  for (const element of Array.from(body.querySelectorAll("img, video, audio, picture, canvas")))
    element.remove();
  convertWordLists(body, document);
  for (const element of Array.from(body.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
    }
    if (element.tagName.includes(":")) unwrap(element);
  }
  const container = document.createElement("div");
  container.append(body);
  return container.innerHTML;
}

function attributesValid(kind: "node" | "mark", name: string, attrs: Record<string, unknown>): boolean {
  const definition = kind === "node" ? modules.node(name) : modules.mark(name);
  if (!definition) return false;
  return Object.entries(definition.attrs ?? {}).every(
    ([attribute, spec]) => spec.schema.safeParse(attrs[attribute]).success,
  );
}

function sanitizeMarks(marks: readonly Mark[]): readonly Mark[] {
  return marks.filter((mark) => attributesValid("mark", mark.type.name, mark.attrs));
}

function sanitizeFragment(fragment: Fragment): Fragment {
  const children: ProseMirrorNode[] = [];
  fragment.forEach((child) => {
    if (child.isText) {
      children.push(child.mark(sanitizeMarks(child.marks)));
      return;
    }
    if (!attributesValid("node", child.type.name, child.attrs)) {
      if (child.isLeaf) return;
      const inner = sanitizeFragment(child.content);
      inner.forEach((grandchild) => {
        children.push(grandchild);
      });
      return;
    }
    const content = sanitizeFragment(child.content);
    try {
      const node = child.type.create(child.attrs, content, sanitizeMarks(child.marks));
      node.check();
      children.push(node);
    } catch {
      content.forEach((grandchild) => {
        children.push(grandchild);
      });
    }
  });
  return Fragment.fromArray(children);
}

export function sanitizeSlice(slice: Slice): Slice {
  return new Slice(sanitizeFragment(slice.content), slice.openStart, slice.openEnd);
}

const key = new PluginKey("pagehallPaste");

export const CleanPaste = Extension.create({
  name: "cleanPaste",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        props: {
          transformPastedHTML: (html) => cleanPastedHtml(html),
          transformPasted: (slice) => sanitizeSlice(slice),
          handlePaste: (view, event) => {
            const data = event.clipboardData;
            if (!data || data.getData("text/html")) return false;
            const text = data.getData("text/plain");
            const { $from } = view.state.selection;
            if (!text || $from.parent.type.spec.code || !looksLikeMarkdown(text)) return false;
            view.pasteHTML(markdownToHtml(text), event);
            return true;
          },
        },
      }),
    ];
  },
});
