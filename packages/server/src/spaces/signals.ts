import { sql } from "drizzle-orm";
import type { Executor } from "../database/database.js";

export const SPACE_CHANGES_CHANNEL = "lunedo_space_changes";
export const DOCUMENT_CHANGES_CHANNEL = "lunedo_document_changes";

export const spaceChangeKinds = [
  "space",
  "tree",
  "page",
  "draft",
  "access",
  "comments",
  "reactions",
  "tasks",
  "blog",
  "meetings",
] as const;
export type SpaceChangeKind = (typeof spaceChangeKinds)[number];

export interface SpaceChangeSignal {
  spaceId: string;
  kind: SpaceChangeKind;
  itemId: string | null;
}

export interface DocumentChangeSignal {
  itemId: string;
  revision: number;
  origin: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function signalSpaceChange(executor: Executor, signal: SpaceChangeSignal): Promise<void> {
  await executor.execute(sql`select pg_notify(${SPACE_CHANGES_CHANNEL}, ${JSON.stringify(signal)})`);
}

export async function signalDocumentChange(executor: Executor, signal: DocumentChangeSignal): Promise<void> {
  await executor.execute(sql`select pg_notify(${DOCUMENT_CHANGES_CHANNEL}, ${JSON.stringify(signal)})`);
}

export function parseSpaceChangeSignal(payload: string): SpaceChangeSignal | null {
  try {
    const parsed = JSON.parse(payload) as Partial<SpaceChangeSignal>;
    if (
      typeof parsed.spaceId === "string" &&
      UUID.test(parsed.spaceId) &&
      spaceChangeKinds.includes(parsed.kind as SpaceChangeKind) &&
      (parsed.itemId === null || (typeof parsed.itemId === "string" && UUID.test(parsed.itemId)))
    ) {
      return { spaceId: parsed.spaceId, kind: parsed.kind as SpaceChangeKind, itemId: parsed.itemId };
    }
  } catch {
    return null;
  }
  return null;
}

export function parseDocumentChangeSignal(payload: string): DocumentChangeSignal | null {
  try {
    const parsed = JSON.parse(payload) as Partial<DocumentChangeSignal>;
    if (
      typeof parsed.itemId === "string" &&
      UUID.test(parsed.itemId) &&
      typeof parsed.revision === "number" &&
      typeof parsed.origin === "string"
    ) {
      return { itemId: parsed.itemId, revision: parsed.revision, origin: parsed.origin };
    }
  } catch {
    return null;
  }
  return null;
}
