import { type Editor, Extension } from "@tiptap/core";
import { Selection, TextSelection } from "@tiptap/pm/state";

function moveTo(editor: Editor, edge: "start" | "end", extend: boolean): boolean {
  const { state, view } = editor;
  const target = edge === "start" ? Selection.atStart(state.doc) : Selection.atEnd(state.doc);
  const selection = extend ? TextSelection.between(state.selection.$anchor, target.$head) : target;
  view.dispatch(state.tr.setSelection(selection).scrollIntoView());
  return true;
}

export const DocumentEdges = Extension.create({
  name: "documentEdges",
  addKeyboardShortcuts() {
    return {
      "Mod-Home": () => moveTo(this.editor, "start", false),
      "Mod-End": () => moveTo(this.editor, "end", false),
      "Shift-Mod-Home": () => moveTo(this.editor, "start", true),
      "Shift-Mod-End": () => moveTo(this.editor, "end", true),
    };
  },
});
