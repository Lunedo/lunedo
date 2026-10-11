import type { DocumentJson, NodeJson } from "./json.js";

export const editorSchemaVersion = 6;

export type Migration = (doc: DocumentJson) => DocumentJson;

function mapNodes(node: NodeJson, change: (node: NodeJson) => NodeJson): NodeJson {
  const changed = change(node);
  return changed.content
    ? { ...changed, content: changed.content.map((child) => mapNodes(child, change)) }
    : changed;
}

export const migrations: Record<number, Migration> = {
  1: (doc) => doc,
  2: (doc) =>
    mapNodes(doc, (node) => {
      if (node.type !== "taskItem" || !node.attrs || !("checked" in node.attrs)) return node;
      const { checked: _checked, ...attrs } = node.attrs;
      return { ...node, attrs };
    }) as DocumentJson,
  3: (doc) => doc,
  4: (doc) => doc,
  5: (doc) => doc,
};

export class MigrationError extends Error {
  override name = "MigrationError";
}

export function migrateDocument(
  json: DocumentJson,
  fromVersion: number,
  available: Record<number, Migration> = migrations,
  toVersion: number = editorSchemaVersion,
): DocumentJson {
  if (!Number.isInteger(fromVersion) || fromVersion < 1) {
    throw new MigrationError(`Unknown schema version ${fromVersion}`);
  }
  if (fromVersion > toVersion) {
    throw new MigrationError(`Schema version ${fromVersion} is newer than ${toVersion}`);
  }
  let document = json;
  for (let version = fromVersion; version < toVersion; version += 1) {
    const migration = available[version];
    if (!migration) throw new MigrationError(`No migration from schema version ${version}`);
    document = migration(document);
  }
  return document;
}
