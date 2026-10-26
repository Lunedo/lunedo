import { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { initI18n } from "../i18n/index.js";
import { createEditorExtensions } from "./extensions/index.js";
import { slashCommands } from "./slash-items.js";
import { toolbarItems } from "./toolbar-items.js";

const OPENS_A_DIALOG = new Set(["file", "embed"]);
const insertable = slashCommands.filter(
  (command) => command.group === "blocks" && !OPENS_A_DIALOG.has(command.id),
);

function document() {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Intro" }] },
      { type: "paragraph" },
      { type: "paragraph" },
      { type: "paragraph" },
      { type: "paragraph", content: [{ type: "text", text: "asdfasdf" }] },
    ],
  };
}

const EMPTY_LINE = 8;

function topLevel(editor: Editor): { type: string; text: string }[] {
  const blocks: { type: string; text: string }[] = [];
  editor.state.doc.forEach((node) => {
    blocks.push({ type: node.type.name, text: node.textContent });
  });
  return blocks;
}

function moveSelectionToLastLine(editor: Editor) {
  const end = editor.state.doc.content.size - 1;
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)));
}

function expectOwnBlock(editor: Editor, label: string) {
  const blocks = topLevel(editor);
  expect(blocks[0], label).toEqual({ type: "paragraph", text: "Intro" });
  expect(blocks[1]?.type, label).not.toBe("paragraph");
  expect(blocks[1]?.text, label).not.toContain("asdfasdf");
  expect(
    blocks.filter((block) => block.text === "asdfasdf"),
    label,
  ).toEqual([{ type: "paragraph", text: "asdfasdf" }]);
}

describe("inserting a block three lines above existing text", () => {
  for (const command of insertable) {
    it(`inserts ${command.id} as its own block and leaves the text below alone`, async () => {
      const i18n = await initI18n(["en"]);
      const editor = new Editor({
        extensions: createEditorExtensions({ t: i18n.t, spaceId: null }),
        content: document(),
      });
      moveSelectionToLastLine(editor);
      command.run(editor, { from: EMPTY_LINE, to: EMPTY_LINE }, i18n.t);
      expectOwnBlock(editor, command.id);
      editor.destroy();
    });
  }

  it("does the same for the blocks of the toolbar", async () => {
    const i18n = await initI18n(["en"]);
    const actions = {
      openEmojiPicker: () => undefined,
      openLinkDialog: () => undefined,
      openFind: () => undefined,
      focusToolbar: () => undefined,
    };
    for (const id of ["columns-two", "columns-sidebarLeft", "callout", "table"]) {
      const editor = new Editor({
        extensions: createEditorExtensions({ t: i18n.t, spaceId: null }),
        content: document(),
      });
      editor.commands.setTextSelection(EMPTY_LINE);
      const items = toolbarItems(editor, i18n.t, actions);
      const entries = items.flatMap((item) => [item, ...(item.menu ?? [])]);
      const entry = entries.find((candidate) => candidate.id === id);
      if (!entry || "separator" in entry) throw new Error(`No toolbar entry ${id}`);
      entry.run();
      expectOwnBlock(editor, id);
      editor.destroy();
    }
  });

  it("puts the cursor into a new block that holds text", async () => {
    const i18n = await initI18n(["en"]);
    const editor = new Editor({
      extensions: createEditorExtensions({ t: i18n.t, spaceId: null }),
      content: document(),
    });
    slashCommands
      .find((command) => command.id === "callout-warning")
      ?.run(editor, { from: EMPTY_LINE, to: EMPTY_LINE }, i18n.t);
    expect(editor.state.selection.$from.node(1).type.name).toBe("callout");
    editor.destroy();
  });
});
