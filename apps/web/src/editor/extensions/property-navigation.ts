import { type Editor, Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

function cellDepth(editor: Editor): { depth: number; type: string; inList: boolean } | null {
  const { $from } = editor.state.selection;
  let inList = false;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const type = $from.node(depth).type.name;
    if (type === "listItem") inList = true;
    if (type === "pagePropertyKey" || type === "pagePropertyValue") return { depth, type, inList };
  }
  return null;
}

function moveTo(editor: Editor, position: number, direction: 1 | -1): boolean {
  const { state } = editor;
  const selection = TextSelection.findFrom(state.doc.resolve(position), direction, true);
  if (!selection) return false;
  editor.view.dispatch(state.tr.setSelection(selection).scrollIntoView());
  return true;
}

function nextCell(editor: Editor, direction: 1 | -1): boolean {
  const cell = cellDepth(editor);
  if (!cell || cell.inList) return false;
  const { $from } = editor.state.selection;
  const position = direction === 1 ? $from.after(cell.depth) : $from.before(cell.depth);
  return moveTo(editor, position, direction);
}

export const PropertyNavigation = Extension.create({
  name: "propertyNavigation",
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const cell = cellDepth(this.editor);
        if (cell?.type !== "pagePropertyKey") return false;
        return nextCell(this.editor, 1);
      },
      Tab: () => nextCell(this.editor, 1),
      "Shift-Tab": () => nextCell(this.editor, -1),
    };
  },
});
