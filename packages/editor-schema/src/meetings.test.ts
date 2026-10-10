import { describe, expect, it } from "vitest";
import {
  type DocumentJson,
  extractDecisions,
  extractTopicUpdates,
  migrateDocument,
  type NodeJson,
  normalizeDecisionIds,
  renderHtml,
  renderMarkdown,
  validateDocument,
} from "./index.js";

const TOPIC = "01929b1e-0000-7000-8000-000000000101";
const OTHER_TOPIC = "01929b1e-0000-7000-8000-000000000102";
const DECISION = "01929b1e-0000-7000-8000-000000000201";

function paragraph(text: string): NodeJson {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function doc(...content: NodeJson[]): DocumentJson {
  return { type: "doc", content };
}

function update(topicId: string, ...content: NodeJson[]): NodeJson {
  return { type: "topicUpdate", attrs: { topicId }, content };
}

function decision(id: string | null, text: string, topicId: string | null = null): NodeJson {
  return { type: "decision", attrs: { id, topicId }, content: [paragraph(text)] };
}

describe("topic updates", () => {
  it("need a topic ID and block content", () => {
    expect(validateDocument(doc(update(TOPIC, paragraph("In progress.")))).ok).toBe(true);
    expect(validateDocument(doc({ type: "topicUpdate", attrs: {}, content: [paragraph("x")] })).ok).toBe(
      false,
    );
    expect(validateDocument(doc({ type: "topicUpdate", attrs: { topicId: "not-a-uuid" } })).ok).toBe(false);
    expect(validateDocument(doc({ type: "topicUpdate", attrs: { topicId: TOPIC }, content: [] })).ok).toBe(
      false,
    );
  });

  it("are extracted per topic in document order, with their content and plain text", () => {
    const document = doc(
      paragraph("Intro"),
      update(OTHER_TOPIC, paragraph("Second topic.")),
      update(TOPIC, paragraph("HR and IT   define one key."), paragraph("Draft is with HR.")),
    );
    expect(extractTopicUpdates(document)).toEqual([
      {
        topicId: OTHER_TOPIC,
        content: [paragraph("Second topic.")],
        text: "Second topic.",
        position: 0,
      },
      {
        topicId: TOPIC,
        content: [paragraph("HR and IT   define one key."), paragraph("Draft is with HR.")],
        text: "HR and IT define one key. Draft is with HR.",
        position: 1,
      },
    ]);
  });

  it("of the same topic twice in one page are joined into one update", () => {
    const document = doc(update(TOPIC, paragraph("First.")), update(TOPIC, paragraph("Second.")));
    const [only] = extractTopicUpdates(document);
    expect(extractTopicUpdates(document)).toHaveLength(1);
    expect(only?.content).toEqual([paragraph("First."), paragraph("Second.")]);
    expect(only?.text).toBe("First. Second.");
  });

  it("render the topic title from the context, and a neutral label without it", () => {
    const document = doc(update(TOPIC, paragraph("Update.")));
    expect(
      renderHtml(document, { topic: (id) => (id === TOPIC ? { title: "Positions in AD" } : null) }),
    ).toContain("Positions in AD");
    expect(renderHtml(document)).toContain("Topic");
    expect(renderMarkdown(document)).toContain("**Topic**");
  });
});

describe("decisions", () => {
  it("hold their statement as paragraphs with an optional ID and topic", () => {
    expect(validateDocument(doc(decision(DECISION, "Ship it.", TOPIC))).ok).toBe(true);
    expect(validateDocument(doc(decision(null, "Ship it."))).ok).toBe(true);
    expect(
      validateDocument(
        doc({
          type: "decision",
          attrs: { id: DECISION },
          content: [{ type: "heading", attrs: { level: 2 } }],
        }),
      ).ok,
    ).toBe(false);
    expect(
      validateDocument(doc({ type: "decision", attrs: { id: "DEC-1" }, content: [paragraph("x")] })).ok,
    ).toBe(false);
  });

  it("are extracted once per ID with topic, statement and text", () => {
    const document = doc(decision(DECISION, "Laptops get BitLocker.", TOPIC), decision(DECISION, "Copy"));
    expect(extractDecisions(document)).toEqual([
      {
        id: DECISION,
        topicId: TOPIC,
        statement: [paragraph("Laptops get BitLocker.")],
        text: "Laptops get BitLocker.",
        position: 0,
      },
    ]);
  });

  it("are not extracted while their statement is empty, so reports and overviews leave them out", () => {
    const empty = "01929b1e-0000-7000-8000-000000000202";
    const document = doc(
      { type: "decision", attrs: { id: empty }, content: [{ type: "paragraph" }, { type: "paragraph" }] },
      decision(DECISION, "Laptops get BitLocker."),
    );
    expect(validateDocument(document).ok).toBe(true);
    expect(extractDecisions(document).map((found) => [found.id, found.position])).toEqual([[DECISION, 0]]);
    expect(
      extractDecisions(
        doc({
          type: "decision",
          attrs: { id: empty },
          content: [{ type: "paragraph", content: [{ type: "mention", attrs: { id: TOPIC } }] }],
        }),
      ).map((found) => found.id),
    ).toEqual([empty]);
  });

  it("get new IDs when they have none, repeat another decision's ID or use an ID taken elsewhere", () => {
    const fresh = ["01929b1e-0000-7000-8000-000000000901", "01929b1e-0000-7000-8000-000000000902"];
    const taken = "01929b1e-0000-7000-8000-000000000301";
    const document = doc(
      decision(DECISION, "First"),
      decision(DECISION, "Pasted"),
      decision(taken, "Elsewhere"),
    );
    const normalized = normalizeDecisionIds(document, {
      newId: () => fresh.shift() ?? "",
      taken: (id) => id === taken,
    });
    expect(normalized?.content?.map((node) => node.attrs?.id)).toEqual([
      DECISION,
      "01929b1e-0000-7000-8000-000000000901",
      "01929b1e-0000-7000-8000-000000000902",
    ]);
    expect(normalizeDecisionIds(doc(decision(DECISION, "Only")), { newId: () => "" })).toBeNull();
  });
});

describe("migration from schema version 3", () => {
  it("keeps documents unchanged, as version 4 only adds nodes and an attribute", () => {
    const stored = doc(paragraph("Unchanged"), {
      type: "taskReport",
      attrs: { spaceId: null, assignee: null, assignedToViewer: false, due: "any", status: "open" },
    });
    const migrated = migrateDocument(stored, 3);
    expect(migrated).toEqual(stored);
    const result = validateDocument(migrated);
    expect(result.ok && result.document.content?.[1]?.attrs?.seriesId).toBeNull();
  });
});
