import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export const templatePlaceholdersKey = new PluginKey("templatePlaceholders");

export const TemplatePlaceholders = Extension.create({
  name: "templatePlaceholders",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: templatePlaceholdersKey,
        props: {
          handleTextInput(view, from, to, text) {
            const { state } = view;
            const $from = state.doc.resolve(from);
            const parent = $from.parent;
            if (!parent.isTextblock) return false;
            const start = $from.start();
            const ranges: [number, number][] = [];
            parent.forEach((child, offset) => {
              if (child.type.name === "placeholder")
                ranges.push([start + offset, start + offset + child.nodeSize]);
            });
            if (ranges.length === 0) return false;
            const tr = state.tr;
            for (const [rangeFrom, rangeTo] of ranges.reverse()) tr.delete(rangeFrom, rangeTo);
            tr.insertText(text, tr.mapping.map(from, -1), tr.mapping.map(to, 1));
            view.dispatch(tr.scrollIntoView());
            return true;
          },
        },
      }),
    ];
  },
});
