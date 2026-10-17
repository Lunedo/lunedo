import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";
import {
  delimiterOf,
  type FrameMessage,
  isRenderMessage,
  MAX_ROWS,
  parseCsv,
  type RenderMessage,
} from "./protocol.js";
import "./preview.css";

const MAX_TEXT = 2_000_000;
const MAX_PAGES = 200;

function post(message: FrameMessage): void {
  window.parent.postMessage(message, "*");
}

function root(): HTMLElement {
  const element = document.getElementById("preview");
  if (!element) throw new Error("The preview root is missing");
  return element;
}

function decode(bytes: ArrayBuffer): string {
  return new TextDecoder("utf-8").decode(bytes);
}

function note(text: string): HTMLParagraphElement {
  const element = document.createElement("p");
  element.className = "note";
  element.textContent = text;
  return element;
}

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "form", "input", "button", "iframe", "object", "embed"],
    FORBID_ATTR: ["style"],
  });
}

function renderText(message: RenderMessage, code: boolean): void {
  const text = decode(message.bytes);
  const pre = document.createElement("pre");
  pre.className = code ? "code" : "text";
  pre.textContent = text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text;
  root().append(pre);
  if (text.length > MAX_TEXT) root().append(note(message.labels.truncated));
}

function renderMarkdown(message: RenderMessage): void {
  const markdown = new MarkdownIt({ html: false, linkify: true });
  const article = document.createElement("article");
  article.className = "document";
  article.innerHTML = sanitizeHtml(markdown.render(decode(message.bytes).slice(0, MAX_TEXT)));
  root().append(article);
}

function table(rows: string[][]): HTMLTableElement {
  const element = document.createElement("table");
  const [header, ...body] = rows;
  if (header) {
    const head = element.createTHead().insertRow();
    for (const value of header) {
      const cell = document.createElement("th");
      cell.scope = "col";
      cell.textContent = value;
      head.append(cell);
    }
  }
  const tbody = element.createTBody();
  for (const row of body) {
    const line = tbody.insertRow();
    for (const value of row) line.insertCell().textContent = value;
  }
  return element;
}

function renderCsv(message: RenderMessage): void {
  const text = decode(message.bytes);
  const { rows, truncated } = parseCsv(text, delimiterOf(message.name, text));
  if (rows.length === 0) {
    root().append(note(message.labels.empty));
    return;
  }
  const wrapper = document.createElement("div");
  wrapper.className = "table";
  wrapper.append(table(rows));
  root().append(wrapper);
  if (truncated) root().append(note(message.labels.truncated));
}

function renderSvg(message: RenderMessage): void {
  const clean = DOMPurify.sanitize(decode(message.bytes), {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ["foreignObject", "script", "style"],
  });
  const image = document.createElement("img");
  image.alt = message.name;
  image.src = URL.createObjectURL(new Blob([clean], { type: "image/svg+xml" }));
  image.className = "image";
  root().append(image);
}

async function renderPdf(message: RenderMessage): Promise<void> {
  const pdfjs = await import("pdfjs-dist");
  await import("pdfjs-dist/build/pdf.worker.min.mjs");
  const document_ = await pdfjs.getDocument({ data: new Uint8Array(message.bytes), enableXfa: false })
    .promise;
  const pages = Math.min(document_.numPages, MAX_PAGES);
  for (let number = 1; number <= pages; number += 1) {
    const page = await document_.getPage(number);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.className = "page";
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", message.labels.page.replace("{number}", String(number)));
    root().append(canvas);
    await page.render({ canvas, viewport }).promise;
  }
  if (document_.numPages > pages) root().append(note(message.labels.truncated));
}

async function renderWord(message: RenderMessage): Promise<void> {
  const mammoth = await import("mammoth");
  const result = await mammoth.convertToHtml({ arrayBuffer: message.bytes });
  const article = document.createElement("article");
  article.className = "document";
  article.innerHTML = sanitizeHtml(result.value);
  root().append(article);
}

async function renderExcel(message: RenderMessage): Promise<void> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(new Uint8Array(message.bytes), {
    type: "array",
    cellFormula: false,
    cellHTML: false,
  });
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const section = document.createElement("section");
    const heading = document.createElement("h2");
    heading.textContent = message.labels.sheet.replace("{name}", name);
    section.append(heading);
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
    const wrapper = document.createElement("div");
    wrapper.className = "table";
    wrapper.append(table(rows.slice(0, MAX_ROWS).map((row) => row.map((value) => String(value)))));
    section.append(wrapper);
    if (rows.length > MAX_ROWS) section.append(note(message.labels.truncated));
    root().append(section);
  }
}

async function render(message: RenderMessage): Promise<void> {
  document.documentElement.dataset.theme = message.theme;
  if (message.zoom !== undefined) document.body.style.zoom = String(message.zoom / 100);
  root().replaceChildren();
  switch (message.kind) {
    case "text":
      renderText(message, false);
      break;
    case "code":
      renderText(message, true);
      break;
    case "markdown":
      renderMarkdown(message);
      break;
    case "csv":
      renderCsv(message);
      break;
    case "svg":
      renderSvg(message);
      break;
    case "pdf":
      await renderPdf(message);
      break;
    case "word":
      await renderWord(message);
      break;
    case "excel":
      await renderExcel(message);
      break;
  }
}

let handled = false;

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window.parent || handled || !isRenderMessage(event.data)) return;
  handled = true;
  const message = event.data;
  render(message).then(
    () => post({ type: "rendered", height: document.documentElement.scrollHeight }),
    (error: unknown) => {
      root().replaceChildren(note(message.labels.failed));
      post({ type: "failed", reason: error instanceof Error ? error.name : "error" });
    },
  );
});

post({ type: "ready" });
