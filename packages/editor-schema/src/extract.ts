import type { DocumentJson, NodeJson } from "./json.js";
import type { PageLinkTarget } from "./module.js";

const encoder = new TextEncoder();

function visit(node: NodeJson, callback: (node: NodeJson) => void): void {
  callback(node);
  for (const child of node.content ?? []) visit(child, callback);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function roadmapPages(node: NodeJson): string[] {
  const roadmap = node.attrs?.roadmap as { lanes?: { bars?: { pageId?: unknown }[] }[] } | undefined;
  return (roadmap?.lanes ?? []).flatMap((lane) =>
    (lane.bars ?? []).flatMap((bar) => (typeof bar.pageId === "string" ? [bar.pageId] : [])),
  );
}

export function extractPageLinks(doc: DocumentJson): PageLinkTarget[] {
  const links: PageLinkTarget[] = [];
  visit(doc, (node) => {
    if (node.type === "roadmap") {
      for (const pageId of roadmapPages(node)) links.push({ pageId, spaceId: null, title: null });
      return;
    }
    if (node.type !== "pageLink") return;
    links.push({
      pageId: stringOrNull(node.attrs?.pageId),
      spaceId: stringOrNull(node.attrs?.spaceId),
      title: stringOrNull(node.attrs?.title),
    });
  });
  return links;
}

export function extractMentions(doc: DocumentJson): string[] {
  const ids = new Set<string>();
  visit(doc, (node) => {
    const id = node.type === "mention" ? stringOrNull(node.attrs?.id) : null;
    if (id) ids.add(id);
  });
  return [...ids];
}

export function documentSize(doc: unknown): number {
  return encoder.encode(JSON.stringify(doc)).length;
}

export function emptyDocument(): DocumentJson {
  return { type: "doc", content: [{ type: "paragraph", attrs: { textAlign: "left", indent: 0 } }] };
}

export interface ExtractedTask {
  id: string;
  assignee: string | null;
  dueDate: string | null;
  text: string;
  position: number;
}

function inlineText(node: NodeJson): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "taskList") return "";
  if (node.type === "hardBreak") return " ";
  return (node.content ?? []).map(inlineText).join("");
}

export function extractTasks(doc: DocumentJson): ExtractedTask[] {
  const tasks: ExtractedTask[] = [];
  const seen = new Set<string>();
  visit(doc, (node) => {
    if (node.type !== "taskItem") return;
    const id = stringOrNull(node.attrs?.id);
    if (!id || seen.has(id)) return;
    seen.add(id);
    tasks.push({
      id,
      assignee: stringOrNull(node.attrs?.assignee),
      dueDate: stringOrNull(node.attrs?.dueDate),
      text: (node.content ?? []).map(inlineText).join(" ").replace(/\s+/g, " ").trim().slice(0, 500),
      position: tasks.length,
    });
  });
  return tasks;
}

export function extractInlineCommentThreads(doc: DocumentJson): Map<string, string> {
  const threads = new Map<string, string>();
  visit(doc, (node) => {
    for (const mark of node.marks ?? []) {
      const threadId = mark.type === "inlineComment" ? stringOrNull(mark.attrs?.threadId) : null;
      if (threadId) threads.set(threadId, `${threads.get(threadId) ?? ""}${node.text ?? ""}`);
    }
  });
  return threads;
}

export interface ExtractedTopicUpdate {
  topicId: string;
  content: NodeJson[];
  text: string;
  position: number;
}

export function extractTopicUpdates(doc: DocumentJson): ExtractedTopicUpdate[] {
  const updates = new Map<string, ExtractedTopicUpdate>();
  visit(doc, (node) => {
    if (node.type !== "topicUpdate") return;
    const topicId = stringOrNull(node.attrs?.topicId);
    if (!topicId) return;
    const content = node.content ?? [];
    const existing = updates.get(topicId);
    if (existing) {
      existing.content = [...existing.content, ...content];
      existing.text = `${existing.text} ${content.map(blockText).join(" ")}`.trim().slice(0, 2000);
      return;
    }
    updates.set(topicId, {
      topicId,
      content,
      text: content.map(blockText).join(" ").replace(/\s+/g, " ").trim().slice(0, 2000),
      position: updates.size,
    });
  });
  return [...updates.values()];
}

export interface ExtractedDecision {
  id: string;
  topicId: string | null;
  statement: NodeJson[];
  text: string;
  position: number;
}

export function extractDecisions(doc: DocumentJson): ExtractedDecision[] {
  const decisions: ExtractedDecision[] = [];
  const seen = new Set<string>();
  visit(doc, (node) => {
    if (node.type !== "decision") return;
    const id = stringOrNull(node.attrs?.id);
    if (!id || seen.has(id)) return;
    seen.add(id);
    const statement = node.content ?? [];
    if (statement.every((block) => (block.content ?? []).length === 0)) return;
    decisions.push({
      id,
      topicId: stringOrNull(node.attrs?.topicId),
      statement,
      text: statement.map(blockText).join(" ").replace(/\s+/g, " ").trim().slice(0, 2000),
      position: decisions.length,
    });
  });
  return decisions;
}

function blockText(node: NodeJson): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return " ";
  return (node.content ?? []).map(blockText).join(" ");
}

function normalizeIds(
  doc: DocumentJson,
  type: string,
  options: { newId: () => string; taken?: (id: string) => boolean },
): DocumentJson | null {
  const used = new Set<string>();
  let changed = false;
  const rewrite = (node: NodeJson): NodeJson => {
    let result = node;
    if (node.type === type) {
      const id = stringOrNull(node.attrs?.id);
      if (!id || used.has(id) || options.taken?.(id)) {
        const next = options.newId();
        used.add(next);
        changed = true;
        result = { ...node, attrs: { ...node.attrs, id: next } };
      } else {
        used.add(id);
      }
    }
    return result.content ? { ...result, content: result.content.map(rewrite) } : result;
  };
  const document = rewrite(doc) as DocumentJson;
  return changed ? document : null;
}

export function normalizeTaskIds(
  doc: DocumentJson,
  options: { newId: () => string; taken?: (id: string) => boolean },
): DocumentJson | null {
  return normalizeIds(doc, "taskItem", options);
}

export function normalizeDecisionIds(
  doc: DocumentJson,
  options: { newId: () => string; taken?: (id: string) => boolean },
): DocumentJson | null {
  return normalizeIds(doc, "decision", options);
}
