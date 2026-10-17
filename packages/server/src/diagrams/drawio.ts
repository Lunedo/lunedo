import { inflateRawSync } from "node:zlib";
import { DOMParser, type Element, type Node } from "@xmldom/xmldom";

export const MAX_DRAWIO_BYTES = 10 * 1024 * 1024;
const MAX_DEPTH = 64;
const MAX_ELEMENTS = 200_000;

export class DiagramRejectedError extends Error {
  override name = "DiagramRejectedError";
}

const ELEMENTS = new Set([
  "mxfile",
  "diagram",
  "mxGraphModel",
  "root",
  "mxCell",
  "mxGeometry",
  "mxPoint",
  "mxRectangle",
  "Array",
  "Object",
  "object",
  "UserObject",
  "mxCompressedText",
]);

const LINK_SCHEMES = /^(https?:|mailto:|data:page\/id,|#)/i;
const UNSAFE_VALUE = /javascript:|vbscript:|data:(?!page\/id,|image\/(png|jpeg|gif|webp|svg\+xml)[;,])/i;
const ATTRIBUTE_NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,99}$/;
const TEXT_ATTRIBUTES = new Set(["value", "label"]);

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(text: string): string {
  return escapeText(text).replace(/"/g, "&quot;").replace(/\n/g, "&#10;").replace(/\r/g, "&#13;");
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f) return true;
  }
  return false;
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function labelText(value: string): string {
  return value
    .replace(/<br\s*\/?>|<\/(div|p|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, name: string) => {
      if (name.startsWith("#x") || name.startsWith("#X"))
        return String.fromCodePoint(Number.parseInt(name.slice(2), 16) || 32);
      if (name.startsWith("#")) return String.fromCodePoint(Number(name.slice(1)) || 32);
      return ENTITIES[name.toLowerCase()] ?? entity;
    })
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function parseXml(input: string): Element {
  if (/<!DOCTYPE|<!ENTITY/i.test(input))
    throw new DiagramRejectedError("Document type declarations are not accepted");
  let root: Element | null;
  try {
    const document = new DOMParser({
      onError: (level, message) => {
        if (level !== "warning") throw new DiagramRejectedError(message);
      },
    }).parseFromString(input, "text/xml");
    root = document.documentElement;
  } catch (error) {
    throw new DiagramRejectedError(`The diagram is not well-formed XML: ${(error as Error).message}`);
  }
  if (!root) throw new DiagramRejectedError("The diagram is empty");
  return root;
}

function inflate(compressed: string): string {
  try {
    const data = inflateRawSync(Buffer.from(compressed.trim(), "base64"), {
      maxOutputLength: MAX_DRAWIO_BYTES,
    });
    return decodeURIComponent(data.toString("latin1"));
  } catch {
    throw new DiagramRejectedError("A page of the diagram cannot be decompressed");
  }
}

class DrawioSanitizer {
  readonly texts: string[] = [];
  #elements = 0;

  attributes(element: Element): string {
    const parts: string[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < element.attributes.length; index += 1) {
      const attribute = element.attributes.item(index);
      if (!attribute || attribute.namespaceURI !== null) continue;
      const name = attribute.name;
      const value = attribute.value;
      if (!ATTRIBUTE_NAME.test(name) || /^on/i.test(name) || seen.has(name)) continue;
      if (hasControlCharacter(value)) continue;
      const compact = value.replace(/\s+/g, "");
      if (name === "link" && !LINK_SCHEMES.test(compact)) continue;
      if (UNSAFE_VALUE.test(compact)) continue;
      if (TEXT_ATTRIBUTES.has(name)) {
        const text = labelText(value);
        if (text.length > 0) this.texts.push(text);
      }
      seen.add(name);
      parts.push(` ${name}="${escapeAttribute(value)}"`);
    }
    return parts.join("");
  }

  element(element: Element, depth: number): string {
    if (depth > MAX_DEPTH) throw new DiagramRejectedError("The diagram is nested too deeply");
    this.#elements += 1;
    if (this.#elements > MAX_ELEMENTS) throw new DiagramRejectedError("The diagram has too many elements");
    const name = element.localName ?? "";
    if (element.namespaceURI !== null || !ELEMENTS.has(name)) {
      throw new DiagramRejectedError(`The diagram contains an unknown element: ${name.slice(0, 50)}`);
    }
    let content = "";
    let text = "";
    for (let node: Node | null = element.firstChild; node; node = node.nextSibling) {
      if (node.nodeType === node.ELEMENT_NODE) content += this.element(node as Element, depth + 1);
      else if (node.nodeType === node.TEXT_NODE || node.nodeType === node.CDATA_SECTION_NODE) {
        text += node.nodeValue ?? "";
      }
    }
    if (name === "diagram" && content.length === 0 && text.trim().length > 0) {
      content = this.element(parseXml(inflate(text)), depth + 1);
    }
    return `<${name}${this.attributes(element)}>${content}</${name}>`;
  }
}

export interface SanitizedDrawio {
  xml: string;
  text: string;
}

export function sanitizeDrawio(input: string): SanitizedDrawio {
  if (Buffer.byteLength(input, "utf8") > MAX_DRAWIO_BYTES)
    throw new DiagramRejectedError("The diagram is too large");
  const root = parseXml(input);
  const name = root.localName ?? "";
  if (name !== "mxfile" && name !== "mxGraphModel") {
    throw new DiagramRejectedError("The file is not a draw.io diagram");
  }
  const sanitizer = new DrawioSanitizer();
  const xml = sanitizer.element(root, 0);
  if (Buffer.byteLength(xml, "utf8") > MAX_DRAWIO_BYTES)
    throw new DiagramRejectedError("The diagram is too large");
  return { xml, text: [...new Set(sanitizer.texts)].join("\n") };
}
