import { DOMParser, type Element, type Node } from "@xmldom/xmldom";
import { takeMarkup } from "../diagrams/markup.js";

export const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;
export const MAX_SVG_ELEMENTS = 100_000;
export const MAX_SVG_ATTRIBUTES = 400_000;
const MAX_DEPTH = 64;
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";

export class SvgRejectedError extends Error {
  override name = "SvgRejectedError";
}

const ELEMENTS = new Set([
  "svg",
  "g",
  "defs",
  "symbol",
  "use",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "clipPath",
  "mask",
  "pattern",
  "linearGradient",
  "radialGradient",
  "stop",
  "image",
  "marker",
  "title",
  "desc",
  "style",
]);

const ATTRIBUTES = new Set([
  "id",
  "class",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "dx",
  "dy",
  "width",
  "height",
  "d",
  "points",
  "viewBox",
  "transform",
  "fill",
  "fill-opacity",
  "fill-rule",
  "clip-rule",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-miterlimit",
  "opacity",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "text-anchor",
  "dominant-baseline",
  "alignment-baseline",
  "direction",
  "letter-spacing",
  "style",
  "clip-path",
  "mask",
  "preserveAspectRatio",
  "patternUnits",
  "patternContentUnits",
  "patternTransform",
  "gradientUnits",
  "gradientTransform",
  "offset",
  "stop-color",
  "stop-opacity",
  "markerWidth",
  "markerHeight",
  "markerUnits",
  "refX",
  "refY",
  "orient",
  "version",
  "vector-effect",
  "paint-order",
  "visibility",
  "display",
  "href",
  "marker-start",
  "marker-mid",
  "marker-end",
  "filter",
  "in",
  "in2",
  "stdDeviation",
  "result",
  "mode",
  "values",
  "operator",
  "flood-color",
  "flood-opacity",
  "filterUnits",
  "primitiveUnits",
  "color-interpolation-filters",
  "lengthAdjust",
  "textLength",
  "text-decoration",
  "font-variant",
  "writing-mode",
  "word-spacing",
  "baseline-shift",
  "shape-rendering",
  "text-rendering",
  "image-rendering",
  "overflow",
  "color",
  "requiredFeatures",
  "pointer-events",
]);

const DIAGRAM_ELEMENTS = new Set([
  "switch",
  "foreignObject",
  "filter",
  "feGaussianBlur",
  "feOffset",
  "feBlend",
  "feColorMatrix",
  "feFlood",
  "feComposite",
  "feMerge",
  "feMergeNode",
  "feDropShadow",
]);

const UNWRAPPED = new Set(["a"]);

const HTML_ELEMENTS = new Set([
  "div",
  "span",
  "p",
  "br",
  "hr",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "strike",
  "sub",
  "sup",
  "font",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tr",
  "td",
  "th",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "pre",
  "code",
  "blockquote",
]);

const HTML_ATTRIBUTES = new Set(["style", "color", "face", "size", "align", "colspan", "rowspan"]);
const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

const RASTER_DATA_URL = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]*$/;
const SVG_DATA_URL = /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]*$/;
const FONT_DATA_URL =
  /^data:(font\/[a-z0-9.+-]+|application\/(font-[a-z0-9.+-]+|x-font-[a-z0-9.+-]+));base64,[A-Za-z0-9+/=\s]*$/;
const FORBIDDEN_CSS = /@import|expression\s*\(|javascript:|behavior\s*:|-moz-binding|<\/|\\/i;

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(text: string): string {
  return escapeText(text).replace(/"/g, "&quot;");
}

function urlsOf(value: string): string[] | null {
  const urls: string[] = [];
  const pattern = /url\(\s*(['"]?)(.*?)\1\s*\)/gis;
  let rest = value;
  for (const match of value.matchAll(pattern)) {
    urls.push(match[2] ?? "");
    rest = rest.replace(match[0], "");
  }
  return /url\s*\(/i.test(rest) ? null : urls;
}

function safeCssValue(value: string, allowFonts: boolean): boolean {
  if (FORBIDDEN_CSS.test(value)) return false;
  const urls = urlsOf(value);
  if (urls === null) return false;
  return urls.every(
    (url) => /^#[A-Za-z0-9_.:-]+$/.test(url) || (allowFonts && FONT_DATA_URL.test(url.replace(/\s+/g, ""))),
  );
}

function safeHref(element: string, value: string, diagram: boolean): boolean {
  const compact = value.trim();
  if (element === "use") return /^#[A-Za-z0-9_.:-]+$/.test(compact);
  if (element === "image") {
    return RASTER_DATA_URL.test(compact) || (diagram && SVG_DATA_URL.test(compact.replace(/\s+/g, "")));
  }
  return false;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f) return true;
  }
  return false;
}

function attributesOf(element: Element, diagram: boolean): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < element.attributes.length; index += 1) {
    const attribute = element.attributes.item(index);
    if (!attribute) continue;
    const namespace = attribute.namespaceURI;
    const name = namespace === XLINK_NAMESPACE ? "href" : (attribute.localName ?? attribute.name);
    if (namespace !== null && namespace !== XLINK_NAMESPACE) continue;
    if (!ATTRIBUTES.has(name) || seen.has(name)) continue;
    const value = attribute.value;
    if (hasControlCharacter(value) || /javascript:|vbscript:|data:text/i.test(value.replace(/\s+/g, "")))
      continue;
    if (name === "href") {
      if (!safeHref(element.localName ?? "", value, diagram)) continue;
    } else if (!safeCssValue(value, false)) {
      continue;
    }
    seen.add(name);
    parts.push(` ${name}="${escapeAttribute(value)}"`);
  }
  return parts.join("");
}

function htmlAttributesOf(element: Element): string {
  const parts: string[] = [];
  for (let index = 0; index < element.attributes.length; index += 1) {
    const attribute = element.attributes.item(index);
    if (!attribute || attribute.namespaceURI !== null) continue;
    const name = attribute.localName ?? attribute.name;
    const value = attribute.value;
    if (!HTML_ATTRIBUTES.has(name) || hasControlCharacter(value) || !safeCssValue(value, false)) continue;
    if (/javascript:|vbscript:|data:/i.test(value.replace(/\s+/g, ""))) continue;
    parts.push(` ${name}="${escapeAttribute(value)}"`);
  }
  return parts.join("");
}

function textContent(element: Element): string {
  let text = "";
  for (let node: Node | null = element.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === node.TEXT_NODE || node.nodeType === node.CDATA_SECTION_NODE)
      text += node.nodeValue ?? "";
  }
  return text;
}

const TEXT_ELEMENTS = new Set(["text", "tspan"]);
const BLOCK_HTML = new Set(["div", "p", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "blockquote"]);

class Sanitizer {
  readonly texts: string[] = [];
  #line = "";

  constructor(private readonly diagram: boolean) {}

  #breakLine(): void {
    const line = this.#line.replace(/\s+/g, " ").trim();
    if (line.length > 0) this.texts.push(line);
    this.#line = "";
  }

  #children(element: Element, render: (child: Element) => string, collect: boolean): string {
    let content = "";
    for (let node: Node | null = element.firstChild; node; node = node.nextSibling) {
      if (node.nodeType === node.ELEMENT_NODE) content += render(node as Element);
      else if (node.nodeType === node.TEXT_NODE || node.nodeType === node.CDATA_SECTION_NODE) {
        const value = node.nodeValue ?? "";
        if (collect) this.#line += value;
        content += escapeText(value);
      }
    }
    return content;
  }

  svg(element: Element, depth: number, inText: boolean): string {
    if (depth > MAX_DEPTH) throw new SvgRejectedError("The drawing is nested too deeply");
    const name = element.localName ?? "";
    if (element.namespaceURI !== SVG_NAMESPACE) return "";
    if (this.diagram && UNWRAPPED.has(name)) {
      return this.#children(element, (child) => this.svg(child, depth + 1, inText), inText);
    }
    if (!ELEMENTS.has(name) && !(this.diagram && DIAGRAM_ELEMENTS.has(name))) return "";
    if (name === "style") {
      const css = textContent(element);
      return safeCssValue(css, true) ? `<style>${escapeText(css)}</style>` : "";
    }
    if (name === "foreignObject") {
      const content = this.#children(element, (child) => this.html(child, depth + 1, true), false);
      this.#breakLine();
      return `<foreignObject${attributesOf(element, true)}>${content}</foreignObject>`;
    }
    const namespaces = depth === 0 ? ` xmlns="${SVG_NAMESPACE}"` : "";
    const text = inText || TEXT_ELEMENTS.has(name);
    const content = this.#children(element, (child) => this.svg(child, depth + 1, text), text);
    if (name === "text") this.#breakLine();
    return `<${name}${namespaces}${attributesOf(element, this.diagram)}>${content}</${name}>`;
  }

  html(element: Element, depth: number, root: boolean): string {
    if (depth > MAX_DEPTH) throw new SvgRejectedError("The drawing is nested too deeply");
    const name = element.localName ?? "";
    if (element.namespaceURI !== XHTML_NAMESPACE || !HTML_ELEMENTS.has(name)) return "";
    const namespaces = root ? ` xmlns="${XHTML_NAMESPACE}"` : "";
    if (name === "br" || name === "hr") {
      this.#breakLine();
      return `<${name}${namespaces}/>`;
    }
    const content = this.#children(element, (child) => this.html(child, depth + 1, false), true);
    if (BLOCK_HTML.has(name)) this.#breakLine();
    return `<${name}${namespaces}${htmlAttributesOf(element)}>${content}</${name}>`;
  }

  finish(): void {
    this.#breakLine();
  }
}

export interface SanitizedSvg {
  svg: string;
  text: string;
  width: number;
  height: number;
}

const UNIT_PIXELS: Readonly<Record<string, number>> = {
  "": 1,
  px: 1,
  pt: 4 / 3,
  pc: 16,
  mm: 96 / 25.4,
  cm: 96 / 2.54,
  in: 96,
  q: 96 / 101.6,
  em: 16,
  rem: 16,
  ex: 8,
  ch: 8,
};

function pixels(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const match = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z]*|%)\s*$/i.exec(value);
  if (!match) throw new SvgRejectedError("The size of the drawing cannot be read");
  const unit = (match[2] ?? "").toLowerCase();
  if (unit === "%") return null;
  const number = Number(match[1]) * (UNIT_PIXELS[unit] ?? Number.NaN);
  if (!Number.isFinite(number) || number < 0)
    throw new SvgRejectedError("The size of the drawing cannot be read");
  return number;
}

function sizeOf(root: Element): { width: number; height: number } {
  const viewBox = root.getAttribute("viewBox");
  let box: number[] = [];
  if (viewBox !== null && viewBox.trim() !== "") {
    box = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (
      box.length !== 4 ||
      box.some((value) => !Number.isFinite(value)) ||
      (box[2] ?? 0) < 0 ||
      (box[3] ?? 0) < 0
    ) {
      throw new SvgRejectedError("The size of the drawing cannot be read");
    }
  }
  const width = pixels(root.getAttribute("width"));
  const height = pixels(root.getAttribute("height"));
  return {
    width: Math.max(width ?? 0, box[2] ?? 0, width === null && box.length === 0 ? 300 : 0),
    height: Math.max(height ?? 0, box[3] ?? 0, height === null && box.length === 0 ? 150 : 0),
  };
}

function parse(input: string, maxBytes: number): Element {
  if (Buffer.byteLength(input, "utf8") > maxBytes) throw new SvgRejectedError("The drawing is too large");
  if (!takeMarkup(input, { elements: MAX_SVG_ELEMENTS, attributes: MAX_SVG_ATTRIBUTES })) {
    throw new SvgRejectedError(
      `The drawing has more than ${MAX_SVG_ELEMENTS} elements or ${MAX_SVG_ATTRIBUTES} attributes`,
    );
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(input))
    throw new SvgRejectedError("Document type declarations are not accepted");
  let root: Element | null;
  try {
    const document = new DOMParser({
      onError: (level, message) => {
        if (level !== "warning") throw new SvgRejectedError(message);
      },
    }).parseFromString(input, "image/svg+xml");
    root = document.documentElement;
  } catch (error) {
    throw new SvgRejectedError(`The drawing is not well-formed SVG: ${(error as Error).message}`);
  }
  if (root?.localName !== "svg" || root.namespaceURI !== SVG_NAMESPACE) {
    throw new SvgRejectedError("The drawing is not an SVG image");
  }
  return root;
}

export function sanitizeSvg(input: string): string {
  return new Sanitizer(false).svg(parse(input, MAX_PREVIEW_BYTES), 0, false);
}

export function sanitizeDiagramSvg(input: string, maxBytes: number): SanitizedSvg {
  const root = parse(input, maxBytes);
  const sanitizer = new Sanitizer(true);
  const svg = sanitizer.svg(root, 0, false);
  sanitizer.finish();
  return { svg, text: sanitizer.texts.join("\n"), ...sizeOf(root) };
}
