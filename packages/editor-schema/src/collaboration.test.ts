import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  anchorAt,
  containsAnchor,
  type DocumentJson,
  editorSchemaVersion,
  extractInlineCommentThreads,
  extractTasks,
  MAX_COMMENT_BYTES,
  migrateDocument,
  migrations,
  type NodeJson,
  normalizeTaskIds,
  renderHtml,
  schema,
  validateComment,
  validateDocument,
  withInlineComment,
} from "./index.js";
import { applyDocument, documentFromYDoc, migrateYDoc, yDocFromDocument } from "./yjs.js";

const ANNA = "01929b1e-0000-7000-8000-000000000001";
const TASK = "01929b1e-0000-7000-8000-000000000101";
const OTHER_TASK = "01929b1e-0000-7000-8000-000000000102";
const THREAD = "01929b1e-0000-7000-8000-000000000201";
const SECOND_THREAD = "01929b1e-0000-7000-8000-000000000202";

function text(value: string, marks?: NodeJson["marks"]): NodeJson {
  return marks ? { type: "text", text: value, marks } : { type: "text", text: value };
}

function paragraph(...content: NodeJson[]): NodeJson {
  return { type: "paragraph", content };
}

function doc(...content: NodeJson[]): DocumentJson {
  return { type: "doc", content };
}

function task(id: string | null, label: string, attrs: Record<string, unknown> = {}): NodeJson {
  return { type: "taskItem", attrs: { id, ...attrs }, content: [paragraph(text(label))] };
}

function valid(document: unknown): DocumentJson {
  const result = validateDocument(document);
  if (!result.ok) throw new Error(JSON.stringify(result.problems));
  return result.document;
}

describe("migration from schema version 2", () => {
  it("drops the checked attribute of task items, as the status is stored apart from the content", () => {
    const stored: DocumentJson = doc({
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: true, assignee: ANNA, dueDate: "2026-10-12" },
          content: [paragraph(text("Ship"))],
        },
      ],
    });
    const migrated = migrateDocument(stored, 2, migrations, 3);
    expect(migrated.content?.[0]?.content?.[0]?.attrs).toEqual({ assignee: ANNA, dueDate: "2026-10-12" });
    expect(valid(migrated).content?.[0]?.content?.[0]?.attrs).toMatchObject({ id: null });
  });
});

describe("tasks", () => {
  it("extract their ID, assignee, due date and text, once per ID", () => {
    const document = doc({
      type: "taskList",
      content: [
        task(TASK, "Rotate the key", { assignee: ANNA, dueDate: "2026-10-12" }),
        task(TASK, "Copy of the same task"),
        task(null, "Without an ID"),
      ],
    });
    expect(extractTasks(document)).toEqual([
      { id: TASK, assignee: ANNA, dueDate: "2026-10-12", text: "Rotate the key", position: 0 },
    ]);
  });

  it("get new IDs when they have none, repeat another task's ID or use an ID taken elsewhere", () => {
    const ids = ["01929b1e-0000-7000-8000-000000000901", "01929b1e-0000-7000-8000-000000000902"];
    const document = doc({
      type: "taskList",
      content: [task(TASK, "First"), task(TASK, "Pasted copy"), task(OTHER_TASK, "From another page")],
    });
    const normalized = normalizeTaskIds(document, {
      newId: () => ids.shift() ?? "",
      taken: (id) => id === OTHER_TASK,
    });
    expect(extractTasks(normalized ?? document).map((entry) => entry.id)).toEqual([
      TASK,
      "01929b1e-0000-7000-8000-000000000901",
      "01929b1e-0000-7000-8000-000000000902",
    ]);
    expect(
      normalizeTaskIds(doc({ type: "taskList", content: [task(TASK, "Only")] }), { newId: () => "" }),
    ).toBe(null);
  });

  it("show the status from the status source in HTML", () => {
    const document = doc({ type: "taskList", content: [task(TASK, "Done"), task(OTHER_TASK, "Open")] });
    const html = renderHtml(document, { taskStatus: (id) => id === TASK });
    expect(html).toContain(`data-checked="true" data-task-id="${TASK}"`);
    expect(html).toContain(`data-checked="false" data-task-id="${OTHER_TASK}"`);
  });
});

describe("task report", () => {
  it("filters by one assignee or by the viewer, never both", () => {
    expect(
      validateDocument(doc({ type: "taskReport", attrs: { assignee: ANNA, assignedToViewer: true } })).ok,
    ).toBe(false);
    expect(
      validateDocument(doc({ type: "taskReport", attrs: { assignedToViewer: true, due: "overdue" } })).ok,
    ).toBe(true);
    expect(validateDocument(doc({ type: "taskReport", attrs: { status: "late" } })).ok).toBe(false);
  });
});

describe("comment content", () => {
  it("allows text with marks, links, mentions, inline code, code blocks and lists", () => {
    const comment = doc(
      paragraph(
        text("Bold", [{ type: "bold" }]),
        text(" and "),
        text("code", [{ type: "code" }]),
        text(" "),
        text("link", [{ type: "link", attrs: { href: "https://example.org" } }]),
        { type: "mention", attrs: { id: ANNA } },
      ),
      { type: "bulletList", content: [{ type: "listItem", content: [paragraph(text("Item"))] }] },
      { type: "codeBlock", attrs: { language: "bash" }, content: [text("ls")] },
    );
    expect(validateComment(comment)).toMatchObject({ ok: true });
  });

  it("refuses tables, images, headings, colors and empty comments", () => {
    const codes = (comment: unknown) => {
      const result = validateComment(comment);
      return result.ok ? [] : result.problems.map((problem) => problem.code);
    };
    expect(codes(doc({ type: "heading", attrs: { level: 1 }, content: [text("H")] }))).toContain(
      "unknownNode",
    );
    expect(codes(doc({ type: "table", content: [] }))).toContain("unknownNode");
    expect(codes(doc({ type: "image", attrs: { attachmentId: ANNA } }))).toContain("unknownNode");
    expect(codes(doc(paragraph(text("red", [{ type: "textColor", attrs: { color: "red" } }]))))).toContain(
      "unknownMark",
    );
    expect(codes(doc(paragraph(text(" "))))).toContain("invalidContent");
    expect(codes(doc(paragraph(text("x".repeat(MAX_COMMENT_BYTES)))))).toContain("tooLarge");
  });
});

describe("inline comment anchors", () => {
  const document = valid(
    doc(
      paragraph(text("Hotel Wi-Fi blocks UDP. "), text("Hotel Wi-Fi", [{ type: "bold" }]), text(" is slow.")),
      paragraph(text("Use TCP 443 from hotels.")),
    ),
  );

  it("mark the text that best matches the quote and its context", () => {
    const marked = withInlineComment(
      document,
      { exact: "Hotel Wi-Fi", prefix: "UDP. ", suffix: " is" },
      THREAD,
    );
    expect(marked).not.toBeNull();
    expect(extractInlineCommentThreads(marked as DocumentJson)).toEqual(new Map([[THREAD, "Hotel Wi-Fi"]]));
    const second = marked?.content?.[0]?.content?.[1];
    expect(second?.marks?.map((mark) => mark.type)).toEqual(["bold", "inlineComment"]);
  });

  it("let two threads cover the same text", () => {
    const anchor = { exact: "TCP 443", prefix: "Use ", suffix: " from" };
    const first = withInlineComment(document, anchor, THREAD) as DocumentJson;
    const both = withInlineComment(first, anchor, SECOND_THREAD) as DocumentJson;
    expect(valid(both)).toEqual(both);
    expect([...extractInlineCommentThreads(both).keys()]).toEqual([THREAD, SECOND_THREAD]);
    const ydoc = yDocFromDocument(both);
    expect([...extractInlineCommentThreads(valid(documentFromYDoc(ydoc))).keys()]).toEqual([
      THREAD,
      SECOND_THREAD,
    ]);
  });

  it("keep the mark when someone else edits around it, and lose it when the text is deleted", () => {
    const marked = withInlineComment(
      document,
      { exact: "TCP 443", prefix: "", suffix: "" },
      THREAD,
    ) as DocumentJson;
    const left = yDocFromDocument(marked);
    const right = new Y.Doc();
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
    applyDocument(
      right,
      doc(
        paragraph(text("Intro. Hotel Wi-Fi blocks UDP. Hotel Wi-Fi is slow.")),
        paragraph(
          text("Use "),
          text("TCP 443", marked.content?.[1]?.content?.[1]?.marks),
          text(" from all hotels."),
        ),
      ),
    );
    Y.applyUpdate(left, Y.encodeStateAsUpdate(right, Y.encodeStateVector(left)));
    expect(extractInlineCommentThreads(valid(documentFromYDoc(left))).get(THREAD)).toBe("TCP 443");
    applyDocument(right, doc(paragraph(text("Everything was rewritten."))));
    Y.applyUpdate(left, Y.encodeStateAsUpdate(right, Y.encodeStateVector(left)));
    expect(extractInlineCommentThreads(valid(documentFromYDoc(left))).has(THREAD)).toBe(false);
  });

  it("are found again from a selection and refused when empty or missing", () => {
    const node = schema.nodeFromJSON(document);
    const anchor = anchorAt(node, 7, 13);
    expect(anchor).toEqual({ exact: "Wi-Fi ", prefix: "Hotel ", suffix: "blocks UDP. Hotel Wi-Fi is slow." });
    expect(containsAnchor(document, anchor ?? { exact: "", prefix: "", suffix: "" })).toBe(true);
    expect(containsAnchor(document, { exact: "Satellite", prefix: "", suffix: "" })).toBe(false);
    expect(withInlineComment(document, { exact: "   ", prefix: "", suffix: "" }, THREAD)).toBeNull();
  });
});

describe("stored collaborative state of schema version 2", () => {
  it("is migrated in place, so a task's old checked attribute no longer fails validation", () => {
    const ydoc = new Y.Doc();
    const fragment = ydoc.getXmlFragment("default");
    const list = new Y.XmlElement("taskList");
    const item = new Y.XmlElement("taskItem");
    const block = new Y.XmlElement("paragraph");
    block.insert(0, [new Y.XmlText("Ship")]);
    item.insert(0, [block]);
    item.setAttribute("checked", true as unknown as string);
    list.insert(0, [item]);
    fragment.insert(0, [list]);
    expect(validateDocument(documentFromYDoc(ydoc)).ok).toBe(false);
    expect(migrateYDoc(ydoc, 2)).toBe(true);
    expect(validateDocument(documentFromYDoc(ydoc)).ok).toBe(true);
    expect(migrateYDoc(ydoc, editorSchemaVersion)).toBe(false);
  });
});
