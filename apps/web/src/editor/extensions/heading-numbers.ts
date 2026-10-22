import { headingNumbers } from "@lunedo/editor-schema";
import { type Editor, Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const key = new PluginKey<DecorationSet>("headingNumbers");

function numberWidget(number: string): HTMLElement {
  const element = document.createElement("span");
  element.className = "ld-heading-number";
  element.contentEditable = "false";
  element.textContent = `${number} `;
  return element;
}

export function headingDecorations(doc: ProseMirrorNode, enabled: boolean): DecorationSet {
  if (!enabled) return DecorationSet.empty;
  const found: { position: number | null; level: number }[] = [];
  doc.descendants((node, position) => {
    if (node.type.name === "heading") found.push({ position, level: Number(node.attrs.level) });
    else if (node.type.name === "section") found.push({ position: null, level: 2 });
    return true;
  });
  const numbers = headingNumbers(found.map(({ level }) => ({ level, text: "", id: "" })));
  const decorations = found.flatMap(({ position }, index) => {
    const number = numbers[index];
    if (position === null || !number) return [];
    return [Decoration.widget(position + 1, () => numberWidget(number), { side: -1, key: `n${number}` })];
  });
  return DecorationSet.create(doc, decorations);
}

export const HeadingNumbers = Extension.create<Record<string, never>, { enabled: boolean }>({
  name: "headingNumbers",
  addStorage() {
    return { enabled: false };
  },
  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => headingDecorations(state.doc, storage.enabled),
          apply: (transaction, previous, _old, state) =>
            transaction.docChanged || transaction.getMeta(key) !== undefined
              ? headingDecorations(state.doc, storage.enabled)
              : previous,
        },
        props: { decorations: (state) => key.getState(state) },
      }),
    ];
  },
});

export function setHeadingNumbers(editor: Editor, enabled: boolean): void {
  const storage = (editor.storage as unknown as Record<string, { enabled: boolean } | undefined>)
    .headingNumbers;
  if (!storage || storage.enabled === enabled || editor.isDestroyed) return;
  storage.enabled = enabled;
  editor.view.dispatch(editor.state.tr.setMeta(key, enabled));
}
