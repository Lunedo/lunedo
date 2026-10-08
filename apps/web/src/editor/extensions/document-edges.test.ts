import { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";
import { schemaExtensions } from "../schema/extensions.js";
import { DocumentEdges } from "./document-edges.js";

const content = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "placeholder", attrs: { text: "State the goal" } }] },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            {
              type: "tableHeader",
              content: [{ type: "paragraph", content: [{ type: "text", text: "Time" }] }],
            },
          ],
        },
      ],
    },
    { type: "paragraph", content: [{ type: "text", text: "Last line" }] },
  ],
};

describe("moving to the edges of the document", () => {
  let editor: Editor | undefined;

  afterEach(() => editor?.destroy());

  function press(key: string, setup: (editor: Editor) => void) {
    editor = new Editor({ extensions: [...schemaExtensions(), DocumentEdges], content });
    setup(editor);
    const view = editor.view;
    const event = new KeyboardEvent("keydown", {
      key: key.endsWith("Home") ? "Home" : "End",
      ctrlKey: true,
      shiftKey: key.startsWith("Shift"),
    });
    view.someProp("handleKeyDown", (handler) => handler(view, event));
    return editor.state.selection;
  }

  it("jumps from an instruction to the end of the document", () => {
    const selection = press("Mod-End", (current) =>
      current.view.dispatch(current.state.tr.setSelection(NodeSelection.create(current.state.doc, 1))),
    );
    expect(editor?.state.doc.resolve(selection.from).parent.textContent).toBe("Last line");
  });

  it("jumps from a table cell to the end and back to the start", () => {
    const fromCell = press("Mod-End", (current) => {
      let inside = 0;
      current.state.doc.descendants((node, offset) => {
        if (node.isText && node.text === "Time") inside = offset + 2;
      });
      current.view.dispatch(current.state.tr.setSelection(TextSelection.create(current.state.doc, inside)));
    });
    expect(editor?.state.doc.resolve(fromCell.from).parent.textContent).toBe("Last line");
    const view = editor?.view;
    if (!view) throw new Error("No editor");
    view.someProp("handleKeyDown", (handler) =>
      handler(view, new KeyboardEvent("keydown", { key: "Home", ctrlKey: true })),
    );
    expect(editor?.state.selection.from).toBe(1);
  });

  it("extends the selection to the end with Shift", () => {
    const selection = press("Shift-Mod-End", (current) =>
      current.view.dispatch(current.state.tr.setSelection(TextSelection.create(current.state.doc, 1))),
    );
    expect(selection.from).toBe(1);
    expect(selection.to).toBe((editor?.state.doc.content.size ?? 0) - 1);
  });
});
