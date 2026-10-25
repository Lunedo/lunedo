import type { Editor, Range } from "@tiptap/core";
import { insertBlock, nearestOfType } from "./insert-block.js";

const FIELDS = "input:not([type=hidden]), textarea, [role=combobox], select";
const FRAMES = 30;

export function focusFirstField(editor: Editor, type: string, near: number): void {
  let frames = 0;
  const attempt = () => {
    if (editor.isDestroyed) return;
    const position = nearestOfType(editor, type, near);
    const element = position === null ? null : editor.view.nodeDOM(position);
    const field = element instanceof HTMLElement ? element.querySelector<HTMLElement>(FIELDS) : null;
    if (field) {
      field.focus();
      return;
    }
    frames += 1;
    if (frames < FRAMES) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
}

export function insertAndFocus(
  editor: Editor,
  range: Range,
  content: { type: string; attrs?: Record<string, unknown> },
): void {
  insertBlock(editor, range, content);
  focusFirstField(editor, content.type, range.from);
}
