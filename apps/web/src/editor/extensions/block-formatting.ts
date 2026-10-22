import type { TextAlignment } from "@lunedo/editor-schema";
import { Extension } from "@tiptap/core";

export const MAX_INDENT = 8;
const TYPES = new Set(["paragraph", "heading"]);

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blockFormatting: {
      setTextAlign: (alignment: TextAlignment) => ReturnType;
      changeIndent: (delta: 1 | -1) => ReturnType;
    };
  }
}

export const BlockFormatting = Extension.create({
  name: "blockFormatting",
  addCommands() {
    return {
      setTextAlign:
        (alignment) =>
        ({ tr, state, dispatch }) => {
          let changed = false;
          state.doc.nodesBetween(state.selection.from, state.selection.to, (node, position) => {
            if (!TYPES.has(node.type.name)) return true;
            if (dispatch) tr.setNodeMarkup(position, undefined, { ...node.attrs, textAlign: alignment });
            changed = true;
            return false;
          });
          return changed;
        },
      changeIndent:
        (delta) =>
        ({ tr, state, dispatch }) => {
          let changed = false;
          state.doc.nodesBetween(state.selection.from, state.selection.to, (node, position) => {
            if (!TYPES.has(node.type.name)) return true;
            const indent = Math.min(Math.max(Number(node.attrs.indent) + delta, 0), MAX_INDENT);
            if (indent !== node.attrs.indent) {
              if (dispatch) tr.setNodeMarkup(position, undefined, { ...node.attrs, indent });
              changed = true;
            }
            return false;
          });
          return changed;
        },
    };
  },
  addKeyboardShortcuts() {
    return {
      "Mod-Shift-l": () => this.editor.commands.setTextAlign("left"),
      "Mod-Shift-e": () => this.editor.commands.setTextAlign("center"),
      "Mod-Shift-r": () => this.editor.commands.setTextAlign("right"),
      "Mod-Shift-j": () => this.editor.commands.setTextAlign("justify"),
      "Mod-]": () => this.editor.commands.changeIndent(1),
      "Mod-[": () => this.editor.commands.changeIndent(-1),
    };
  },
});
