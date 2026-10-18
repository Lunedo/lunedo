import {
  type DocumentJson,
  defaultImportTexts,
  type ImportText,
  isAllowedHref,
  isIsoDate,
  MAX_DOCUMENT_BYTES,
  MAX_MACRO_DATA_BYTES,
  MAX_NODES,
  MAX_PLACEHOLDER_LENGTH,
  type MacroConverter,
  type MacroImportContext,
  type MacroNote,
  type MarkJson,
  modules,
  type NodeJson,
  schema,
  validateDocument,
} from "@pagehall/editor-schema";
import { escapeXml } from "../formats/escape.js";
import { DEFAULT_XML_LIMITS, parseXmlFragment, type XmlLimits, type XmlNode } from "../formats/xml.js";
import { paletteColor } from "./colors.js";

export interface PageReference {
  readonly title: string | null;
  readonly spaceKey: string | null;
  readonly sourceId: string | null;
  readonly formerTitles?: boolean;
}

export interface AttachmentReference {
  readonly fileName: string;
  readonly pageTitle: string | null;
  readonly spaceKey: string | null;
}

export interface FoundAttachment {
  readonly attachmentId: string;
  readonly name: string;
  readonly version: number;
}

export interface PersonReference {
  readonly accountId: string | null;
  readonly userKey: string | null;
}

export type ResolvedPage =
  | { readonly kind: "page"; readonly pageId: string; readonly path: string }
  | { readonly kind: "external"; readonly href: string | null };

export interface StorageLookup {
  page(reference: PageReference): ResolvedPage;
  attachment(reference: AttachmentReference): FoundAttachment | null;
  person(reference: PersonReference): string | null;
  space(spaceKey: string): string | null;
  spaceId?(spaceKey: string | null): string | null;
  template?(sourceId: string): string | null;
  readonly templateVariables?: ReadonlyMap<string, string>;
  inlineComment?(ref: string): string | null;
  readonly spaceKey?: string;
  newId(): string;
  diagramId?(name: string, pageSourceId: string | null): string;
  embeddable?(url: string): boolean;
  text?(key: ImportText): string;
  jiraIssueUrl?(key: string): string | null;
}

export type ConversionNote =
  | { readonly code: "externalPageLink"; readonly title: string; readonly spaceKey: string | null }
  | { readonly code: "missingAttachment"; readonly fileName: string }
  | { readonly code: "externalImage" }
  | { readonly code: "unsupportedLink"; readonly kind: string }
  | { readonly code: "invalidLink" }
  | { readonly code: "unresolvedPerson" }
  | { readonly code: "invalidContent"; readonly element: string }
  | { readonly code: "contentTruncated" }
  | { readonly code: "macroDataTruncated"; readonly macro: string }
  | MacroNote;

export interface ConvertedTask {
  readonly id: string;
  readonly done: boolean;
}

export interface ConvertedPage {
  readonly document: DocumentJson;
  readonly macros: ReadonlyMap<string, number>;
  readonly converted: ReadonlyMap<string, number>;
  readonly notes: readonly ConversionNote[];
  readonly tasks: readonly ConvertedTask[];
  readonly numberHeadings: boolean;
}

export const CONTENT_FALLBACK_MACRO = "confluence-content";

const MARK_ORDER = new Map(Object.keys(schema.marks).map((name, index) => [name, index]));
const CODE_EXCLUDES = new Set([
  "bold",
  "italic",
  "underline",
  "strike",
  "textColor",
  "highlight",
  "subscript",
  "superscript",
]);
const EMOJI = /^\p{RGI_Emoji}$/v;
const EMOTICONS: Readonly<Record<string, string>> = {
  smile: "🙂",
  sad: "🙁",
  cheeky: "😛",
  laugh: "😀",
  wink: "😉",
  "thumbs-up": "👍",
  "thumbs-down": "👎",
  information: "ℹ️",
  tick: "✅",
  cross: "❌",
  warning: "⚠️",
  plus: "➕",
  minus: "➖",
  question: "❓",
  "light-on": "💡",
  "light-off": "🌑",
  "yellow-star": "⭐",
  "red-star": "⭐",
  "green-star": "⭐",
  "blue-star": "⭐",
  heart: "❤️",
  "broken-heart": "💔",
};
const LAYOUT_WIDTHS: Readonly<Record<string, readonly number[]>> = {
  two_equal: [50, 50],
  two_left_sidebar: [30, 70],
  two_right_sidebar: [70, 30],
  three_equal: [33, 34, 33],
  three_with_sidebars: [25, 50, 25],
  three_left_sidebars: [25, 25, 50],
  three_right_sidebars: [50, 25, 25],
  four_equal: [25, 25, 25, 25],
};
const BLOCK_ELEMENTS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "table",
  "pre",
  "blockquote",
  "hr",
  "div",
  "section",
  "article",
  "ac:task-list",
  "ac:layout",
  "ac:layout-section",
  "ac:layout-cell",
  "ac:structured-macro",
  "ac:macro",
  "ac:adf-extension",
  "ac:adf-node",
  "ac:image",
  "img",
]);
const FORGE_EXTENSION_TYPE = "com.atlassian.ecosystem";
const SOURCE_PAGE_PATTERNS = [/\/pages\/(\d+)(?:[/?#]|$)/, /[?&]pageId=(\d+)(?:&|#|$)/];

type Item = { readonly inline: NodeJson } | { readonly block: NodeJson };

function element(node: XmlNode | string): node is XmlNode {
  return typeof node !== "string";
}

function childElements(node: XmlNode, name?: string): XmlNode[] {
  return node.children.filter(element).filter((child) => name === undefined || child.name === name);
}

function firstChild(node: XmlNode, name: string): XmlNode | undefined {
  return childElements(node, name)[0];
}

function textContent(node: XmlNode | string): string {
  if (typeof node === "string") return node;
  return node.children.map(textContent).join("");
}

function styleOf(node: XmlNode): Map<string, string> {
  const result = new Map<string, string>();
  for (const declaration of (node.attributes.style ?? "").split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    result.set(declaration.slice(0, separator).trim().toLowerCase(), declaration.slice(separator + 1).trim());
  }
  return result;
}

function pixels(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d+(?:\.\d+)?)(px)?$/.exec(value.trim());
  if (!match?.[1]) return null;
  const number = Math.round(Number(match[1]));
  return number >= 1 && number <= 100_000 ? number : null;
}

function addMark(marks: readonly MarkJson[], mark: MarkJson): MarkJson[] {
  if (marks.some((existing) => existing.type === "code") && CODE_EXCLUDES.has(mark.type)) return [...marks];
  let next = marks.filter((existing) => existing.type !== mark.type);
  if (mark.type === "code") next = next.filter((existing) => !CODE_EXCLUDES.has(existing.type));
  if (mark.type === "subscript") next = next.filter((existing) => existing.type !== "superscript");
  if (mark.type === "superscript") next = next.filter((existing) => existing.type !== "subscript");
  next.push(mark);
  return next.sort((a, b) => (MARK_ORDER.get(a.type) ?? 0) - (MARK_ORDER.get(b.type) ?? 0));
}

function textNode(text: string, marks: readonly MarkJson[]): NodeJson {
  return marks.length > 0 ? { type: "text", text, marks: [...marks] } : { type: "text", text };
}

export function serializeStorage(node: XmlNode | string): string {
  if (typeof node === "string") return escapeXml(node);
  const inner = node.children.map(serializeStorage).join("");
  if (node.name === "#root") return inner;
  const attributes = Object.entries(node.attributes)
    .map(([name, value]) => ` ${name}="${escapeXml(value)}"`)
    .join("");
  return inner.length > 0
    ? `<${node.name}${attributes}>${inner}</${node.name}>`
    : `<${node.name}${attributes}/>`;
}

function truncateUtf8(text: string, bytes: number): string {
  const buffer = Buffer.from(text, "utf8");
  if (buffer.length <= bytes) return text;
  return buffer.subarray(0, bytes).toString("utf8").replace(/�$/, "");
}

const MACRO_DATA_HEADROOM = 4096;

export function storageReferences(root: XmlNode): {
  pages: PageReference[];
  attachments: AttachmentReference[];
  people: PersonReference[];
} {
  const pages: PageReference[] = [];
  const attachments: AttachmentReference[] = [];
  const people: PersonReference[] = [];
  const visit = (node: XmlNode | string, insideMacro: boolean, macroPage: XmlNode | null) => {
    if (typeof node === "string") return;
    const importer = isMacro(node.name) ? importerOf(node) : undefined;
    const macro = insideMacro || (isMacro(node.name) && !importer);
    const page = isMacro(node.name) ? macroPageOf(node) : macroPage;
    if (!macro && importer?.references) {
      const declared = importer.references(node);
      for (const sourceId of declared.pageIds ?? []) {
        if (/^\d{1,19}$/.test(sourceId)) pages.push({ title: null, spaceKey: null, sourceId });
      }
      for (const title of declared.pageTitles ?? []) pages.push({ title, spaceKey: null, sourceId: null });
      for (const file of declared.files ?? []) {
        attachments.push({ fileName: file.fileName, pageTitle: null, spaceKey: null });
      }
    }
    if (!macro) {
      if (node.name === "ri:page") {
        pages.push({
          title: node.attributes["ri:content-title"] ?? null,
          spaceKey: node.attributes["ri:space-key"] ?? null,
          sourceId: node.attributes["ri:content-id"] ?? null,
        });
      }
      if (node.name === "a" && node.attributes.href) {
        const sourceId = sourcePageId(node.attributes.href);
        if (sourceId) pages.push({ title: null, spaceKey: null, sourceId });
      }
      if (node.name === "ri:attachment" && node.attributes["ri:filename"]) {
        const target = firstChild(node, "ri:page") ?? page;
        attachments.push({
          fileName: node.attributes["ri:filename"],
          pageTitle: target?.attributes["ri:content-title"] ?? null,
          spaceKey: target?.attributes["ri:space-key"] ?? null,
        });
      }
      if (node.name === "ri:user") {
        people.push({
          accountId: node.attributes["ri:account-id"] ?? null,
          userKey: node.attributes["ri:userkey"] ?? null,
        });
      }
    }
    for (const child of node.children) visit(child, macro, page);
  };
  visit(root, false, null);
  return { pages, attachments, people };
}

function importerOf(node: XmlNode): MacroConverter | undefined {
  return modules.importer("confluence", macroName(node));
}

function macroPageOf(node: XmlNode): XmlNode | null {
  const parameter = childElements(node, "ac:parameter").find(
    (child) => child.attributes["ac:name"] === "page",
  );
  const link = parameter ? firstChild(parameter, "ac:link") : undefined;
  return (link ? firstChild(link, "ri:page") : undefined) ?? null;
}

function sourcePageId(href: string): string | null {
  for (const pattern of SOURCE_PAGE_PATTERNS) {
    const match = pattern.exec(href);
    if (match?.[1]) return match[1];
  }
  return null;
}

function isMacro(name: string): boolean {
  return (
    name === "ac:structured-macro" ||
    name === "ac:macro" ||
    name === "ac:adf-extension" ||
    name === "ac:adf-node"
  );
}

class Converter {
  macros = new Map<string, number>();
  converted = new Map<string, number>();
  notes: ConversionNote[] = [];
  tasks: ConvertedTask[] = [];
  numberHeadings = false;
  readonly context: MacroImportContext;
  readonly #diagrams = new Set<string>();

  constructor(private readonly lookup: StorageLookup) {
    this.context = {
      spaceKey: lookup.spaceKey ?? null,
      blocks: (content) => this.blocks(content as (XmlNode | string)[]),
      inline: (content) => {
        const items = this.items(content as (XmlNode | string)[], []);
        const inline = items.flatMap((item) => ("inline" in item ? [item.inline] : []));
        if (inline.length !== items.length) throw new Error("Block content in an inline position");
        return trimInline(inline);
      },
      attachment: (reference, page) => {
        const target = page ?? firstChild(reference as XmlNode, "ri:page") ?? null;
        return this.lookup.attachment({
          fileName: reference.attributes["ri:filename"] ?? "",
          pageTitle: target?.attributes["ri:content-title"] ?? null,
          spaceKey: target?.attributes["ri:space-key"] ?? null,
        });
      },
      file: (reference) =>
        this.lookup.attachment({ fileName: reference.fileName, pageTitle: null, spaceKey: null }),
      note: (note) => this.note(note),
      newId: () => this.lookup.newId(),
      diagramId: (name, pageSourceId) => {
        const id = this.lookup.diagramId?.(name, pageSourceId) ?? this.lookup.newId();
        if (pageSourceId !== null) return id;
        if (this.#diagrams.has(id)) return this.lookup.newId();
        this.#diagrams.add(id);
        return id;
      },
      page: (reference, options) => {
        const resolved = this.lookup.page({
          title: reference.attributes["ri:content-title"] ?? "",
          spaceKey: reference.attributes["ri:space-key"] ?? null,
          sourceId: reference.attributes["ri:content-id"] ?? null,
          ...(options?.formerTitles ? { formerTitles: true } : {}),
        });
        return resolved.kind === "page" ? resolved.pageId : null;
      },
      pageById: (sourceId) => {
        const resolved = this.lookup.page({ title: null, spaceKey: null, sourceId });
        return resolved.kind === "page" ? resolved.pageId : null;
      },
      space: (key) => this.lookup.spaceId?.(key) ?? null,
      template: (sourceId) => this.lookup.template?.(sourceId) ?? null,
      embeddable: (url) => this.lookup.embeddable?.(url) ?? false,
      numberHeadings: () => {
        this.numberHeadings = true;
      },
      text: (key) => this.lookup.text?.(key) ?? defaultImportTexts[key],
      jiraIssueUrl: (key) => this.lookup.jiraIssueUrl?.(key) ?? null,
    };
  }

  note(note: ConversionNote): void {
    this.notes.push(note);
  }

  items(nodes: readonly (XmlNode | string)[], marks: readonly MarkJson[], preformatted = false): Item[] {
    const result: Item[] = [];
    for (const node of nodes) result.push(...this.item(node, marks, preformatted));
    return result;
  }

  item(node: XmlNode | string, marks: readonly MarkJson[], preformatted: boolean): Item[] {
    if (typeof node === "string") {
      const text = preformatted ? node : node.replace(/[ \t\r\n]+/g, " ");
      return text.length > 0 ? [{ inline: textNode(text, marks) }] : [];
    }
    const name = node.name.toLowerCase();
    switch (name) {
      case "strong":
      case "b":
        return this.items(node.children, addMark(marks, { type: "bold" }), preformatted);
      case "em":
      case "i":
        return this.items(node.children, addMark(marks, { type: "italic" }), preformatted);
      case "u":
        return this.items(node.children, addMark(marks, { type: "underline" }), preformatted);
      case "s":
      case "del":
      case "strike":
        return this.items(node.children, addMark(marks, { type: "strike" }), preformatted);
      case "code":
        return this.items(node.children, addMark(marks, { type: "code" }), preformatted);
      case "sub":
        return this.items(node.children, addMark(marks, { type: "subscript" }), preformatted);
      case "sup":
        return this.items(node.children, addMark(marks, { type: "superscript" }), preformatted);
      case "span":
      case "font":
        return this.items(node.children, this.styleMarks(node, marks), preformatted);
      case "a":
        return this.anchor(node, marks, preformatted);
      case "br":
        return [{ inline: { type: "hardBreak" } }];
      case "time":
        return this.time(node, marks);
      case "ac:emoticon":
        return this.emoticon(node, marks);
      case "ac:link":
        return this.link(node, marks);
      case "ac:placeholder": {
        const text = textContent(node).replace(/\s+/g, " ").trim().slice(0, MAX_PLACEHOLDER_LENGTH);
        return this.lookup.templateVariables && text.length > 0
          ? [{ inline: { type: "placeholder", attrs: { text } } }]
          : [];
      }
      case "at:declarations":
        return [];
      case "at:var": {
        const field = this.lookup.templateVariables?.get(node.attributes["at:name"] ?? "");
        return field ? [{ inline: { type: "templateField", attrs: { field } } }] : [];
      }
      case "ac:inline-comment-marker": {
        const ref = (node.attributes["ac:ref"] ?? "").trim();
        const threadId = ref ? (this.lookup.inlineComment?.(ref) ?? null) : null;
        return this.items(
          node.children,
          threadId ? addMark(marks, { type: "inlineComment", attrs: { threadId } }) : marks,
          preformatted,
        );
      }
      case "ac:link-body":
      case "ac:plain-text-link-body":
        return this.items(node.children, marks, preformatted);
      case "ri:user":
        return this.mention(node);
      default: {
        const inline = isMacro(name) ? this.inlineMacro(node) : null;
        if (inline) return inline.map((converted) => ({ inline: converted }));
        if (BLOCK_ELEMENTS.has(name)) return this.block(node).map((block) => ({ block }));
        return this.items(node.children, marks, preformatted);
      }
    }
  }

  styleMarks(node: XmlNode, marks: readonly MarkJson[]): MarkJson[] {
    const style = styleOf(node);
    let next = [...marks];
    const color = paletteColor(style.get("color") ?? node.attributes.color);
    if (color) next = addMark(next, { type: "textColor", attrs: { color } });
    const background = paletteColor(style.get("background-color"));
    if (background) next = addMark(next, { type: "highlight", attrs: { color: background } });
    const decoration = style.get("text-decoration") ?? "";
    if (decoration.includes("underline")) next = addMark(next, { type: "underline" });
    if (decoration.includes("line-through")) next = addMark(next, { type: "strike" });
    const weight = style.get("font-weight");
    if (weight === "bold" || Number(weight) >= 600) next = addMark(next, { type: "bold" });
    if (style.get("font-style") === "italic") next = addMark(next, { type: "italic" });
    return next;
  }

  anchor(node: XmlNode, marks: readonly MarkJson[], preformatted: boolean): Item[] {
    const href = (node.attributes.href ?? "").trim();
    const sourceId = href ? sourcePageId(href) : null;
    if (sourceId) {
      const page = this.lookup.page({ title: null, spaceKey: null, sourceId });
      if (page.kind === "page") {
        return this.items(
          node.children,
          addMark(marks, { type: "link", attrs: { href: page.path } }),
          preformatted,
        );
      }
      this.note({ code: "externalPageLink", title: textContent(node).trim().slice(0, 255), spaceKey: null });
    }
    if (href && isAllowedHref(href)) {
      return this.items(node.children, addMark(marks, { type: "link", attrs: { href } }), preformatted);
    }
    if (href && !href.startsWith("#")) this.note({ code: "invalidLink" });
    return this.items(node.children, marks, preformatted);
  }

  time(node: XmlNode, marks: readonly MarkJson[]): Item[] {
    const value = (node.attributes.datetime ?? "").slice(0, 10);
    if (isIsoDate(value)) return [{ inline: { type: "date", attrs: { date: value } } }];
    return this.items(node.children, marks);
  }

  emoticon(node: XmlNode, marks: readonly MarkJson[]): Item[] {
    const candidates = [node.attributes["ac:emoji-fallback"], EMOTICONS[node.attributes["ac:name"] ?? ""]];
    for (const candidate of candidates) {
      if (candidate && EMOJI.test(candidate))
        return [{ inline: { type: "emoji", attrs: { emoji: candidate } } }];
    }
    const text = node.attributes["ac:emoji-shortname"] ?? node.attributes["ac:emoji-fallback"];
    return text ? [{ inline: textNode(text, marks) }] : [];
  }

  mention(node: XmlNode): Item[] {
    const id = this.lookup.person({
      accountId: node.attributes["ri:account-id"] ?? null,
      userKey: node.attributes["ri:userkey"] ?? null,
    });
    if (!id) {
      this.note({ code: "unresolvedPerson" });
      return [];
    }
    return [{ inline: { type: "mention", attrs: { id } } }];
  }

  link(node: XmlNode, marks: readonly MarkJson[]): Item[] {
    const body = firstChild(node, "ac:link-body") ?? firstChild(node, "ac:plain-text-link-body");
    const bodyItems = body ? this.items(body.children, marks) : [];
    const bodyText = body ? textContent(body).trim() : "";
    const withLink = (href: string, fallback: string): Item[] => {
      const linked = addMark(marks, { type: "link", attrs: { href } });
      if (body && bodyText.length > 0) return this.items(body.children, linked);
      return fallback ? [{ inline: textNode(fallback, linked) }] : [];
    };
    const plain = (fallback: string): Item[] => {
      if (body && bodyText.length > 0) return bodyItems;
      return fallback ? [{ inline: textNode(fallback, marks) }] : [];
    };
    const page = firstChild(node, "ri:page");
    if (page) {
      const title = page.attributes["ri:content-title"] ?? "";
      const spaceKey = page.attributes["ri:space-key"] ?? null;
      const resolved = this.lookup.page({
        title,
        spaceKey,
        sourceId: page.attributes["ri:content-id"] ?? null,
      });
      if (resolved.kind === "page") {
        if (!body || bodyText.length === 0 || bodyText === title) {
          return [{ inline: { type: "pageLink", attrs: { pageId: resolved.pageId } } }];
        }
        return withLink(resolved.path, title);
      }
      this.note({ code: "externalPageLink", title, spaceKey });
      return resolved.href && isAllowedHref(resolved.href) ? withLink(resolved.href, title) : plain(title);
    }
    const attachment = firstChild(node, "ri:attachment");
    if (attachment) {
      const fileName = attachment.attributes["ri:filename"] ?? "";
      const target = firstChild(attachment, "ri:page");
      const found = this.lookup.attachment({
        fileName,
        pageTitle: target?.attributes["ri:content-title"] ?? null,
        spaceKey: target?.attributes["ri:space-key"] ?? null,
      });
      if (found) return withLink(`/api/v1/attachments/${found.attachmentId}/content`, found.name);
      this.note({ code: "missingAttachment", fileName });
      return plain(fileName);
    }
    const user = firstChild(node, "ri:user");
    if (user) return this.mention(user);
    const url = firstChild(node, "ri:url");
    if (url) {
      const href = url.attributes["ri:value"] ?? "";
      if (isAllowedHref(href)) return withLink(href, href);
      this.note({ code: "invalidLink" });
      return plain(href);
    }
    const space = firstChild(node, "ri:space");
    if (space) {
      const key = space.attributes["ri:space-key"] ?? "";
      const path = this.lookup.space(key);
      if (path) return withLink(path, key);
      this.note({ code: "unsupportedLink", kind: "space" });
      return plain(key);
    }
    const kind =
      childElements(node)
        .find((child) => child.name.startsWith("ri:"))
        ?.name.slice(3) ?? "unknown";
    this.note({ code: "unsupportedLink", kind });
    return plain("");
  }

  paragraphs(items: readonly Item[], make: (content: NodeJson[]) => NodeJson, keepEmpty = false): NodeJson[] {
    const blocks: NodeJson[] = [];
    let run: NodeJson[] = [];
    let any = false;
    const flush = (force: boolean) => {
      const content = trimInline(run);
      run = [];
      if (content.length > 0 || (force && !any)) {
        blocks.push(make(content));
        any = true;
      }
    };
    for (const item of items) {
      if ("inline" in item) run.push(item.inline);
      else {
        flush(false);
        blocks.push(item.block);
        any = true;
      }
    }
    flush(keepEmpty);
    return blocks;
  }

  blocks(nodes: readonly (XmlNode | string)[]): NodeJson[] {
    return this.paragraphs(this.items(nodes, []), (content) => paragraph(content));
  }

  blockContent(nodes: readonly (XmlNode | string)[]): NodeJson[] {
    const blocks = this.blocks(nodes);
    return blocks.length > 0 ? blocks : [paragraph([])];
  }

  block(node: XmlNode): NodeJson[] {
    const name = node.name.toLowerCase();
    switch (name) {
      case "p":
        return this.paragraphs(this.items(node.children, []), (content) => paragraph(content, node), true);
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6":
        return this.paragraphs(
          this.items(node.children, []),
          (content) => ({ type: "heading", attrs: { level: Number(name[1]), ...alignment(node) }, content }),
          true,
        );
      case "ul":
      case "ol":
        return this.list(node, name === "ol");
      case "ac:task-list":
        return this.taskList(node);
      case "table":
        return this.table(node);
      case "pre":
        return [codeBlock(textContent(node))];
      case "blockquote":
        return [{ type: "blockquote", content: this.blockContent(node.children) }];
      case "hr":
        return [{ type: "horizontalRule" }];
      case "ac:image":
      case "img":
        return this.image(node);
      case "ac:layout":
      case "ac:layout-cell":
      case "div":
      case "section":
      case "article":
        return this.blocks(node.children);
      case "ac:layout-section":
        return this.layoutSection(node);
      default:
        if (isMacro(name)) return this.macro(node);
        return this.blocks(node.children);
    }
  }

  list(node: XmlNode, ordered: boolean): NodeJson[] {
    const items: NodeJson[] = [];
    const loose: (XmlNode | string)[] = [];
    for (const child of node.children) {
      if (element(child) && child.name.toLowerCase() === "li") {
        items.push({ type: "listItem", content: leadingParagraph(this.blocks(child.children)) });
      } else if (element(child)) loose.push(child);
    }
    const extra = this.blocks(loose);
    if (items.length === 0) return extra;
    const start = Number.parseInt(node.attributes.start ?? "1", 10);
    const attrs =
      ordered && Number.isInteger(start) && start > 1 && start <= 1_000_000_000 ? { start } : undefined;
    return [
      { type: ordered ? "orderedList" : "bulletList", ...(attrs ? { attrs } : {}), content: items },
      ...extra,
    ];
  }

  taskList(node: XmlNode): NodeJson[] {
    const items: NodeJson[] = [];
    for (const task of childElements(node, "ac:task")) {
      const status = textContent(firstChild(task, "ac:task-status") ?? "").trim();
      const body = firstChild(task, "ac:task-body");
      const id = this.lookup.newId();
      this.tasks.push({ id, done: status === "complete" });
      const content = leadingParagraph(body ? this.blocks(body.children) : []);
      const found = (type: string, attribute: string): string | null => {
        const walk = (nodes: readonly NodeJson[]): string | null => {
          for (const candidate of nodes) {
            const value = candidate.type === type ? candidate.attrs?.[attribute] : undefined;
            if (typeof value === "string") return value;
            const nested = walk(candidate.content ?? []);
            if (nested) return nested;
          }
          return null;
        };
        return walk(content);
      };
      items.push({
        type: "taskItem",
        attrs: { id, assignee: found("mention", "id"), dueDate: found("date", "date") },
        content,
      });
    }
    return items.length > 0 ? [{ type: "taskList", content: items }] : [];
  }

  table(node: XmlNode): NodeJson[] {
    const widths = childElements(node, "colgroup").flatMap((group) =>
      childElements(group, "col").map((col) => pixels(styleOf(col).get("width") ?? col.attributes.width)),
    );
    const rows: XmlNode[] = [];
    for (const child of childElements(node)) {
      const name = child.name.toLowerCase();
      if (name === "tr") rows.push(child);
      if (name === "thead" || name === "tbody" || name === "tfoot") rows.push(...childElements(child, "tr"));
    }
    const occupied: number[] = [];
    const result: NodeJson[] = [];
    for (const row of rows) {
      const cells: NodeJson[] = [];
      let column = 0;
      for (const cell of childElements(row)) {
        const name = cell.name.toLowerCase();
        if (name !== "td" && name !== "th") continue;
        while ((occupied[column] ?? 0) > 0) column += 1;
        const colspan = clampSpan(cell.attributes.colspan);
        const rowspan = clampSpan(cell.attributes.rowspan);
        const spanned = widths.slice(column, column + colspan);
        const colwidth =
          spanned.length === colspan && spanned.every((width) => width !== null)
            ? (spanned as number[])
            : null;
        for (let index = column; index < column + colspan; index += 1) occupied[index] = rowspan;
        column += colspan;
        const background = paletteColor(
          cell.attributes["data-highlight-colour"] ?? styleOf(cell).get("background-color"),
        );
        cells.push({
          type: name === "th" ? "tableHeader" : "tableCell",
          attrs: { colspan, rowspan, colwidth, background },
          content: this.blockContent(cell.children),
        });
      }
      for (let index = 0; index < occupied.length; index += 1) {
        occupied[index] = Math.max(0, (occupied[index] ?? 0) - 1);
      }
      result.push({ type: "tableRow", content: cells });
    }
    if (result.length === 0) return [];
    return [{ type: "table", content: result }];
  }

  image(node: XmlNode): NodeJson[] {
    const attachment = firstChild(node, "ri:attachment");
    const caption = firstChild(node, "ac:caption");
    const captionBlocks = caption ? this.blocks(caption.children) : [];
    const alt = (node.attributes["ac:alt"] ?? node.attributes.alt ?? "").slice(0, 1000);
    if (attachment) {
      const fileName = attachment.attributes["ri:filename"] ?? "";
      const target = firstChild(attachment, "ri:page");
      const found = this.lookup.attachment({
        fileName,
        pageTitle: target?.attributes["ri:content-title"] ?? null,
        spaceKey: target?.attributes["ri:space-key"] ?? null,
      });
      if (!found) {
        this.note({ code: "missingAttachment", fileName });
        return [macroBlock("missing-attachment", { fileName: fileName.slice(0, 1000) }), ...captionBlocks];
      }
      const width = pixels(node.attributes["ac:width"] ?? node.attributes["ac:custom-width"]);
      const align = node.attributes["ac:align"];
      return [
        {
          type: "image",
          attrs: {
            attachmentId: found.attachmentId,
            alt,
            width: width !== null && width <= 10_000 ? width : null,
            align: align === "left" || align === "right" ? align : "center",
          },
        },
        ...captionBlocks,
      ];
    }
    const url = firstChild(node, "ri:url")?.attributes["ri:value"] ?? node.attributes.src ?? "";
    this.note({ code: "externalImage" });
    if (isAllowedHref(url)) {
      return [paragraph([textNode(alt || url, [{ type: "link", attrs: { href: url } }])]), ...captionBlocks];
    }
    return captionBlocks;
  }

  layoutSection(node: XmlNode): NodeJson[] {
    const cells = childElements(node, "ac:layout-cell");
    const widths = LAYOUT_WIDTHS[node.attributes["ac:type"] ?? ""];
    if (!widths || widths.length !== cells.length) return cells.flatMap((cell) => this.blocks(cell.children));
    return [
      {
        type: "columns",
        content: cells.map((cell, index) => ({
          type: "column",
          attrs: { width: widths[index] },
          content: this.blockContent(cell.children),
        })),
      },
    ];
  }

  inlineMacro(node: XmlNode): NodeJson[] | null {
    const importer = importerOf(node);
    if (!importer?.inline) return null;
    const converted = this.convertMacro(importer, node);
    if (!converted) return null;
    count(this.converted, macroName(node));
    return converted;
  }

  macro(node: XmlNode): NodeJson[] {
    const importer = importerOf(node);
    const converted = importer ? this.convertMacro(importer, node) : null;
    if (converted) {
      count(this.converted, macroName(node));
      return importer?.inline ? [paragraph(converted)] : converted;
    }
    return [this.unsupportedMacro(node)];
  }

  convertMacro(importer: MacroConverter, node: XmlNode): NodeJson[] | null {
    const saved = {
      macros: new Map(this.macros),
      converted: new Map(this.converted),
      notes: [...this.notes],
      tasks: [...this.tasks],
      numberHeadings: this.numberHeadings,
    };
    let result: NodeJson[] | null = null;
    try {
      result = importer.convert(node, this.context);
    } catch {
      result = null;
    }
    const valid =
      result !== null &&
      result.length > 0 &&
      (importer.inline
        ? validateDocument({ type: "doc", content: [paragraph(result)] }).ok
        : result.every(blockIsValid));
    if (valid) return result;
    this.macros = saved.macros;
    this.converted = saved.converted;
    this.notes = saved.notes;
    this.tasks = saved.tasks;
    this.numberHeadings = saved.numberHeadings;
    return null;
  }

  unsupportedMacro(node: XmlNode): NodeJson {
    const name = macroName(node);
    count(this.macros, name);
    const parameters: Record<string, string> = {};
    for (const parameter of childElements(node, "ac:parameter")) {
      const key = parameter.attributes["ac:name"] ?? "";
      parameters[key] =
        childElements(parameter).length > 0
          ? serializeStorage({ ...parameter, name: "#root" })
          : textContent(parameter);
    }
    const rich = firstChild(node, "ac:rich-text-body");
    const plain = firstChild(node, "ac:plain-text-body");
    const data: Record<string, unknown> =
      node.name === "ac:adf-extension" || node.name === "ac:adf-node"
        ? { storage: serializeStorage(node) }
        : { attributes: { ...node.attributes } };
    if (Object.keys(parameters).length > 0) data.parameters = parameters;
    if (rich) {
      data.body = serializeStorage({ ...rich, name: "#root" });
      data.bodyKind = "rich";
    }
    if (plain) {
      data.body = textContent(plain);
      data.bodyKind = "plain";
    }
    return this.fitMacro(name, data);
  }

  fitMacro(name: string, data: Record<string, unknown>): NodeJson {
    const limit = MAX_MACRO_DATA_BYTES - MACRO_DATA_HEADROOM;
    if (Buffer.byteLength(JSON.stringify(data), "utf8") <= limit) return macroBlock(name, data);
    this.note({ code: "macroDataTruncated", macro: name });
    const original =
      typeof data.storage === "string" ? data.storage : typeof data.body === "string" ? data.body : "";
    const reduced: Record<string, unknown> = { truncated: true, storage: truncateUtf8(original, limit / 2) };
    if (data.attributes) reduced.attributes = data.attributes;
    if (data.parameters && Buffer.byteLength(JSON.stringify(data.parameters), "utf8") < limit / 4) {
      reduced.parameters = data.parameters;
    }
    return macroBlock(name, reduced);
  }

  fallback(node: XmlNode | string, element: string): NodeJson {
    this.note({ code: "invalidContent", element });
    return this.fitMacro(CONTENT_FALLBACK_MACRO, { storage: serializeStorage(node) });
  }
}

function macroName(node: XmlNode): string {
  if (node.name === "ac:adf-extension") {
    const inner = firstChild(node, "ac:adf-node");
    const app = inner ? forgeApp(inner) : null;
    if (app) return `app:${app}`.slice(0, 200);
    return `adf:${inner?.attributes.type ?? "extension"}`.slice(0, 200);
  }
  if (node.name === "ac:adf-node") return `adf:${node.attributes.type ?? "node"}`.slice(0, 200);
  const name = (node.attributes["ac:name"] ?? "").trim();
  return (name.length > 0 ? name : "unknown").slice(0, 200);
}

function forgeApp(node: XmlNode): string | null {
  const attribute = (key: string) =>
    childElements(node, "ac:adf-attribute").find((child) => child.attributes.key === key);
  const type = attribute("extension-type");
  const key = attribute("extension-key");
  if (!type || !key || textContent(type).trim() !== FORGE_EXTENSION_TYPE) return null;
  const app = textContent(key).trim().split("/").at(-1)?.trim() ?? "";
  return app.length > 0 ? app : null;
}

function count(counts: Map<string, number>, name: string): void {
  counts.set(name, (counts.get(name) ?? 0) + 1);
}

function macroBlock(name: string, data: Record<string, unknown>): NodeJson {
  return { type: "unsupportedMacro", attrs: { name, data } };
}

function clampSpan(value: string | undefined): number {
  const number = Number.parseInt(value ?? "1", 10);
  return Number.isInteger(number) && number >= 1 ? Math.min(number, 1000) : 1;
}

function alignment(node: XmlNode): Record<string, unknown> {
  const style = styleOf(node);
  const attrs: Record<string, unknown> = {};
  const align = style.get("text-align");
  if (align === "center" || align === "right" || align === "justify") attrs.textAlign = align;
  const margin = pixels(style.get("margin-left"));
  if (margin !== null && margin >= 15) attrs.indent = Math.min(8, Math.round(margin / 30));
  return attrs;
}

function paragraph(content: NodeJson[], source?: XmlNode): NodeJson {
  const attrs = source ? alignment(source) : {};
  return {
    type: "paragraph",
    ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
    ...(content.length > 0 ? { content } : {}),
  };
}

function codeBlock(text: string): NodeJson {
  const content = text.replace(/\r\n?/g, "\n");
  return content.length > 0
    ? { type: "codeBlock", content: [{ type: "text", text: content }] }
    : { type: "codeBlock" };
}

function leadingParagraph(blocks: NodeJson[]): NodeJson[] {
  if (blocks[0]?.type === "paragraph") return blocks;
  return [paragraph([]), ...blocks];
}

function trimInline(nodes: NodeJson[]): NodeJson[] {
  const result = nodes.map((node) => ({ ...node }));
  while (result.length > 0) {
    const first = result[0];
    if (first?.type !== "text") break;
    const text = (first.text ?? "").replace(/^[  ]+/, "");
    if (text.length > 0) {
      first.text = text;
      break;
    }
    result.shift();
  }
  while (result.length > 0) {
    const last = result.at(-1);
    if (last?.type !== "text") break;
    const text = (last.text ?? "").replace(/[  ]+$/, "");
    if (text.length > 0) {
      last.text = text;
      break;
    }
    result.pop();
  }
  if (result.every((node) => node.type === "hardBreak")) return [];
  return result;
}

function blockIsValid(block: NodeJson): boolean {
  return validBlock(block) !== null;
}

function validBlock(block: NodeJson): NodeJson | null {
  const validated = validateDocument({ type: "doc", content: [block] });
  return validated.ok ? (validated.document.content?.[0] ?? null) : null;
}

function countNodes(node: NodeJson): number {
  return 1 + (node.content ?? []).reduce((sum, child) => sum + countNodes(child), 0);
}

export async function parseStorage(xhtml: string, limits: XmlLimits = DEFAULT_XML_LIMITS): Promise<XmlNode> {
  return parseXmlFragment(xhtml, limits);
}

export function convertStorage(root: XmlNode, lookup: StorageLookup): ConvertedPage {
  const converter = new Converter(lookup);
  const blocks: NodeJson[] = [];
  let bytes = 0;
  let nodes = 1;
  let truncated = false;
  const groups: (XmlNode | string)[][] = [];
  let inlineRun: (XmlNode | string)[] = [];
  for (const child of root.children) {
    if (element(child) && BLOCK_ELEMENTS.has(child.name.toLowerCase())) {
      if (inlineRun.length > 0) groups.push(inlineRun);
      inlineRun = [];
      groups.push([child]);
    } else inlineRun.push(child);
  }
  if (inlineRun.length > 0) groups.push(inlineRun);
  const tasks: ConvertedTask[] = [];
  for (const group of groups) {
    converter.tasks = [];
    let converted: NodeJson[];
    try {
      converted = converter.blocks(group);
    } catch {
      converted = [
        converter.fallback({ name: "#root", attributes: {}, children: group }, elementName(group)),
      ];
    }
    const accepted: NodeJson[] = [];
    let failed = false;
    for (const block of converted) {
      const valid = validBlock(block);
      if (valid) accepted.push(valid);
      else failed = true;
    }
    const result = failed
      ? [converter.fallback({ name: "#root", attributes: {}, children: group }, elementName(group))]
      : accepted;
    if (!failed) tasks.push(...converter.tasks);
    for (const block of result) {
      const size = Buffer.byteLength(JSON.stringify(block), "utf8");
      const count = countNodes(block);
      if (truncated || bytes + size > MAX_DOCUMENT_BYTES - 64 * 1024 || nodes + count > MAX_NODES - 10) {
        truncated = true;
        continue;
      }
      bytes += size;
      nodes += count;
      blocks.push(block);
    }
  }
  if (truncated) {
    converter.note({ code: "contentTruncated" });
    blocks.push(macroBlock(CONTENT_FALLBACK_MACRO, { truncated: true }));
  }
  const document: DocumentJson = { type: "doc", content: blocks.length > 0 ? blocks : [paragraph([])] };
  const validated = validateDocument(document);
  if (!validated.ok) {
    converter.note({ code: "invalidContent", element: "document" });
    return {
      document: { type: "doc", content: [macroBlock(CONTENT_FALLBACK_MACRO, { truncated: true })] },
      macros: converter.macros,
      converted: converter.converted,
      notes: converter.notes,
      tasks: [],
      numberHeadings: converter.numberHeadings,
    };
  }
  const kept = new Set(collectTaskIds(validated.document));
  return {
    document: validated.document,
    macros: converter.macros,
    converted: converter.converted,
    notes: converter.notes,
    tasks: tasks.filter((task) => kept.has(task.id)),
    numberHeadings: converter.numberHeadings,
  };
}

function collectTaskIds(node: NodeJson): string[] {
  const own = node.type === "taskItem" && typeof node.attrs?.id === "string" ? [node.attrs.id] : [];
  return [...own, ...(node.content ?? []).flatMap(collectTaskIds)];
}

function elementName(group: readonly (XmlNode | string)[]): string {
  const first = group.find(element);
  return (first?.name ?? "text").slice(0, 100);
}
