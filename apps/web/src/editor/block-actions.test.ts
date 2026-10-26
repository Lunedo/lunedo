import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { deleteBlock, duplicateBlock, insertBlockBelow } from "./block-gutter.js";
import { addTaskAtEnd, TaskListAdd } from "./extensions/task-list-add.js";
import { schemaExtensions } from "./schema/extensions.js";
import { runInCell } from "./table-controls.js";

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });

describe("block actions in the editor", () => {
  let editor: Editor | undefined;
  afterEach(() => editor?.destroy());

  function open(content: JSONContent[], extensions = schemaExtensions()) {
    editor = new Editor({ extensions, content: { type: "doc", content } });
    return editor;
  }

  function first(current: Editor) {
    const node = current.state.doc.firstChild;
    if (!node) throw new Error("The document is empty");
    return { node, pos: 0 };
  }

  it("insert a block below with the slash menu, duplicate and delete a block", () => {
    const current = open([paragraph("One"), paragraph("Two")]);
    insertBlockBelow(current, first(current));
    expect(current.state.doc.child(1).textContent).toBe("/");
    expect(current.state.selection.from).toBe(current.state.doc.child(0).nodeSize + 2);
    duplicateBlock(current, first(current));
    expect(current.state.doc.child(1).textContent).toBe("One");
    deleteBlock(current, first(current));
    expect(current.state.doc.childCount).toBe(3);
    expect(current.state.doc.firstChild?.textContent).toBe("One");
  });

  it("add a task at the end of a task list and show the button only while editing", () => {
    const current = open(
      [
        {
          type: "taskList",
          content: [{ type: "taskItem", attrs: { id: null }, content: [paragraph("Rotate the key")] }],
        },
      ],
      [...schemaExtensions(), TaskListAdd.configure({ label: () => "Add task" })],
    );
    expect(current.view.dom.querySelector(".ld-task-add")?.textContent).toBe("＋ Add task");
    addTaskAtEnd(current, 0);
    expect(current.state.doc.firstChild?.childCount).toBe(2);
    expect(current.state.selection.$from.parent.type.name).toBe("paragraph");
    current.setEditable(false);
    expect(current.view.dom.querySelector(".ld-task-add")).toBeNull();
  });

  it("add a column after the hovered border and a row below the table", () => {
    const current = open([
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [paragraph("A")] },
              { type: "tableCell", content: [paragraph("B")] },
            ],
          },
        ],
      },
    ]);
    const table = current.view.dom.querySelector("table");
    if (!table) throw new Error("No table");
    runInCell(current, table.rows[0]?.cells[0] as HTMLElement, "addColumnAfter");
    expect(current.state.doc.firstChild?.firstChild?.childCount).toBe(3);
    const rows = current.view.dom.querySelector("table")?.rows;
    runInCell(current, rows?.[0]?.cells[0] as HTMLElement, "addRowAfter");
    expect(current.state.doc.firstChild?.childCount).toBe(2);
  });
});
