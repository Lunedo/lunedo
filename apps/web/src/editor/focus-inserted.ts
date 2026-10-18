import type { Editor, Range } from "@tiptap/core";

const FIELDS = "input:not([type=hidden]), textarea, [role=combobox], select";
const FRAMES = 30;

function insertedPosition(editor: Editor, type: string, near: number): number | null {
  let found: number | null = null;
  editor.state.doc.descendants((node, position) => {
    if (node.type.name !== type) return true;
    if (found === null || Math.abs(position - near) < Math.abs(found - near)) found = position;
    return false;
  });
  return found;
}

export function focusFirstField(editor: Editor, type: string, near: number): void {
  let frames = 0;
  const attempt = () => {
    if (editor.isDestroyed) return;
    const position = insertedPosition(editor, type, near);
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
  editor.chain().focus().deleteRange(range).insertContent(content).run();
  focusFirstField(editor, content.type, range.from);
}
