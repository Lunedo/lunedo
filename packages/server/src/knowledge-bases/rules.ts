import { sql } from "drizzle-orm";
import type { Executor } from "../database/database.js";
import { SpaceError } from "../spaces/common.js";
import type { SpaceType, TreeItemKind } from "../spaces/schema.js";

export const KNOWLEDGE_BASE_KINDS: ReadonlySet<TreeItemKind> = new Set<TreeItemKind>(["page", "folder"]);

export async function spaceTypeOf(executor: Executor, spaceId: string): Promise<SpaceType | null> {
  const result = await executor.execute<{ type: SpaceType }>(
    sql`select type from spaces where id = ${spaceId}`,
  );
  return result.rows[0]?.type ?? null;
}

export async function isKnowledgeBase(executor: Executor, spaceId: string): Promise<boolean> {
  return (await spaceTypeOf(executor, spaceId)) === "knowledgeBase";
}

export function knowledgeBaseKindError(): SpaceError {
  return new SpaceError(
    "knowledgeBaseContent",
    "A knowledge base contains only articles and categories. Blog posts, meetings, whiteboards and links belong in other spaces.",
  );
}

export function knowledgeBaseModeError(): SpaceError {
  return new SpaceError(
    "knowledgeBaseMode",
    "Articles always use publish mode, so readers see only published versions.",
  );
}

export function knowledgeBasePlacementError(): SpaceError {
  return new SpaceError(
    "knowledgeBasePlacement",
    "Articles and categories are placed in categories or at the top level of a knowledge base, not below articles.",
  );
}

export async function checkKnowledgeBaseSubtree(
  executor: Executor,
  itemId: string,
  descendants = true,
): Promise<void> {
  const result = await executor.execute<{ wrong_kind: boolean; live: boolean; nested: boolean }>(sql`
    with subtree as (
      select d.id, d.kind, d.mode, d.parent_id from tree_items d
      where d.id = ${itemId} or (${descendants} and ${itemId}::uuid = any(d.path) and d.trash_entry_id is null)
    )
    select
      exists (select 1 from subtree where kind not in ('page', 'folder')) as wrong_kind,
      exists (select 1 from subtree where kind = 'page' and mode <> 'publish') as live,
      exists (select 1 from subtree c join tree_items p on p.id = c.parent_id
        where c.id <> ${itemId} and p.kind <> 'folder') as nested`);
  const row = result.rows[0];
  if (row?.wrong_kind) throw knowledgeBaseKindError();
  if (row?.live) throw knowledgeBaseModeError();
  if (row?.nested) throw knowledgeBasePlacementError();
}

const TRIGGER_ERRORS: Record<string, () => SpaceError> = {
  tree_items_knowledge_base_kind: knowledgeBaseKindError,
  tree_items_knowledge_base_mode: knowledgeBaseModeError,
  tree_items_knowledge_base_parent: knowledgeBasePlacementError,
};

export function knowledgeBaseViolation(error: unknown): SpaceError | null {
  const cause = (error as { cause?: unknown }).cause ?? error;
  const details = cause as { code?: string; constraint?: string };
  if (details.code !== "23514" || !details.constraint) return null;
  return TRIGGER_ERRORS[details.constraint]?.() ?? null;
}

export function rethrowKnowledgeBaseViolation(error: unknown): never {
  throw knowledgeBaseViolation(error) ?? error;
}
