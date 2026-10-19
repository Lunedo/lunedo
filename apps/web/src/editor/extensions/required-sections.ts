import { sectionEmpty } from "@pagehall/editor-schema";
import { type Editor, Extension } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export interface MissingSection {
  key: string;
  title: string;
}

interface RequiredSectionsStorage {
  missing: readonly MissingSection[];
  message: (section: MissingSection) => string;
}

const key = new PluginKey<DecorationSet>("requiredSections");

function messageWidget(text: string, id: string): HTMLElement {
  const element = document.createElement("p");
  element.className = "ph-section-required";
  element.contentEditable = "false";
  element.id = id;
  element.setAttribute("role", "alert");
  element.textContent = text;
  return element;
}

export function requiredSectionId(sectionKey: string): string {
  return `ph-required-${sectionKey}`;
}

export function requiredSectionDecorations(
  doc: ProseMirrorNode,
  storage: RequiredSectionsStorage,
): DecorationSet {
  if (storage.missing.length === 0) return DecorationSet.empty;
  const wanted = new Map(storage.missing.map((section) => [section.key, section]));
  const decorations: Decoration[] = [];
  doc.descendants((node, position) => {
    if (node.type.name !== "section") return true;
    const section = wanted.get(String(node.attrs.key));
    const content = (node.toJSON() as { content?: [] }).content ?? [];
    if (section && sectionEmpty({ content })) {
      decorations.push(
        Decoration.node(position, position + node.nodeSize, {
          class: "ph-section-missing",
          "aria-describedby": requiredSectionId(section.key),
        }),
        Decoration.widget(
          position + 1,
          () => messageWidget(storage.message(section), requiredSectionId(section.key)),
          { side: -1, key: `required-${section.key}` },
        ),
      );
    }
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

export const RequiredSections = Extension.create<Record<string, never>, RequiredSectionsStorage>({
  name: "requiredSections",
  addStorage() {
    return { missing: [], message: (section) => section.title };
  },
  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => requiredSectionDecorations(state.doc, storage),
          apply: (transaction, previous, _old, state) =>
            transaction.docChanged || transaction.getMeta(key) !== undefined
              ? requiredSectionDecorations(state.doc, storage)
              : previous,
        },
        props: { decorations: (state) => key.getState(state) },
      }),
    ];
  },
});

export function setRequiredSections(
  editor: Editor,
  missing: readonly MissingSection[],
  message: (section: MissingSection) => string,
): void {
  const storage = (editor.storage as unknown as Record<string, RequiredSectionsStorage | undefined>)
    .requiredSections;
  if (!storage || editor.isDestroyed) return;
  storage.missing = missing;
  storage.message = message;
  editor.view.dispatch(editor.state.tr.setMeta(key, missing.length));
}
