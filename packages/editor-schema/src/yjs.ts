import { prosemirrorJSONToYDoc, updateYFragment, yXmlFragmentToProsemirrorJSON } from "@tiptap/y-tiptap";
import type * as Y from "yjs";
import { type DocumentJson, editorKit, editorSchemaVersion, migrateDocument } from "./index.js";
import { InvalidDocumentError } from "./validate.js";

export const Y_FRAGMENT = "default";

function normalized(doc: unknown) {
  const result = editorKit.validate(doc);
  if (!result.ok) throw new InvalidDocumentError(result.problems);
  return result.document;
}

export function documentFromYDoc(ydoc: Y.Doc): unknown {
  return yXmlFragmentToProsemirrorJSON(ydoc.getXmlFragment(Y_FRAGMENT));
}

export function yDocFromDocument(doc: unknown): Y.Doc {
  return prosemirrorJSONToYDoc(editorKit.schema, normalized(doc), Y_FRAGMENT);
}

export function applyDocument(ydoc: Y.Doc, doc: unknown, origin?: unknown): void {
  const node = editorKit.schema.nodeFromJSON(normalized(doc));
  const fragment = ydoc.getXmlFragment(Y_FRAGMENT);
  ydoc.transact(() => {
    updateYFragment(ydoc, fragment, node, { mapping: new Map(), isOMark: new Map() });
  }, origin);
}

export function migrateYDoc(ydoc: Y.Doc, fromVersion: number, origin?: unknown): boolean {
  if (fromVersion >= editorSchemaVersion) return false;
  const migrated = migrateDocument(documentFromYDoc(ydoc) as DocumentJson, fromVersion);
  applyDocument(ydoc, migrated, origin);
  return true;
}
