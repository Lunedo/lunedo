import { act, fireEvent, screen } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "../i18n/index.js";
import { renderWithProviders } from "../testing/render.js";
import { createEditorExtensions } from "./extensions/index.js";
import { EditorToolbar, type ToolbarHandle } from "./toolbar.js";
import { toolbarItems } from "./toolbar-items.js";
import { fitItems, nextIndex } from "./toolbar-model.js";

describe("toolbar layout", () => {
  it("keeps every item when there is room and moves the rest into More from the end", () => {
    expect(fitItems([30, 30, 30], 100, 30)).toEqual([true, true, true]);
    expect(fitItems([30, 30, 30], 89, 30)).toEqual([true, false, false]);
    expect(fitItems([30, 30, 30], 93, 30, 2)).toEqual([true, false, false]);
    expect(fitItems([30, 30, 30, 30], 100, 30)).toEqual([true, true, false, false]);
    expect(fitItems([30, 30, 30], 10, 30)).toEqual([false, false, false]);
  });

  it("keeps essential items visible before the others and reserves room for More", () => {
    expect(fitItems([30, 30, 30, 30], 100, 30, 0, { essential: [true, false, false, true] })).toEqual([
      true,
      false,
      false,
      true,
    ]);
    expect(fitItems([30, 30], 100, 30, 0, { alwaysMore: true })).toEqual([true, true]);
    expect(fitItems([30, 30], 80, 30, 0, { alwaysMore: true })).toEqual([true, false]);
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

  it("lists the most important items first and keeps subscript and superscript in More", async () => {
    const shown = await labels(5000);
    expect(shown.slice(0, 12)).toEqual([
      "Undo",
      "Redo",
      "Text style: Paragraph",
      "Bold",
      "Italic",
      "Underline",
      "Link",
      "Bulleted list",
      "Numbered list",
      "Task list",
      "Insert table",
      "Insert: Insert",
    ]);
    expect(shown.slice(12, 16)).toEqual(["Strikethrough", "Inline code", "Text color", "Highlight"]);
    expect(shown).not.toContain("Subscript");
    expect(shown.at(-1)).toBe("More formatting");
  });

  it("keeps undo, text style, bold, italic, link and Insert on a phone", async () => {
    const shown = await labels(358);
    for (const name of ["Undo", "Text style: Paragraph", "Bold", "Italic", "Link", "Insert: Insert"]) {
      expect(shown).toContain(name);
    }
    expect(shown).not.toContain("Find and replace");
    expect(shown.at(-1)).toBe("More formatting");
  });
});
