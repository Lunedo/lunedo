import { uuidv7 } from "@lunedo/shared";
import { Extension } from "@tiptap/core";
import { Fragment, type Node as ProseMirrorNode, Slice } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { pastedTaskState, rememberTaskStatus } from "./pasted-tasks.js";

function withNewTaskIds(fragment: Fragment, counter = { index: 0 }): Fragment {
  const nodes: ProseMirrorNode[] = [];
  fragment.forEach((node) => {
    if (node.type.name === "decision") {
      nodes.push(
        node.type.create({ ...node.attrs, id: uuidv7() }, withNewTaskIds(node.content, counter), node.marks),
      );
      return;
    }
    if (node.type.name !== "taskItem") {
      nodes.push(node.copy(withNewTaskIds(node.content, counter)));
      return;
    }
    const id = uuidv7();
    if (pastedTaskState(counter.index)) rememberTaskStatus(id, true);
    counter.index += 1;
    nodes.push(node.type.create({ ...node.attrs, id }, withNewTaskIds(node.content, counter), node.marks));
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
            if (node.type.name !== "taskItem" && node.type.name !== "decision") return true;
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
