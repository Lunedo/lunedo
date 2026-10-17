import { Parser } from "htmlparser2";
import { attachmentImage, element, text } from "../storage-writer.js";

export const MEDIA_PREFIX = "pagehall-media:";

interface HtmlNode {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: (HtmlNode | string)[];
}

export interface WordSection {
  readonly title: string | null;
  readonly body: string;
  readonly images: readonly string[];
}

export interface ConvertedDocument {
  readonly sections: readonly WordSection[];
}

const VOID = new Set(["br", "img", "hr"]);
const PASS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "u",
  "s",
  "sub",
  "sup",
  "blockquote",
  "pre",
  "code",
]);
const RENAMED: Readonly<Record<string, string>> = { b: "strong", i: "em", del: "s", strike: "s" };
const MAX_DEPTH = 200;

function parse(html: string): HtmlNode {
  const root: HtmlNode = { name: "#root", attributes: {}, children: [] };
  const stack: HtmlNode[] = [root];
  const parser = new Parser(
    {
      onopentag: (name, attributes) => {
        const node: HtmlNode = { name: name.toLowerCase(), attributes, children: [] };
        (stack.at(-1) as HtmlNode).children.push(node);
        if (!VOID.has(node.name) && stack.length < MAX_DEPTH) stack.push(node);
      },
      ontext: (value) => {
        (stack.at(-1) as HtmlNode).children.push(value);
      },
      onclosetag: (name) => {
        const lower = name.toLowerCase();
        if (VOID.has(lower)) return;
        for (let index = stack.length - 1; index > 0; index -= 1) {
          if (stack[index]?.name === lower) {
            stack.length = index;
            return;
          }
        }
      },
    },
    { decodeEntities: true, lowerCaseTags: true },
  );
  parser.write(html);
  parser.end();
  return root;
}

function plain(node: HtmlNode | string): string {
  if (typeof node === "string") return node;
  return node.children.map(plain).join("");
}

function footnoteNumber(id: string, prefix: string): string | null {
  const match = new RegExp(`^${prefix}(?:footnote|endnote)-(\\d+)$`).exec(id);
  return match?.[1] ?? null;
}

class Writer {
  readonly images = new Set<string>();
  readonly references: string[] = [];

  constructor(
    private readonly prefix: string,
    private readonly media: (path: string) => string | null,
  ) {}

  write(node: HtmlNode | string): string {
    if (typeof node === "string") return text(node);
    const children = () => node.children.map((child) => this.write(child)).join("");
    switch (node.name) {
      case "br":
        return "<br/>";
      case "hr":
        return "<hr/>";
      case "img": {
        const source = node.attributes.src ?? "";
        if (!source.startsWith(MEDIA_PREFIX)) return "";
        const path = source.slice(MEDIA_PREFIX.length);
        const name = this.media(path);
        if (!name) return "";
        this.images.add(path);
        return attachmentImage(name, node.attributes.alt?.trim() || null);
      }
      case "a": {
        const href = node.attributes.href ?? "";
        if (/^(https?:|mailto:)/i.test(href)) return element("a", { href }, children());
        if (href.startsWith("#")) {
          const number = footnoteNumber(href.slice(1), this.prefix);
          if (!number) return children();
          this.references.push(number);
          return text(`[${number}]`);
        }
        return children();
      }
      case "table":
        return `<table><tbody>${this.#rows(node)}</tbody></table>`;
      case "td":
      case "th": {
        const span = {
          colspan: node.attributes.colspan ?? null,
          rowspan: node.attributes.rowspan ?? null,
        };
        return element(node.name, span, children() || "<p></p>");
      }
      default: {
        const name = RENAMED[node.name] ?? node.name;
        if (PASS.has(name)) return `<${name}>${children()}</${name}>`;
        return children();
      }
    }
  }

  #rows(node: HtmlNode): string {
    let output = "";
    for (const child of node.children) {
      if (typeof child === "string") continue;
      if (child.name === "tr")
        output += `<tr>${child.children.map((cell) => this.#cell(cell)).join("")}</tr>`;
      else if (child.name === "thead" || child.name === "tbody" || child.name === "tfoot") {
        output += this.#rows(child);
      }
    }
    return output;
  }

  #cell(cell: HtmlNode | string): string {
    if (typeof cell === "string") return "";
    return cell.name === "td" || cell.name === "th" ? this.write(cell) : "";
  }
}

function isFootnoteList(node: HtmlNode | string, prefix: string): node is HtmlNode {
  if (typeof node === "string" || node.name !== "ol") return false;
  const items = node.children.filter((child): child is HtmlNode => typeof child !== "string");
  return items.length > 0 && items.every((item) => footnoteNumber(item.attributes.id ?? "", prefix) !== null);
}

function withoutBackLinks(node: HtmlNode, prefix: string): HtmlNode {
  return {
    ...node,
    children: node.children
      .filter(
        (child) =>
          typeof child === "string" ||
          child.name !== "a" ||
          !footnoteNumber((child.attributes.href ?? "").slice(1).replace("-ref-", "-"), prefix),
      )
      .map((child) => (typeof child === "string" ? child : withoutBackLinks(child, prefix))),
  };
}

export function convertWordHtml(
  html: string,
  options: { prefix: string; split: boolean; media: (path: string) => string | null },
): ConvertedDocument {
  const root = parse(html);
  const notes = new Map<string, HtmlNode>();
  const content: (HtmlNode | string)[] = [];
  for (const child of root.children) {
    if (isFootnoteList(child, options.prefix)) {
      for (const item of child.children) {
        if (typeof item === "string") continue;
        const number = footnoteNumber(item.attributes.id ?? "", options.prefix);
        if (number) notes.set(number, withoutBackLinks(item, options.prefix));
      }
    } else content.push(child);
  }
  const groups: { title: string | null; nodes: (HtmlNode | string)[] }[] = [{ title: null, nodes: [] }];
  for (const node of content) {
    if (options.split && typeof node !== "string" && node.name === "h1") {
      groups.push({ title: plain(node).replace(/\s+/g, " ").trim() || null, nodes: [] });
      continue;
    }
    (groups.at(-1) as (typeof groups)[number]).nodes.push(node);
  }
  const sections: WordSection[] = [];
  for (const [index, group] of groups.entries()) {
    if (index === 0 && group.nodes.length === 0 && groups.length > 1) {
      sections.push({ title: null, body: "", images: [] });
      continue;
    }
    const writer = new Writer(options.prefix, options.media);
    let body = group.nodes.map((node) => writer.write(node)).join("");
    const referenced = [...new Set(writer.references)].filter((number) => notes.has(number));
    if (referenced.length > 0) {
      const noteWriter = new Writer(options.prefix, options.media);
      body += "<hr/>";
      for (const number of referenced) {
        const note = notes.get(number) as HtmlNode;
        const inline = note.children.map((child) =>
          noteWriter.write(
            typeof child !== "string" && child.name === "p" ? { ...child, name: "span" } : child,
          ),
        );
        body += `<p><sup>${text(`[${number}]`)}</sup> ${inline.join("")}</p>`;
      }
      for (const image of noteWriter.images) writer.images.add(image);
    }
    sections.push({ title: group.title, body, images: [...writer.images] });
  }
  return { sections };
}
