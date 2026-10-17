import { load } from "js-yaml";
import MarkdownIt, { type MarkdownIt as Markdown, type StateInline, type Token } from "markdown-it";
import {
  attachmentImage,
  attachmentLink,
  codeMacro,
  diagramMacro,
  element,
  includeMacro,
  pageLink,
  propertiesMacro,
  taskList,
  text,
  urlImage,
} from "../storage-writer.js";

export interface PageTarget {
  readonly sourceId: string;
  readonly title: string;
}

export interface MarkdownLookup {
  page(target: string, wiki: boolean): PageTarget | null;
  file(target: string, wiki: boolean): string | null;
  problem(code: "unsupportedMarkdown" | "unresolvedFileLink", details: Record<string, string>): void;
}

export interface FrontMatter {
  readonly title: string | null;
  readonly labels: readonly string[];
  readonly created: string | null;
  readonly modified: string | null;
  readonly properties: readonly (readonly [string, string])[];
}

export interface ConvertedMarkdown {
  readonly frontMatter: FrontMatter;
  readonly heading: string | null;
  readonly body: string;
}

const MAX_FRONT_MATTER = 64 * 1024;
const MAX_PROPERTIES = 50;
const MAX_LABELS = 100;
const TITLE_KEYS = ["title"];
const LABEL_KEYS = ["tags", "labels", "keywords", "categories"];
const CREATED_KEYS = ["date", "created", "created_at", "createdAt"];
const MODIFIED_KEYS = ["updated", "modified", "lastmod", "last_modified", "updated_at", "updatedAt"];
const IGNORED_KEYS = new Set([
  "aliases",
  "cssclass",
  "cssclasses",
  "draft",
  "layout",
  "permalink",
  "slug",
  "weight",
]);
const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "bmp",
  "avif",
  "ico",
  "tif",
  "tiff",
]);
const EMPTY_FRONT_MATTER: FrontMatter = {
  title: null,
  labels: [],
  created: null,
  modified: null,
  properties: [],
};

function isoDate(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function scalar(value: unknown): string | null {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  return null;
}

function labelsOf(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\s]+/) : [];
  return values
    .map((entry) => (typeof entry === "string" || typeof entry === "number" ? String(entry) : ""))
    .map((entry) => entry.trim().replace(/^#/, ""))
    .filter((entry) => entry.length > 0)
    .slice(0, MAX_LABELS);
}

export function splitFrontMatter(source: string): { yaml: string | null; content: string } {
  const normalized = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (!normalized.startsWith("---\n")) return { yaml: null, content: normalized };
  const end = /\n(---|\.\.\.)[ \t]*(\n|$)/.exec(normalized.slice(3));
  if (!end) return { yaml: null, content: normalized };
  const yaml = normalized.slice(4, 3 + end.index + 1);
  return { yaml, content: normalized.slice(3 + end.index + end[0].length) };
}

export function parseFrontMatter(yaml: string | null, problem: MarkdownLookup["problem"]): FrontMatter {
  if (yaml === null || yaml.trim().length === 0) return EMPTY_FRONT_MATTER;
  if (yaml.length > MAX_FRONT_MATTER) {
    problem("unsupportedMarkdown", { construct: "frontMatter" });
    return EMPTY_FRONT_MATTER;
  }
  let data: unknown;
  try {
    data = load(yaml, { json: true });
  } catch {
    problem("unsupportedMarkdown", { construct: "frontMatter" });
    return EMPTY_FRONT_MATTER;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return EMPTY_FRONT_MATTER;
  const record = data as Record<string, unknown>;
  const first = (keys: readonly string[]) =>
    keys.map((key) => record[key]).find((value) => value !== undefined);
  const title = scalar(first(TITLE_KEYS));
  const labels = LABEL_KEYS.flatMap((key) => labelsOf(record[key]));
  const properties: [string, string][] = [];
  const used = new Set([...TITLE_KEYS, ...LABEL_KEYS, ...CREATED_KEYS, ...MODIFIED_KEYS]);
  for (const [key, value] of Object.entries(record)) {
    if (used.has(key) || IGNORED_KEYS.has(key) || properties.length >= MAX_PROPERTIES) continue;
    const single = scalar(value);
    const joined =
      single ??
      (Array.isArray(value) && value.every((entry) => scalar(entry) !== null)
        ? value.map((entry) => scalar(entry)).join(", ")
        : null);
    if (joined === null) {
      problem("unsupportedMarkdown", { construct: "frontMatterValue", name: key.slice(0, 100) });
      continue;
    }
    if (joined.length > 0) properties.push([key.slice(0, 100), joined.slice(0, 2000)]);
  }
  return {
    title: title && title.length > 0 ? title : null,
    labels: [...new Set(labels)],
    created: isoDate(first(CREATED_KEYS)),
    modified: isoDate(first(MODIFIED_KEYS)),
    properties,
  };
}

function wikiLinks(md: Markdown): void {
  md.inline.ruler.before("link", "wikilink", (state: StateInline, silent: boolean) => {
    const source = state.src;
    const start = state.pos;
    const embed = source.charCodeAt(start) === 0x21;
    const open = embed ? start + 1 : start;
    if (source.charCodeAt(open) !== 0x5b || source.charCodeAt(open + 1) !== 0x5b) return false;
    const close = source.indexOf("]]", open + 2);
    if (close < 0) return false;
    const inner = source.slice(open + 2, close);
    if (inner.trim().length === 0 || inner.length > 500 || /[\n[\]]/.test(inner)) return false;
    if (!silent) {
      const token = state.push("wikilink", "", 0);
      token.meta = { target: inner, embed };
    }
    state.pos = close + 2;
    return true;
  });
}

function parser(): Markdown {
  const md = new MarkdownIt("default", { html: true, linkify: true, typographer: false });
  md.use(wikiLinks);
  return md;
}

const MARKDOWN = parser();

function extension(name: string): string {
  const base = name.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function isExternal(href: string): boolean {
  return /^(https?:|mailto:)/i.test(href);
}

interface WikiTarget {
  readonly target: string;
  readonly alias: string | null;
}

function parseWiki(raw: string): WikiTarget {
  const [link = "", alias] = raw.split("|");
  const target = link.replace(/#.*$/, "").replace(/\^.*$/, "").trim();
  return { target, alias: alias?.trim() || null };
}

class Renderer {
  constructor(private readonly lookup: MarkdownLookup) {}

  inline(tokens: readonly Token[]): string {
    let output = "";
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index] as Token;
      switch (token.type) {
        case "text":
          output += text(token.content);
          break;
        case "softbreak":
          output += " ";
          break;
        case "hardbreak":
          output += "<br/>";
          break;
        case "code_inline":
          output += `<code>${text(token.content)}</code>`;
          break;
        case "strong_open":
          output += "<strong>";
          break;
        case "strong_close":
          output += "</strong>";
          break;
        case "em_open":
          output += "<em>";
          break;
        case "em_close":
          output += "</em>";
          break;
        case "s_open":
          output += "<s>";
          break;
        case "s_close":
          output += "</s>";
          break;
        case "link_open": {
          const close = this.#closing(tokens, index);
          const body = this.inline(tokens.slice(index + 1, close));
          output += this.#link(String(token.attrGet("href") ?? ""), body);
          index = close;
          break;
        }
        case "image":
          output += this.#image(String(token.attrGet("src") ?? ""), token.content);
          break;
        case "wikilink":
          output += this.#wiki(token.meta as { target: string; embed: boolean });
          break;
        case "html_inline":
          this.lookup.problem("unsupportedMarkdown", { construct: "html" });
          output += text(token.content);
          break;
        default:
          if (token.children) output += this.inline(token.children);
          else if (token.content) output += text(token.content);
      }
    }
    return output;
  }

  #closing(tokens: readonly Token[], open: number): number {
    let depth = 0;
    for (let index = open; index < tokens.length; index += 1) {
      const type = tokens[index]?.type;
      if (type === "link_open") depth += 1;
      if (type === "link_close") depth -= 1;
      if (depth === 0) return index;
    }
    return tokens.length;
  }

  #link(href: string, body: string): string {
    const fallback = body || text(href);
    if (isExternal(href)) return element("a", { href }, fallback);
    if (href.startsWith("#") || href.length === 0) return fallback;
    const page = this.lookup.page(href, false);
    if (page) return pageLink(page.sourceId, page.title, body || null);
    const file = this.lookup.file(href, false);
    if (file) return attachmentLink(file, body || null);
    this.lookup.problem("unresolvedFileLink", { target: href.slice(0, 500) });
    return fallback;
  }

  #image(src: string, alt: string): string {
    if (/^https?:/i.test(src)) return urlImage(src, alt);
    const file = this.lookup.file(src, false);
    if (file) return attachmentImage(file, alt);
    this.lookup.problem("unresolvedFileLink", { target: src.slice(0, 500) });
    return text(alt);
  }

  #wiki(meta: { target: string; embed: boolean }): string {
    const { target, alias } = parseWiki(meta.target);
    const label = text(alias ?? target);
    if (target.length === 0) return label;
    const kind = extension(target);
    if (kind && kind !== "md" && kind !== "markdown") {
      const file = this.lookup.file(target, true);
      if (!file) {
        this.lookup.problem("unresolvedFileLink", { target: target.slice(0, 500) });
        return label;
      }
      if (meta.embed && IMAGE_EXTENSIONS.has(kind)) return attachmentImage(file, alias);
      return attachmentLink(file, alias ? label : null);
    }
    const page = this.lookup.page(target, true);
    if (!page) {
      this.lookup.problem("unresolvedFileLink", { target: target.slice(0, 500) });
      return label;
    }
    if (meta.embed) this.lookup.problem("unsupportedMarkdown", { construct: "noteEmbed" });
    return pageLink(page.sourceId, page.title, alias ? label : null);
  }

  embeddedNote(tokens: readonly Token[]): string | null {
    const content = tokens.filter((token) => !(token.type === "text" && token.content.trim() === ""));
    const [only] = content;
    if (content.length !== 1 || only?.type !== "wikilink") return null;
    const meta = only.meta as { target: string; embed: boolean };
    if (!meta.embed) return null;
    const { target } = parseWiki(meta.target);
    const kind = extension(target);
    if (kind && kind !== "md" && kind !== "markdown") return null;
    const page = this.lookup.page(target, true);
    return page ? includeMacro(page.sourceId, page.title) : null;
  }
}

function taskOf(inline: Token | undefined): { done: boolean } | null {
  const first = inline?.children?.[0];
  if (first?.type !== "text") return null;
  const match = /^\[([ xX])\]\s+/.exec(first.content);
  if (!match) return null;
  first.content = first.content.slice(match[0].length);
  return { done: match[1] !== " " };
}

function blocks(tokens: readonly Token[], renderer: Renderer, lookup: MarkdownLookup): string {
  let output = "";
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as Token;
    const close = (open: number) => {
      let depth = 0;
      for (let at = open; at < tokens.length; at += 1) {
        depth += tokens[at]?.nesting ?? 0;
        if (depth === 0) return at;
      }
      return tokens.length - 1;
    };
    switch (token.type) {
      case "heading_open": {
        const inline = tokens[index + 1];
        output += `<${token.tag}>${renderer.inline(inline?.children ?? [])}</${token.tag}>`;
        index += 2;
        break;
      }
      case "paragraph_open": {
        const inline = tokens[index + 1];
        const children = inline?.children ?? [];
        const include = renderer.embeddedNote(children);
        const content = include ?? renderer.inline(children);
        output += include ?? (token.hidden ? content : `<p>${content}</p>`);
        index += 2;
        break;
      }
      case "bullet_list_open":
      case "ordered_list_open": {
        const end = close(index);
        output += list(tokens.slice(index, end + 1), renderer, lookup);
        index = end;
        break;
      }
      case "blockquote_open": {
        const end = close(index);
        output += `<blockquote>${blocks(tokens.slice(index + 1, end), renderer, lookup)}</blockquote>`;
        index = end;
        break;
      }
      case "table_open": {
        const end = close(index);
        output += table(tokens.slice(index + 1, end), renderer);
        index = end;
        break;
      }
      case "fence":
      case "code_block": {
        const language = token.info.trim().split(/\s+/)[0]?.toLowerCase() || null;
        const code = token.content.replace(/\n$/, "");
        output += language === "mermaid" ? diagramMacro("mermaid", code) : codeMacro(code, language);
        break;
      }
      case "hr":
        output += "<hr/>";
        break;
      case "html_block":
        lookup.problem("unsupportedMarkdown", { construct: "html" });
        output += `<p>${text(token.content.trim())}</p>`;
        break;
      default:
        break;
    }
  }
  return output;
}

function list(tokens: readonly Token[], renderer: Renderer, lookup: MarkdownLookup): string {
  const open = tokens[0] as Token;
  const items: { task: { done: boolean } | null; body: string }[] = [];
  let depth = 0;
  let start = -1;
  for (let index = 1; index < tokens.length - 1; index += 1) {
    const token = tokens[index] as Token;
    if (token.type === "list_item_open" && depth === 0) start = index;
    depth += token.nesting;
    if (token.type === "list_item_close" && depth === 0 && start >= 0) {
      const content = tokens.slice(start + 1, index);
      const task = content[0]?.type === "paragraph_open" ? taskOf(content[1]) : null;
      items.push({ task, body: blocks(content, renderer, lookup) });
      start = -1;
    }
  }
  if (items.length > 0 && items.every((item) => item.task !== null)) {
    return taskList(items.map((item) => ({ done: item.task?.done ?? false, body: item.body })));
  }
  const tag = open.type === "ordered_list_open" ? "ol" : "ul";
  return `<${tag}>${items.map((item) => `<li>${item.body}</li>`).join("")}</${tag}>`;
}

function table(tokens: readonly Token[], renderer: Renderer): string {
  let output = "<table><tbody>";
  let header = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as Token;
    if (token.type === "thead_open") header = true;
    if (token.type === "thead_close") header = false;
    if (token.type === "tr_open") output += "<tr>";
    if (token.type === "tr_close") output += "</tr>";
    if (token.type === "th_open" || token.type === "td_open") {
      const inline = tokens[index + 1];
      const tag = header || token.type === "th_open" ? "th" : "td";
      output += `<${tag}><p>${renderer.inline(inline?.children ?? [])}</p></${tag}>`;
      index += 2;
    }
  }
  return `${output}</tbody></table>`;
}

export function convertMarkdown(source: string, lookup: MarkdownLookup): ConvertedMarkdown {
  const { yaml, content } = splitFrontMatter(source);
  const frontMatter = parseFrontMatter(yaml, lookup.problem);
  const tokens = MARKDOWN.parse(content, {});
  let heading: string | null = null;
  let rest = tokens;
  const first = tokens[0];
  if (first?.type === "heading_open" && first.tag === "h1" && frontMatter.title === null) {
    const inline = tokens[1];
    const title = (inline?.children ?? [])
      .map((child: Token) => (child.type === "text" || child.type === "code_inline" ? child.content : ""))
      .join("")
      .trim();
    if (title.length > 0) {
      heading = title;
      rest = tokens.slice(3);
    }
  }
  const renderer = new Renderer(lookup);
  const properties = frontMatter.properties.length > 0 ? propertiesMacro(frontMatter.properties) : "";
  return { frontMatter, heading, body: properties + blocks(rest, renderer, lookup) };
}
