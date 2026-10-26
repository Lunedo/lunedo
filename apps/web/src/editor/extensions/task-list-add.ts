import { type Editor, Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface TaskListAddOptions {
  label: () => string;
}

export function addTaskAtEnd(editor: Editor, listPosition: number): boolean {
  const list = editor.state.doc.nodeAt(listPosition);
  if (list?.type.name !== "taskList") return false;
  const end = listPosition + list.nodeSize - 1;
  return editor
    .chain()
    .focus()
    .insertContentAt(end, { type: "taskItem", content: [{ type: "paragraph" }] })
    .command(({ tr }) => {
      tr.setSelection(TextSelection.near(tr.doc.resolve(end + 2)));
      return true;
    })
    .scrollIntoView()
    .run();
}

function button(editor: Editor, position: number, label: string): HTMLElement {
  const element = document.createElement("button");
  element.type = "button";
  element.className = "ld-task-add";
  element.contentEditable = "false";
  element.textContent = `＋ ${label}`;
  element.addEventListener("mousedown", (event) => event.preventDefault());
  element.addEventListener("click", () => addTaskAtEnd(editor, position));
  return element;
}

export const TaskListAdd = Extension.create<TaskListAddOptions>({
  name: "taskListAdd",
  addOptions() {
    return { label: () => "" };
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    const label = this.options.label;
    return [
      new Plugin({
        key: new PluginKey("taskListAdd"),
        props: {
          decorations: (state) => {
            if (!editor.isEditable) return null;
            const decorations: Decoration[] = [];
            state.doc.descendants((node, position, parent) => {
              if (node.type.name !== "taskList") return true;
              if (parent?.type.name !== "taskItem") {
                decorations.push(
                  Decoration.widget(position + node.nodeSize, () => button(editor, position, label()), {
                    side: -1,
                    key: `task-add-${position}-${node.childCount}`,
                    ignoreSelection: true,
                  }),
                );
              }
              return false;
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
