import type { Editor } from "@tiptap/core";

export interface EditorActions {
  openEmojiPicker(): void;
  openLinkDialog(): void;
  openFind(): void;
  focusToolbar(): void;
  comment?(): void;
  pickFiles?(): void;
}

const registry = new WeakMap<Editor, EditorActions>();

export function registerEditorActions(editor: Editor, actions: EditorActions): () => void {
  registry.set(editor, actions);
  return () => {
    if (registry.get(editor) === actions) registry.delete(editor);
  };
}

export function editorActions(editor: Editor): EditorActions | undefined {
  return registry.get(editor);
}
