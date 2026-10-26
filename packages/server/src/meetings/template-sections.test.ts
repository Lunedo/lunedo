import type { DocumentJson, NodeJson } from "@lunedo/editor-schema";
import { describe, expect, it } from "vitest";
import { withoutTemplateSections } from "./template-sections.js";

function hint(text: string): NodeJson {
  return { type: "paragraph", content: [{ type: "placeholder", attrs: { text } }] };
}

function section(key: string, ...content: NodeJson[]): NodeJson {
  return { type: "section", attrs: { key, title: key }, content };
}

function list(type: string, ...items: NodeJson[]): NodeJson {
  return { type, content: items.map((item) => ({ type: "listItem", content: [item] })) };
}

const written: NodeJson = { type: "paragraph", content: [{ type: "text", text: "Switch replaced" }] };
const update: NodeJson = { type: "topicUpdate", attrs: { topicId: "t" }, content: [{ type: "paragraph" }] };
const date: NodeJson = { type: "paragraph", content: [{ type: "text", text: "26.10.2026" }] };

describe("template sections of meeting pages", () => {
  it("removes headings and lists that are still exactly as the template created them", () => {
    const document: DocumentJson = {
      type: "doc",
      content: [
        date,
        section("agenda", list("bulletList", hint("One item per topic"))),
        section("runningTopics", hint("Topics stay open"), update),
        section("openTasks", { type: "taskReport", attrs: { status: "open", seriesId: "s" } }),
        section("newTasks", hint("Add each task")),
        section("decisions", hint("Record each decision")),
        section("notes", hint("Everything else"), { type: "paragraph" }),
        section("feedback", hint("Both directions")),
      ],
    };
    expect(withoutTemplateSections(document)?.content).toEqual([
      date,
      section("runningTopics", hint("Topics stay open"), update),
      section("feedback", hint("Both directions")),
    ]);
  });

  it("keeps every section someone wrote into and leaves a page without them unchanged", () => {
    const document: DocumentJson = {
      type: "doc",
      content: [
        section("agenda", list("bulletList", written)),
        section("newTasks", hint("Add each task"), { type: "taskList", content: [] }, written),
        section("notes", written),
        section("decisions", { type: "decision", attrs: { id: "d" }, content: [written] }),
      ],
    };
    expect(withoutTemplateSections(document)).toBeNull();
    expect(withoutTemplateSections({ type: "doc", content: [written] })).toBeNull();
  });

  it("leaves an empty paragraph when nothing else remains", () => {
    expect(
      withoutTemplateSections({ type: "doc", content: [section("notes", hint("Everything else"))] }),
    ).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });
});
