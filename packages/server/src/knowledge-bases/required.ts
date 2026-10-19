import { articleSections, type DocumentJson, emptySections } from "@pagehall/editor-schema";
import { sql } from "drizzle-orm";
import type { Executor } from "../database/database.js";
import { SpaceError } from "../spaces/common.js";

export interface MissingSection {
  key: string;
  title: string;
}

export async function missingRequiredSections(
  executor: Executor,
  itemId: string,
  document: DocumentJson,
): Promise<MissingSection[]> {
  const result = await executor.execute<{ section_key: string; section_title: string }>(sql`
    select r.section_key, r.section_title from tree_items t
    join spaces s on s.id = t.space_id and s.type = 'knowledgeBase'
    join knowledge_base_required_sections r on r.space_id = t.space_id and r.template_id = t.template_id
    where t.id = ${itemId} and t.kind = 'page'
    order by r.section_key`);
  if (result.rows.length === 0) return [];
  const empty = new Set(
    emptySections(
      document,
      result.rows.map((row) => row.section_key),
    ),
  );
  const titles = new Map(articleSections(document).map((section) => [section.key, section.title]));
  return result.rows
    .filter((row) => empty.has(row.section_key))
    .map((row) => ({
      key: row.section_key,
      title: titles.get(row.section_key) || row.section_title || row.section_key,
    }));
}

export async function requireSections(
  executor: Executor,
  itemId: string,
  document: DocumentJson,
): Promise<void> {
  const missing = await missingRequiredSections(executor, itemId, document);
  if (missing.length === 0) return;
  throw new SpaceError(
    "requiredSectionsEmpty",
    missing.length === 1
      ? `The required section "${missing[0]?.title}" is empty. Fill it in, then publish again.`
      : `${missing.length} required sections are empty. Fill them in, then publish again.`,
    { sections: missing },
  );
}
