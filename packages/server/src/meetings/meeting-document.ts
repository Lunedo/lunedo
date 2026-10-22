import type { DocumentJson, NodeJson } from "@lunedo/editor-schema";

export const RUNNING_TOPICS_SECTION = "runningTopics";
export const OPEN_TASKS_SECTION = "openTasks";

export interface SectionTitles {
  runningTopics: string;
  openTasks: string;
}

function emptyParagraph(): NodeJson {
  return { type: "paragraph" };
}

export function topicUpdateBlock(topicId: string): NodeJson {
  return { type: "topicUpdate", attrs: { topicId }, content: [emptyParagraph()] };
}

function isEmptyBlock(node: NodeJson): boolean {
  if (node.type === "paragraph") return (node.content ?? []).length === 0;
  if (node.type === "placeholder") return true;
  return false;
}

function isEmptyUpdate(node: NodeJson): boolean {
  return node.type === "topicUpdate" && (node.content ?? []).every(isEmptyBlock);
}

function isPlaceholderOnly(node: NodeJson): boolean {
  return (
    node.type === "paragraph" &&
    (node.content ?? []).length > 0 &&
    (node.content ?? []).every((child) => child.type === "placeholder")
  );
}

function mapSection(
  document: DocumentJson,
  key: string,
  change: (section: NodeJson) => NodeJson,
): { document: DocumentJson; found: boolean } {
  let found = false;
  const visit = (node: NodeJson): NodeJson => {
    if (!found && node.type === "section" && node.attrs?.key === key) {
      found = true;
      return change(node);
    }
    return node.content ? { ...node, content: node.content.map(visit) } : node;
  };
  return { document: visit(document) as DocumentJson, found };
}

function appendSection(
  document: DocumentJson,
  key: string,
  title: string,
  content: NodeJson[],
): DocumentJson {
  return {
    ...document,
    content: [...(document.content ?? []), { type: "section", attrs: { key, title }, content }],
  };
}

function topicIdsIn(node: NodeJson, ids: Set<string> = new Set()): Set<string> {
  if (node.type === "topicUpdate" && typeof node.attrs?.topicId === "string") ids.add(node.attrs.topicId);
  for (const child of node.content ?? []) topicIdsIn(child, ids);
  return ids;
}

export function addTopicUpdates(
  document: DocumentJson,
  topicIds: readonly string[],
  titles: SectionTitles,
): DocumentJson {
  const present = topicIdsIn(document);
  const missing = topicIds.filter((id) => !present.has(id));
  if (missing.length === 0) return document;
  const blocks = missing.map(topicUpdateBlock);
  const placed = mapSection(document, RUNNING_TOPICS_SECTION, (section) => {
    const kept = (section.content ?? []).filter((node) => !isPlaceholderOnly(node));
    return { ...section, content: [...kept, ...blocks] };
  });
  return placed.found
    ? placed.document
    : appendSection(document, RUNNING_TOPICS_SECTION, titles.runningTopics, blocks);
}

export function removeEmptyTopicUpdate(document: DocumentJson, topicId: string): DocumentJson | null {
  let removed = false;
  const visit = (node: NodeJson): NodeJson => {
    if (!node.content) return node;
    const content = node.content.filter((child) => {
      const drop = child.type === "topicUpdate" && child.attrs?.topicId === topicId && isEmptyUpdate(child);
      if (drop) removed = true;
      return !drop;
    });
    const mapped = content.map(visit);
    if (node.type === "section" && mapped.length === 0) return { ...node, content: [emptyParagraph()] };
    return { ...node, content: mapped };
  };
  const result = visit(document) as DocumentJson;
  return removed ? result : null;
}

export function withSeriesTaskReport(
  document: DocumentJson,
  seriesId: string,
  titles: SectionTitles,
): DocumentJson {
  let reports = 0;
  const visit = (node: NodeJson): NodeJson => {
    if (node.type === "taskReport") {
      reports += 1;
      return { ...node, attrs: { ...node.attrs, seriesId, spaceId: null, status: "open" } };
    }
    return node.content ? { ...node, content: node.content.map(visit) } : node;
  };
  const updated = visit(document) as DocumentJson;
  if (reports > 0) return updated;
  const report: NodeJson = { type: "taskReport", attrs: { seriesId, status: "open" } };
  const placed = mapSection(updated, OPEN_TASKS_SECTION, (section) => ({
    ...section,
    content: [...(section.content ?? []).filter((node) => !isPlaceholderOnly(node)), report],
  }));
  return placed.found
    ? placed.document
    : appendSection(updated, OPEN_TASKS_SECTION, titles.openTasks, [report]);
}

export function addDecision(
  document: DocumentJson,
  decision: { id: string; topicId: string; statement: NodeJson[] },
): DocumentJson {
  const block: NodeJson = {
    type: "decision",
    attrs: { id: decision.id, topicId: decision.topicId },
    content: decision.statement.length > 0 ? decision.statement : [emptyParagraph()],
  };
  let placed = false;
  const visit = (node: NodeJson): NodeJson => {
    if (!node.content) return node;
    const content: NodeJson[] = [];
    for (const child of node.content) {
      content.push(visit(child));
      if (!placed && child.type === "topicUpdate" && child.attrs?.topicId === decision.topicId) {
        content.push(block);
        placed = true;
      }
    }
    return { ...node, content };
  };
  const result = visit(document) as DocumentJson;
  return placed ? result : { ...result, content: [...(result.content ?? []), block] };
}

export function withoutStableIds(document: DocumentJson): DocumentJson {
  const visit = (node: NodeJson): NodeJson => {
    const attrs =
      (node.type === "taskItem" || node.type === "decision") && node.attrs
        ? { ...node.attrs, id: null }
        : node.attrs;
    const next = attrs === node.attrs ? node : { ...node, attrs };
    return next.content ? { ...next, content: next.content.map(visit) } : next;
  };
  return visit(document) as DocumentJson;
}
