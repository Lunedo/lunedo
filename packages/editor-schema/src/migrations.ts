import type { DocumentJson } from "./json.js";

export const editorSchemaVersion = 1;

export type Migration = (doc: DocumentJson) => DocumentJson;

export const migrations: Record<number, Migration> = {};

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
