import { modules } from "@lunedo/editor-schema";
import { Extension } from "@tiptap/core";
import type { Fragment, Mark } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { AddMarkStep, AttrStep, ReplaceAroundStep, ReplaceStep, type Step } from "@tiptap/pm/transform";
import { ySyncPluginKey } from "@tiptap/y-tiptap";

function valid(kind: "node" | "mark", name: string, attrs: Record<string, unknown>): boolean {
  const definition = kind === "node" ? modules.node(name) : modules.mark(name);
  if (!definition) return false;
  return Object.entries(definition.attrs ?? {}).every(
    ([attribute, spec]) => spec.schema.safeParse(attrs[attribute]).success,
  );
}

function marksValid(marks: readonly Mark[]): boolean {
  return marks.every((mark) => valid("mark", mark.type.name, mark.attrs));
}

export function fragmentValid(fragment: Fragment): boolean {
  let ok = true;
  fragment.descendants((node) => {
    if (!ok) return false;
    if (!marksValid(node.marks) || (!node.isText && !valid("node", node.type.name, node.attrs))) ok = false;
    return ok;
  });
  return ok;
}

export function stepValid(step: Step): boolean {
  if (step instanceof ReplaceStep || step instanceof ReplaceAroundStep) {
    return fragmentValid(step.slice.content);
  }
  if (step instanceof AddMarkStep) return valid("mark", step.mark.type.name, step.mark.attrs);
  if (step instanceof AttrStep) return true;
  return true;
}

export const SchemaGuard = Extension.create({
  name: "schemaGuard",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("schemaGuard"),
        filterTransaction: (transaction) => {
          if (!transaction.docChanged || transaction.getMeta(ySyncPluginKey)) return true;
          if (!transaction.steps.every(stepValid)) return false;
          const touched = transaction.steps.filter((step) => step instanceof AttrStep) as AttrStep[];
          if (touched.length === 0) return true;
          const after = transaction.doc;
          return touched.every((step) => {
            const node = after.nodeAt(step.pos);
            return !node || valid("node", node.type.name, node.attrs);
          });
        },
      }),
    ];
  },
});
