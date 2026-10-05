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
  it("keeps every item when there is room and moves the rest into More otherwise", () => {
    expect(fitItems([30, 30, 30], 100, 30)).toBe(3);
    expect(fitItems([30, 30, 30], 89, 30)).toBe(1);
    expect(fitItems([30, 30, 30], 93, 30, 2)).toBe(1);
    expect(fitItems([30, 30, 30, 30], 100, 30)).toBe(2);
    expect(fitItems([30, 30, 30], 10, 30)).toBe(0);
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
