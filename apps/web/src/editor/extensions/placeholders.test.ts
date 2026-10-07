import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import { schemaExtensions } from "../schema/extensions.js";
import { TemplatePlaceholders } from "./placeholders.js";

const content = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "placeholder", attrs: { text: "Describe the goal" } }] },
    { type: "paragraph", content: [{ type: "text", text: "Keep " }, { type: "placeholder", attrs: { text: "Other" } }] },
  ],
};

describe("template placeholders", () => {
  let editor: Editor | undefined;

  afterEach(() => editor?.destroy());

  function type(text: string, position: number, extensions = [TemplatePlaceholders]) {
    editor = new Editor({ extensions: [...schemaExtensions(), ...extensions], content });
    const view = editor.view;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position)));
    const handled = view.someProp("handleTextInput", (handler) => handler(view, position, position, text, () => view.state.tr));
    if (!handled) view.dispatch(view.state.tr.insertText(text, position, position));
    return editor.getJSON();
  }

  it("disappear when the person starts typing in their paragraph", () => {
    const result = type("Ship it", 1);
    expect(result.content?.[0]).toEqual({
      type: "paragraph",
      attrs: { textAlign: "left", indent: 0 },
      content: [{ type: "text", text: "Ship it" }],
    });
    expect(JSON.stringify(result.content?.[1])).toContain("Other");
  });

  it("stay without the extension", () => {
    expect(JSON.stringify(type("Ship it", 1, []))).toContain("Describe the goal");
  });
});
