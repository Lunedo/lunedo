import { act, fireEvent, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "../i18n/index.js";
import { renderWithProviders } from "../testing/render.js";
import { createEditorExtensions } from "./extensions/index.js";
import { filterSlashCommands, slashCommands } from "./slash-items.js";
import { EditorToolbar, type ToolbarHandle } from "./toolbar.js";
import { toolbarItems } from "./toolbar-items.js";
import { fitGroups, nextIndex } from "./toolbar-model.js";

describe("toolbar layout", () => {
  it("keeps every group when there is room and moves movable groups into More from the end", () => {
    const groups = [
      { width: 60, movable: false },
      { width: 40, movable: true },
      { width: 60, movable: false },
      { width: 40, movable: true },
    ];
    expect(fitGroups(groups, 200, 30)).toEqual([true, true, true, true]);
    expect(fitGroups(groups, 190, 30)).toEqual([true, true, true, false]);
    expect(fitGroups(groups, 140, 30)).toEqual([true, false, true, false]);
    expect(fitGroups(groups, 50, 30)).toEqual([true, false, true, false]);
    expect(fitGroups(groups, 204, 30, 1)).toEqual([true, true, true, true]);
    expect(fitGroups(groups, 203, 30, 1)).toEqual([true, true, true, false]);
  });

  it("moves with arrow keys, Home and End and wraps", () => {
    expect(nextIndex(0, "ArrowRight", 4)).toBe(1);
    expect(nextIndex(0, "ArrowLeft", 4)).toBe(3);
    expect(nextIndex(2, "Home", 4)).toBe(0);
    expect(nextIndex(0, "End", 4)).toBe(3);
    expect(nextIndex(0, "a", 4)).toBeNull();
  });
});

describe("toolbar keyboard", () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(5000);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("receives focus with Alt+F10, moves with arrows and returns to the text with Escape", async () => {
    const i18n = await initI18n(["en"]);
    const toolbar = createRef<ToolbarHandle>();
    const editor = new Editor({
      extensions: createEditorExtensions({
        t: i18n.t,
        spaceId: null,
        onFocusToolbar: () => toolbar.current?.focus(),
      }),
      content: "<p>Hello</p>",
    });
    const actions = {
      openEmojiPicker: vi.fn(),
      openLinkDialog: vi.fn(),
      openFind: vi.fn(),
      focusToolbar: vi.fn(),
    };
    await renderWithProviders(
      <>
        <EditorToolbar ref={toolbar} editor={editor} items={toolbarItems(editor, i18n.t, actions)} />
        <EditorContent editor={editor} />
      </>,
    );
    const bar = screen.getByRole("toolbar", { name: "Formatting" });
    const buttons = Array.from(bar.querySelectorAll<HTMLButtonElement>("button"));
    expect(buttons.filter((button) => button.tabIndex === 0)).toHaveLength(1);
    for (const button of buttons) expect(button.getAttribute("aria-label")).toBeTruthy();

    act(() => {
      editor.commands.focus();
    });
    fireEvent.keyDown(editor.view.dom, { key: "F10", altKey: true });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(bar, { key: "ArrowRight" });
    expect(document.activeElement).toBe(buttons[1]);
    fireEvent.keyDown(bar, { key: "End" });
    expect(document.activeElement?.getAttribute("data-index")).toBe(String(buttons.length - 1));
    fireEvent.keyDown(bar, { key: "Escape" });
    await vi.waitFor(() => expect(document.activeElement).toBe(editor.view.dom));
    editor.destroy();
  });

  it("applies marks from the toolbar", async () => {
    const i18n = await initI18n(["en"]);
    const editor = new Editor({
      extensions: createEditorExtensions({ t: i18n.t, spaceId: null }),
      content: "<p>Hello</p>",
    });
    const actions = {
      openEmojiPicker: vi.fn(),
      openLinkDialog: vi.fn(),
      openFind: vi.fn(),
      focusToolbar: vi.fn(),
    };
    await renderWithProviders(
      <EditorToolbar editor={editor} items={toolbarItems(editor, i18n.t, actions)} />,
    );
    act(() => {
      editor.commands.selectAll();
    });
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(JSON.stringify(editor.getJSON())).toContain('"type":"bold"');
    fireEvent.click(screen.getByRole("button", { name: "Find and replace" }));
    expect(actions.openFind).toHaveBeenCalledOnce();
    editor.destroy();
  });
});

describe("toolbar order", () => {
  const actions = {
    openEmojiPicker: vi.fn(),
    openLinkDialog: vi.fn(),
    openFind: vi.fn(),
    focusToolbar: vi.fn(),
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function labels(available: number): Promise<string[]> {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(available);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 36 } as DOMRect);
    const i18n = await initI18n(["en"]);
    const editor = new Editor({
      extensions: createEditorExtensions({ t: i18n.t, spaceId: null }),
      content: "<p>Hello</p>",
    });
    await renderWithProviders(
      <EditorToolbar editor={editor} items={toolbarItems(editor, i18n.t, actions)} />,
    );
    const bar = screen.getByRole("toolbar", { name: "Formatting" });
    const result = Array.from(bar.querySelectorAll("button")).map(
      (button) => button.getAttribute("aria-label") ?? "",
    );
    editor.destroy();
    return result;
  }

  it("follows the order of the groups and shows every shortcut in the tooltip", async () => {
    const shown = await labels(5000);
    expect(shown).toEqual([
      "Undo",
      "Redo",
      "Text style: Paragraph",
      "Bold",
      "Italic",
      "Underline",
      "More formatting",
      "Text color and highlight",
      "Bulleted list",
      "Numbered list",
      "Task list",
      "Outdent",
      "Indent",
      "Alignment",
      "Link",
      "Mention someone",
      "Emoji",
      "Insert table",
      "Column layout",
      "Callout",
      "Insert: Insert",
      "Find and replace",
    ]);
  });

  it("moves the middle groups into More on a narrow window and keeps the base groups", async () => {
    const shown = await labels(700);
    for (const name of [
      "Undo",
      "Redo",
      "Text style: Paragraph",
      "Bold",
      "More formatting",
      "Bulleted list",
      "Link",
      "Emoji",
      "Insert: Insert",
      "Find and replace",
    ]) {
      expect(shown).toContain(name);
    }
    for (const name of ["Text color and highlight", "Indent", "Insert table", "Callout"]) {
      expect(shown).not.toContain(name);
    }
    expect(shown.at(-1)).toBe("More tools");
  });
});

describe("toolbar menus", () => {
  const actions = {
    openEmojiPicker: vi.fn(),
    openLinkDialog: vi.fn(),
    openFind: vi.fn(),
    focusToolbar: vi.fn(),
    pickFiles: vi.fn(),
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function open() {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(5000);
    const i18n = await initI18n(["en"]);
    const editor = new Editor({
      extensions: createEditorExtensions({ t: i18n.t, spaceId: null }),
      content: "<p>Hello</p>",
    });
    const items = toolbarItems(editor, i18n.t, actions);
    await renderWithProviders(<EditorToolbar editor={editor} items={items} />);
    return { editor, items };
  }

  it("offers text styles up to heading 4, quote and code block with their shortcuts", async () => {
    const { editor, items } = await open();
    const blockType = items.find((item) => item.id === "blockType");
    expect(blockType?.menu?.map((entry) => ("separator" in entry ? "—" : entry.label))).toEqual([
      "Paragraph",
      "Heading 1",
      "Heading 2",
      "Heading 3",
      "Heading 4",
      "—",
      "Quote",
      "Code block",
    ]);
    const more = items.find((item) => item.id === "moreFormatting");
    expect(more?.menu?.flatMap((entry) => ("separator" in entry ? [] : [entry.shortcut ?? "none"]))).toEqual([
      "mod+shift+s",
      "mod+e",
      "mod+.",
      "mod+,",
      "none",
    ]);
    editor.destroy();
  });

  it("lists every other insertable block in Insert with its slash command", async () => {
    const { editor, items } = await open();
    const insert = items.find((item) => item.id === "insert");
    const ids = insert?.menu?.flatMap((entry) => ("separator" in entry ? [] : [entry.id])) ?? [];
    for (const id of [
      "insert-expand",
      "insert-tabs",
      "insert-horizontalRule",
      "insert-date",
      "insert-status",
    ]) {
      expect(ids).toContain(id);
    }
    for (const id of ["insert-table", "insert-codeBlock", "insert-callout-info", "insert-columns2"]) {
      expect(ids).not.toContain(id);
    }
    const i18n = await initI18n(["en"]);
    const hints: string[] = [];
    for (const entry of insert?.menu ?? []) {
      if ("separator" in entry) continue;
      expect(entry.hint).toMatch(/^\//);
      hints.push(entry.hint ?? "");
      const found = filterSlashCommands(slashCommands, (entry.hint ?? "").slice(1), i18n.t).map(
        (command) => `insert-${command.id}`,
      );
      expect(found, entry.hint).toContain(entry.id);
    }
    expect(new Set(hints).size).toBe(hints.length);
    editor.destroy();
  });

  it("picks text color and highlight from the palette", async () => {
    const { editor } = await open();
    act(() => {
      editor.commands.selectAll();
    });
    fireEvent.click(screen.getByRole("button", { name: "Text color and highlight" }));
    const palette = await screen.findByRole("dialog", { name: "Text color and highlight" });
    const swatches = palette.querySelectorAll("button");
    expect(swatches).toHaveLength(20);
    fireEvent.click(screen.getAllByRole("button", { name: "Red" })[0] as HTMLElement);
    expect(JSON.stringify(editor.getJSON())).toContain('"color":"red"');
    editor.destroy();
  });
});
