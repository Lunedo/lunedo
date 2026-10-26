import { Editor, type JSONContent } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { initI18n } from "../i18n/index.js";
import { createEditorExtensions } from "./extensions/index.js";
import { dissolveLayout, removeLayoutColumn } from "./layout-commands.js";
import { activeTable, moveColumn, moveRow, selectColumn, selectRow, sortByColumn } from "./table-commands.js";

const paragraph = (text: string) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const cell = (text: string, type = "tableCell", attrs: Record<string, unknown> = {}) => ({
  type,
  attrs,
  content: [paragraph(text)],
});
const row = (...cells: JSONContent[]) => ({ type: "tableRow", content: cells });

function table(): JSONContent {
  return {
    type: "table",
    content: [
      row(cell("Name", "tableHeader"), cell("Site", "tableHeader")),
      row(cell("SRV-10"), cell("Vienna")),
      row(cell("SRV-2"), cell("Graz")),
      row(cell("NAS"), cell("Linz")),
    ],
  };
}

function texts(editor: Editor): string[][] {
  const rows: string[][] = [];
  editor.state.doc.firstChild?.forEach((line) => {
    const cells: string[] = [];
    line.forEach((entry) => {
      cells.push(entry.textContent);
    });
    rows.push(cells);
  });
  return rows;
}

describe("table actions", () => {
  let editor: Editor | undefined;
  afterEach(() => editor?.destroy());

  async function open(content: JSONContent[] = [table(), paragraph("After")]) {
    const i18n = await initI18n(["en"]);
    editor = new Editor({
      extensions: createEditorExtensions({ t: i18n.t, spaceId: null }),
      content: { type: "doc", content },
    });
    editor.commands.setTextSelection(5);
    return editor;
  }

  function current(target: Editor) {
    const found = activeTable(target);
    if (!found) throw new Error("No table at the cursor");
    return found;
  }

  it("moves rows and columns", async () => {
    const target = await open();
    moveRow(target, current(target), 1, 1);
    expect(texts(target).map((line) => line[0])).toEqual(["Name", "SRV-2", "SRV-10", "NAS"]);
    target.commands.setTextSelection(5);
    moveColumn(target, current(target), 0, 1);
    expect(texts(target)[0]).toEqual(["Site", "Name"]);
  });

  it("sorts the rows below the header by a column, numbers in their order", async () => {
    const target = await open();
    sortByColumn(target, current(target), 0, "ascending", "en");
    expect(texts(target).map((line) => line[0])).toEqual(["Name", "NAS", "SRV-2", "SRV-10"]);
    target.commands.setTextSelection(5);
    sortByColumn(target, current(target), 1, "descending", "en");
    expect(texts(target).map((line) => line[1])).toEqual(["Site", "Vienna", "Linz", "Graz"]);
  });

  it("refuses to move or sort when cells are merged", async () => {
    const target = await open([
      {
        type: "table",
        content: [row(cell("Wide", "tableCell", { colspan: 2 })), row(cell("A"), cell("B"))],
      },
    ]);
    expect(moveRow(target, current(target), 0, 1)).toBe(false);
    expect(sortByColumn(target, current(target), 0, "ascending", "en")).toBe(false);
    expect(texts(target)[0]).toEqual(["Wide"]);
  });

  it("deletes a row or a column chosen by its grip with Delete, and undo brings it back", async () => {
    const target = await open();
    selectRow(target, current(target), 2);
    target.view.someProp("handleKeyDown", (handler) =>
      handler(target.view, new KeyboardEvent("keydown", { key: "Delete" })),
    );
    expect(texts(target).map((line) => line[0])).toEqual(["Name", "SRV-10", "NAS"]);
    target.commands.undo();
    expect(texts(target)).toHaveLength(4);
    target.commands.setTextSelection(5);
    selectColumn(target, current(target), 1);
    target.view.someProp("handleKeyDown", (handler) =>
      handler(target.view, new KeyboardEvent("keydown", { key: "Backspace" })),
    );
    expect(texts(target)[0]).toEqual(["Name"]);
  });

  it("deletes the whole table when every cell is selected and only clears a few cells otherwise", async () => {
    const target = await open();
    const all = current(target);
    const { CellSelection } = await import("@tiptap/pm/tables");
    const first = target.state.doc.resolve(all.pos + 1 + (all.map.map[0] ?? 0));
    const last = target.state.doc.resolve(all.pos + 1 + (all.map.map.at(-1) ?? 0));
    target.view.dispatch(target.state.tr.setSelection(new CellSelection(first, last)));
    target.view.someProp("handleKeyDown", (handler) =>
      handler(target.view, new KeyboardEvent("keydown", { key: "Delete" })),
    );
    expect(target.state.doc.firstChild?.type.name).not.toBe("table");
    target.commands.undo();
    target.commands.setTextSelection(5);
    const again = current(target);
    const a = target.state.doc.resolve(again.pos + 1 + (again.map.map[2] ?? 0));
    const b = target.state.doc.resolve(again.pos + 1 + (again.map.map[4] ?? 0));
    target.view.dispatch(target.state.tr.setSelection(new CellSelection(a, b)));
    target.view.someProp("handleKeyDown", (handler) =>
      handler(target.view, new KeyboardEvent("keydown", { key: "Delete" })),
    );
    expect(texts(target).map((line) => line[0])).toEqual(["Name", "", "", "NAS"]);
    expect(texts(target)[1]?.[1]).toBe("Vienna");
    expect(texts(target)).toHaveLength(4);
  });
});

describe("column layouts", () => {
  let editor: Editor | undefined;
  afterEach(() => editor?.destroy());

  const layout = (count: number) => ({
    type: "columns",
    content: Array.from({ length: count }, (_, index) => ({
      type: "column",
      attrs: { width: count === 3 ? [33, 34, 33][index] : 50 },
      content: [paragraph(`Column ${index + 1}`)],
    })),
  });

  async function open(content: JSONContent[]) {
    const i18n = await initI18n(["en"]);
    editor = new Editor({
      extensions: createEditorExtensions({ t: i18n.t, spaceId: null }),
      content: { type: "doc", content },
    });
    return editor;
  }

  function run(target: Editor, action: Parameters<typeof target.commands.command>[0]) {
    target.commands.command(action);
  }

  it("removes a column and spreads the rest evenly", async () => {
    const target = await open([layout(3)]);
    const node = target.state.doc.child(0);
    run(target, ({ tr }) => removeLayoutColumn(tr, 0, node, 1));
    const result = target.state.doc.child(0);
    expect(result.childCount).toBe(2);
    expect(result.child(0).attrs.width).toBe(50);
    expect(result.textContent).toBe("Column 1Column 3");
  });

  it("keeps the content as normal blocks when the layout is dissolved or only one column is left", async () => {
    const target = await open([layout(2), paragraph("After")]);
    run(target, ({ tr }) => removeLayoutColumn(tr, 0, target.state.doc.child(0), 0));
    expect(target.state.doc.child(0).type.name).toBe("paragraph");
    expect(target.state.doc.child(0).textContent).toBe("Column 2");
    target.commands.setContent({ type: "doc", content: [layout(3)] });
    run(target, ({ tr }) => dissolveLayout(tr, 0, target.state.doc.child(0)));
    const types: string[] = [];
    target.state.doc.forEach((block) => {
      types.push(`${block.type.name}:${block.textContent}`);
    });
    expect(types.slice(0, 3)).toEqual(["paragraph:Column 1", "paragraph:Column 2", "paragraph:Column 3"]);
    expect(types.slice(3).every((entry) => entry === "paragraph:")).toBe(true);
  });
});
