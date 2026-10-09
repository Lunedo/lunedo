import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { initProseMirrorDoc, ySyncPlugin } from "@tiptap/y-tiptap";
import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { schemaExtensions } from "./schema/extensions.js";

const schema = getSchema(schemaExtensions());

const views: EditorView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

function connected(count: number): Y.Doc[] {
  const docs = Array.from({ length: count }, () => new Y.Doc());
  for (const doc of docs) {
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === "remote") return;
      for (const other of docs) if (other !== doc) Y.applyUpdate(other, update, "remote");
    });
  }
  return docs;
}

function paragraphs(doc: Y.Doc, texts: string[]): void {
  const fragment = doc.getXmlFragment("default");
  doc.transact(() => {
    fragment.insert(
      0,
      texts.map((text) => {
        const paragraph = new Y.XmlElement("paragraph");
        if (text) paragraph.insert(0, [new Y.XmlText(text)]);
        return paragraph;
      }),
    );
  });
}

function textAt(doc: Y.Doc, index: number): Y.XmlText {
  const paragraph = doc.getXmlFragment("default").get(index) as Y.XmlElement;
  let text = paragraph.get(0) as Y.XmlText | null;
  if (!text) {
    text = new Y.XmlText();
    paragraph.insert(0, [text]);
  }
  return text;
}

function editorOf(doc: Y.Doc): EditorView {
  const fragment = doc.getXmlFragment("default");
  const { doc: initial, mapping } = initProseMirrorDoc(fragment, schema);
  const view = new EditorView(document.createElement("div"), {
    state: EditorState.create({ schema, doc: initial, plugins: [ySyncPlugin(fragment, { mapping })] }),
  });
  views.push(view);
  return view;
}

function select(view: EditorView, anchor: number, head = anchor): void {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, anchor, head)));
}

function type(view: EditorView, text: string): void {
  view.dispatch(view.state.tr.insertText(text));
}

function texts(view: EditorView): string[] {
  const result: string[] = [];
  view.state.doc.forEach((node) => {
    result.push(node.textContent);
  });
  return result;
}

describe("the local selection after remote updates", () => {
  it("stays in its own paragraph when another person types into it and a similar paragraph exists", () => {
    const [own, other] = connected(2) as [Y.Doc, Y.Doc];
    paragraphs(own, ["Writer", "Writer 2 line 1"]);
    const view = editorOf(own);
    select(view, 1 + "Writer".length);
    textAt(other, 0).insert(0, "Ben: ");
    expect(view.state.selection.head).toBe(1 + "Ben: Writer".length);
    type(view, " 1");
    expect(texts(view)).toEqual(["Ben: Writer 1", "Writer 2 line 1"]);
  });

  it("keeps the order of typed characters while two others type in neighbouring paragraphs", () => {
    const [own, left, right] = connected(3) as [Y.Doc, Y.Doc, Y.Doc];
    paragraphs(own, ["Intro", "", "", ""]);
    const view = editorOf(own);
    select(view, view.state.doc.child(0).nodeSize + view.state.doc.child(1).nodeSize + 1);
    const line = "Writer 2 line 1";
    for (const [index, character] of [...line].entries()) {
      textAt(left, 1).insert(index, "Writer 1 line 1"[index] ?? "");
      textAt(right, 3).insert(index, "Writer 3 line 1"[index] ?? "");
      type(view, character);
    }
    expect(texts(view)).toEqual(["Intro", "Writer 1 line 1", line, "Writer 3 line 1"]);
  });

  it("keeps a fresh selection when another person types in the same paragraph", () => {
    const [own, other] = connected(2) as [Y.Doc, Y.Doc];
    paragraphs(own, ["Intro", "Writer 2 line 1", "Writer 2 line 1"]);
    const view = editorOf(own);
    const start = view.state.doc.child(0).nodeSize + 1;
    select(view, start + "Writer 2 line 1".length, start);
    textAt(other, 1).insert("Writer 2 line 1".length, " and more");
    expect(view.state.selection.from).toBe(start);
    expect(view.state.selection.to).toBe(start + "Writer 2 line 1".length);
    expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe(
      "Writer 2 line 1",
    );
  });
});
