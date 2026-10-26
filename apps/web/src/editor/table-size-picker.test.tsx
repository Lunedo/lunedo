import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../testing/render.js";
import { schemaExtensions } from "./schema/extensions.js";
import { TableSizePicker } from "./table-size-picker.js";

describe("the table size picker", () => {
  let editor: Editor | undefined;
  afterEach(() => editor?.destroy());

  function table(current: Editor) {
    const node = current.state.doc.content.content.find((child) => child.type.name === "table");
    return node
      ? { rows: node.childCount, columns: node.firstChild?.childCount ?? 0, json: node.toJSON() }
      : null;
  }

  it("inserts a table of the size chosen in the grid", async () => {
    editor = new Editor({
      extensions: schemaExtensions(),
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    const onOpenChange = vi.fn();
    await renderWithProviders(<TableSizePicker editor={editor} open onOpenChange={onOpenChange} />);
    const cell = await screen.findByRole("button", { name: "4 columns × 2 rows" });
    fireEvent.mouseEnter(cell);
    expect(screen.getByText("Table · 4 × 2")).toBeTruthy();
    await userEvent.click(cell);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(table(editor)).toMatchObject({ rows: 2, columns: 4 });
  });

  it("inserts a table from the fields, without a header row when it is switched off", async () => {
    editor = new Editor({
      extensions: schemaExtensions(),
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    await renderWithProviders(<TableSizePicker editor={editor} open onOpenChange={() => undefined} />);
    const columns = await screen.findByRole("spinbutton", { name: "Columns" });
    await userEvent.clear(columns);
    await userEvent.type(columns, "12");
    await userEvent.click(screen.getByRole("checkbox", { name: "Header row" }));
    await userEvent.click(screen.getByRole("button", { name: "Insert" }));
    const inserted = table(editor);
    expect(inserted).toMatchObject({ rows: 3, columns: 12 });
    expect(JSON.stringify(inserted?.json)).not.toContain("tableHeader");
  });

  it("asks for numbers instead of inserting an empty table", async () => {
    editor = new Editor({
      extensions: schemaExtensions(),
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    await renderWithProviders(<TableSizePicker editor={editor} open onOpenChange={() => undefined} />);
    await userEvent.clear(await screen.findByRole("spinbutton", { name: "Rows" }));
    await userEvent.click(screen.getByRole("button", { name: "Insert" }));
    expect(await screen.findByText("Enter a number from 1 to 20 for columns and rows.")).toBeTruthy();
    expect(table(editor)).toBeNull();
  });
});
