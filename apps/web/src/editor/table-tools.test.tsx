import { act, fireEvent, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { initI18n } from "../i18n/index.js";
import { renderWithProviders } from "../testing/render.js";
import { createEditorExtensions } from "./extensions/index.js";
import { TableMenu } from "./menus.js";
import { TableGrips } from "./table-tools.js";

const cell = (text: string, type = "tableCell") => ({
  type,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

describe("table grips and bar", () => {
  let editor: Editor | undefined;
  afterEach(() => editor?.destroy());

  async function open() {
    const i18n = await initI18n(["en"]);
    editor = new Editor({
      extensions: createEditorExtensions({ t: i18n.t, spaceId: null }),
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Intro" }] },
          {
            type: "table",
            content: [
              { type: "tableRow", content: [cell("Name", "tableHeader"), cell("Site", "tableHeader")] },
              { type: "tableRow", content: [cell("SRV-10"), cell("Vienna")] },
            ],
          },
        ],
      },
    });
    const current = editor;
    const container = createRef<HTMLDivElement>();
    await renderWithProviders(
      <div ref={container}>
        <TableMenu editor={current} />
        <EditorContent editor={current} />
        <TableGrips editor={current} container={container} />
      </div>,
    );
    return current;
  }

  it("shows a grip for every row and column only while the cursor is in the table", async () => {
    const current = await open();
    act(() => {
      current.commands.setTextSelection(2);
    });
    expect(screen.queryByRole("button", { name: "Row 1" })).toBeNull();
    act(() => {
      current.commands.focus();
      current.commands.setTextSelection(13);
    });
    expect(await screen.findByRole("button", { name: "Row 2" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Column 2" })).toBeTruthy();
    expect(screen.getByRole("toolbar", { name: "Table" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Header row on or off" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("deletes the row of a grip from its menu", async () => {
    const current = await open();
    act(() => {
      current.commands.focus();
      current.commands.setTextSelection(13);
    });
    fireEvent.pointerDown(await screen.findByRole("button", { name: "Row 2" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete row" }));
    expect(current.state.doc.child(1).childCount).toBe(1);
  });
});
