import { escapeHtml, type Heading } from "@lunedo/editor-schema";
import type { ExportOptions } from "./options.js";
import { printStyle } from "./style.js";
import type { ExportTexts } from "./texts.js";

export const MAX_CONTENTS_LEVEL = 3;

export interface PrintComment {
  quote: string | null;
  author: string;
  date: string;
  body: string;
  replies: readonly { author: string; date: string; body: string }[];
}

export interface PrintPage {
  id: string;
  depth: number;
  title: string;
  path: readonly string[];
  meta: readonly string[];
  body: string;
  headings: readonly Heading[];
  comments: readonly PrintComment[];
}

export interface PrintAttachment {
  name: string;
  page: string;
  size: string;
}

export interface PrintDocument {
  language: string;
  title: string;
  path: readonly string[];
  exported: string;
  options: ExportOptions;
  texts: ExportTexts;
  pages: readonly PrintPage[];
  attachments: readonly PrintAttachment[];
}

const ID_ATTRIBUTE = / id="([^"]*)"/g;
const FRAGMENT_LINK = / href="#([^"]*)"/g;
const PAGE_ANCHOR = "ld-page-";

function scoped(html: string, prefix: string): string {
  return html
    .replace(ID_ATTRIBUTE, (_match, id: string) => ` id="${prefix}${id}"`)
    .replace(FRAGMENT_LINK, (match, id: string) =>
      id.startsWith(PAGE_ANCHOR) ? match : ` href="#${prefix}${id}"`,
    );
}

function path(parts: readonly string[]): string {
  return parts.map((part) => escapeHtml(part)).join(" › ");
}

function titleBlock(page: PrintPage): string {
  const meta = page.meta.map((line) => `<p class="ld-meta">${escapeHtml(line)}</p>`).join("");
  return `<header class="ld-title-block"><p class="ld-path">${path(page.path)}</p><h1 class="ld-page-title">${escapeHtml(page.title)}</h1>${meta}</header>`;
}

function contentsEntry(level: number, href: string, title: string): string {
  return `<li data-level="${level}"><a href="#${escapeHtml(href)}"><span class="ld-entry">${escapeHtml(title)}</span></a></li>`;
}

function contents(document: PrintDocument, single: PrintPage | null): string {
  if (!document.options.contents) return "";
  const entries = single
    ? single.headings
        .filter((heading) => heading.level <= MAX_CONTENTS_LEVEL)
        .map((heading) => contentsEntry(heading.level - 1, `${pagePrefix(0)}${heading.id}`, heading.text))
    : document.pages.map((page) => contentsEntry(page.depth, pageAnchor(page.id), page.title));
  if (document.options.attachments && document.attachments.length > 0) {
    entries.push(contentsEntry(0, "ld-appendix", document.texts.appendix));
  }
  if (entries.length === 0) return "";
  return `<nav class="ld-contents" aria-label="${escapeHtml(document.texts.contents)}"><h2>${escapeHtml(document.texts.contents)}</h2><ol>${entries.join("")}</ol></nav>`;
}

function pagePrefix(index: number): string {
  return `p${index}-`;
}

export function pageAnchor(pageId: string): string {
  return `${PAGE_ANCHOR}${pageId}`;
}

function comments(page: PrintPage, texts: ExportTexts): string {
  if (page.comments.length === 0) return "";
  const entry = (author: string, date: string, body: string, className: string, quote: string | null) =>
    `<div class="${className}">${quote ? `<p class="ld-comment-quote">${escapeHtml(texts.commentOn(quote))}</p>` : ""}<p class="ld-comment-meta">${escapeHtml(author)} · ${escapeHtml(date)}</p>${body}</div>`;
  const threads = page.comments.map(
    (thread) =>
      `<section class="ld-comment-thread">${entry(thread.author, thread.date, thread.body, "ld-comment", thread.quote)}${thread.replies
        .map((reply) => entry(reply.author, reply.date, reply.body, "ld-comment-reply", null))
        .join("")}</section>`,
  );
  return `<section class="ld-comments"><h2>${escapeHtml(texts.comments)}</h2>${threads.join("")}</section>`;
}

function appendix(document: PrintDocument): string {
  if (!document.options.attachments || document.attachments.length === 0) return "";
  const { texts } = document;
  const rows = document.attachments
    .map(
      (attachment) =>
        `<tr><td>${escapeHtml(attachment.name)}</td><td>${escapeHtml(attachment.page)}</td><td>${escapeHtml(attachment.size)}</td></tr>`,
    )
    .join("");
  return `<section class="ld-appendix" id="ld-appendix"><h2>${escapeHtml(texts.appendix)}</h2><table><thead><tr><th scope="col">${escapeHtml(texts.appendixFile)}</th><th scope="col">${escapeHtml(texts.appendixPage)}</th><th scope="col">${escapeHtml(texts.appendixSize)}</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

export function printHtml(document: PrintDocument): string {
  const { texts, options } = document;
  const single = document.pages.length === 1 ? (document.pages[0] ?? null) : null;
  const style = printStyle({
    paper: options.paper,
    orientation: options.orientation,
    pageNumber: texts.pageNumber,
    footer: document.exported,
  });
  const table = contents(document, single);
  let body: string;
  if (single) {
    const content = `<div class="ld-content">${scoped(single.body, pagePrefix(0))}</div>${options.comments ? comments(single, texts) : ""}`;
    body = table
      ? `<section class="ld-front">${titleBlock(single)}${table}</section><article class="ld-print-page" id="${pageAnchor(single.id)}">${content}</article>`
      : `<article id="${pageAnchor(single.id)}"><div class="ld-front">${titleBlock(single)}</div>${content}</article>`;
  } else {
    const front = `<section class="ld-front"><p class="ld-path">${path(document.path)}</p><h1 class="ld-document-title">${escapeHtml(document.title)}</h1><p class="ld-meta">${escapeHtml(document.exported)}</p>${table}</section>`;
    const pages = document.pages.map(
      (page, index) =>
        `<article class="ld-print-page" id="${pageAnchor(page.id)}">${titleBlock(page)}<div class="ld-content">${scoped(page.body, pagePrefix(index))}</div>${options.comments ? comments(page, texts) : ""}</article>`,
    );
    body = `${front}${pages.join("")}`;
  }
  return `<!doctype html>\n<html lang="${escapeHtml(document.language)}">\n<head>\n<meta charset="utf-8">\n<title>${escapeHtml(document.title)}</title>\n<style>\n${style}\n</style>\n</head>\n<body>\n${body}${appendix(document)}\n</body>\n</html>\n`;
}
