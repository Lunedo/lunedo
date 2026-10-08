import { uuidv7 } from "@pagehall/shared";
import { Extension } from "@tiptap/core";
import { Fragment, type Node as ProseMirrorNode, Slice } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { ySyncPluginKey } from "@tiptap/y-tiptap";

function withNewTaskIds(fragment: Fragment): Fragment {
  const nodes: ProseMirrorNode[] = [];
  fragment.forEach((node) => {
    const content = withNewTaskIds(node.content);
    nodes.push(
      node.type.name === "taskItem"
        ? node.type.create({ ...node.attrs, id: uuidv7() }, content, node.marks)
        : node.copy(content),
    );
  });
  return Fragment.fromArray(nodes);
}

function isLocal(transaction: Transaction): boolean {
  const sync = transaction.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined;
  return transaction.docChanged && !sync?.isChangeOrigin;
}

export const TaskIds = Extension.create({
  name: "taskIds",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("taskIds"),
        appendTransaction: (transactions, _before, state) => {
          if (!transactions.some(isLocal)) return null;
          const seen = new Set<string>();
          let transaction: Transaction | null = null;
          state.doc.descendants((node, position) => {
            if (node.type.name !== "taskItem") return true;
            const id = node.attrs.id as string | null;
            if (id && !seen.has(id)) {
              seen.add(id);
              return true;
            }
            const next = uuidv7();
            seen.add(next);
            transaction ??= state.tr;
            transaction.setNodeMarkup(position, undefined, { ...node.attrs, id: next });
            return true;
          });
          return transaction;
        },
        props: {
          transformPasted: (slice) =>
            new Slice(withNewTaskIds(slice.content), slice.openStart, slice.openEnd),
        },
      }),
    ];
  },
});
