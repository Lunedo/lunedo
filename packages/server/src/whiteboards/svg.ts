import { DOMParser, type Element, type Node } from "@xmldom/xmldom";

export const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;
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
]);

const RASTER_DATA_URL = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]*$/;
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

function safeHref(element: string, value: string): boolean {
  const compact = value.trim();
  if (element === "use") return /^#[A-Za-z0-9_.:-]+$/.test(compact);
  if (element === "image") return RASTER_DATA_URL.test(compact);
  return false;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f) return true;
  }
  return false;
}

function attributesOf(element: Element): string {
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
      if (!safeHref(element.localName ?? "", value)) continue;
    } else if (!safeCssValue(value, false)) {
      continue;
    }
    seen.add(name);
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

function render(element: Element, depth: number): string {
  if (depth > MAX_DEPTH) throw new SvgRejectedError("The drawing is nested too deeply");
  const name = element.localName ?? "";
  if (element.namespaceURI !== SVG_NAMESPACE || !ELEMENTS.has(name)) return "";
  if (name === "style") {
    const css = textContent(element);
    return safeCssValue(css, true) ? `<style>${escapeText(css)}</style>` : "";
  }
  const namespaces = depth === 0 ? ` xmlns="${SVG_NAMESPACE}"` : "";
  let content = "";
  for (let node: Node | null = element.firstChild; node; node = node.nextSibling) {
    if (node.nodeType === node.ELEMENT_NODE) content += render(node as Element, depth + 1);
    else if (node.nodeType === node.TEXT_NODE || node.nodeType === node.CDATA_SECTION_NODE) {
      content += escapeText(node.nodeValue ?? "");
    }
  }
  return `<${name}${namespaces}${attributesOf(element)}>${content}</${name}>`;
}

export function sanitizeSvg(input: string): string {
  if (Buffer.byteLength(input, "utf8") > MAX_PREVIEW_BYTES)
    throw new SvgRejectedError("The drawing is too large");
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
  return render(root, 0);
}
