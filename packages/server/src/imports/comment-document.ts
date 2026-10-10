import {
  anchorAt,
  type DocumentJson,
  MAX_QUOTE_LENGTH,
  type MarkJson,
  type NodeJson,
  schema,
  type TextAnchor,
  validateComment,
} from "@pagehall/editor-schema";

const COMMENT_MARKS = new Set([
  "bold",
  "italic",
  "underline",
  "strike",
  "subscript",
  "superscript",
  "code",
  "link",
]);
const FALLBACK_TEXT = "…";

function text(value: string, marks?: readonly MarkJson[]): NodeJson[] {
  if (value.length === 0) return [];
  return [
    marks && marks.length > 0
      ? { type: "text", text: value, marks: [...marks] }
      : { type: "text", text: value },
  ];
}

function inline(nodes: readonly NodeJson[] | undefined): NodeJson[] {
  const result: NodeJson[] = [];
  for (const node of nodes ?? []) {
    switch (node.type) {
      case "text": {
        const marks = (node.marks ?? []).filter((mark) => COMMENT_MARKS.has(mark.type));
        const hasCode = marks.some((mark) => mark.type === "code");
        result.push(
          ...text(
            typeof node.text === "string" ? node.text : "",
            hasCode ? marks.filter((mark) => mark.type === "code" || mark.type === "link") : marks,
          ),
        );
        break;
      }
      case "hardBreak":
        result.push({ type: "hardBreak" });
        break;
      case "mention":
        result.push({ type: "mention", attrs: { ...node.attrs } });
        break;
      case "emoji":
        result.push(...text(String(node.attrs?.emoji ?? "")));
        break;
      case "date":
        result.push(...text(String(node.attrs?.date ?? "")));
        break;
      case "status":
        result.push(...text(String(node.attrs?.label ?? node.attrs?.text ?? "")));
        break;
      default:
        result.push(...inline(node.content));
    }
  }
  return result;
}

function blocks(nodes: readonly NodeJson[] | undefined): NodeJson[] {
  const result: NodeJson[] = [];
  for (const node of nodes ?? []) {
    switch (node.type) {
      case "paragraph":
      case "heading": {
        const content = inline(node.content);
        result.push(content.length > 0 ? { type: "paragraph", content } : { type: "paragraph" });
        break;
      }
      case "codeBlock": {
        const value = (node.content ?? [])
          .map((child) => (typeof child.text === "string" ? child.text : ""))
          .join("");
        result.push(value.length > 0 ? { type: "codeBlock", content: text(value) } : { type: "codeBlock" });
        break;
      }
      case "bulletList":
      case "orderedList": {
        const items = (node.content ?? []).map((item) => {
          const content = blocks(item.content);
          return {
            type: "listItem",
            content: content[0]?.type === "paragraph" ? content : [{ type: "paragraph" }, ...content],
          } satisfies NodeJson;
        });
        if (items.length > 0) result.push({ type: node.type, content: items });
        break;
      }
      default:
        if (node.content) {
          const nested = blocks(node.content);
          if (nested.length > 0) result.push(...nested);
          else {
            const content = inline(node.content);
            if (content.length > 0) result.push({ type: "paragraph", content });
          }
        }
    }
  }
  return result;
}

function plainParagraphs(document: DocumentJson): DocumentJson {
  const lines: string[] = [];
  const walk = (node: NodeJson) => {
    if (typeof node.text === "string") lines.push(node.text);
    for (const child of node.content ?? []) walk(child);
  };
  walk(document as NodeJson);
  const value = lines.join(" ").replace(/\s+/g, " ").trim() || FALLBACK_TEXT;
  return { type: "doc", content: [{ type: "paragraph", content: text(value) }] };
}

export function toCommentDocument(document: DocumentJson, quote: string | null = null): DocumentJson {
  const content = blocks((document as NodeJson).content);
  if (quote) {
    content.unshift({
      type: "paragraph",
      content: text(`“${quote.slice(0, MAX_QUOTE_LENGTH)}”`, [{ type: "italic" }]),
    });
  }
  const candidate: DocumentJson = {
    type: "doc",
    content: content.length > 0 ? content : [{ type: "paragraph" }],
  };
  const validated = validateComment(candidate);
  if (validated.ok) return validated.document;
  const fallback = plainParagraphs(candidate);
  const second = validateComment(fallback);
  if (second.ok) return second.document;
  return { type: "doc", content: [{ type: "paragraph", content: text(FALLBACK_TEXT) }] };
}

export function threadAnchor(document: DocumentJson, threadId: string): TextAnchor | null {
  const doc = schema.nodeFromJSON(document);
  let from = -1;
  let to = -1;
  doc.descendants((node, position) => {
    if (from !== -1 && to !== -1 && position > to) return false;
    if (!node.isText) return true;
    const marked = node.marks.some(
      (mark) => mark.type.name === "inlineComment" && mark.attrs.threadId === threadId,
    );
    if (marked) {
      if (from === -1) from = position;
      if (to === -1 || to === position) to = position + node.nodeSize;
    }
    return true;
  });
  if (from === -1) return null;
  return anchorAt(doc, from, to);
}

export function withoutThreads(document: DocumentJson, threadIds: ReadonlySet<string>): DocumentJson {
  if (threadIds.size === 0) return document;
  const strip = (node: NodeJson): NodeJson => {
    const next: NodeJson = { ...node };
    if (node.marks) {
      const marks = node.marks.filter(
        (mark) => !(mark.type === "inlineComment" && threadIds.has(String(mark.attrs?.threadId ?? ""))),
      );
      if (marks.length > 0) next.marks = marks;
      else delete next.marks;
    }
    if (node.content) next.content = node.content.map(strip);
    return next;
  };
  return strip(document as NodeJson) as DocumentJson;
}
