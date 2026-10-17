import { createHash } from "node:crypto";
import { uuidv7 } from "@pagehall/shared";
import { sql } from "drizzle-orm";
import type { Executor } from "../database/database.js";

export const reportCategories = {
  macros: ["unsupportedMacro"],
  diagrams: ["diagramFileMissing", "gliffyDiagram", "diagramPageMissing"],
  attachments: ["missingAttachment", "attachmentFileMissing", "attachmentTooLarge", "attachmentUnreadable"],
  links: ["externalPageLink", "unsupportedLink", "invalidLink", "externalImage"],
  content: ["invalidContent", "contentTruncated", "macroDataTruncated", "unresolvedPerson", "invalidLabel"],
  comments: ["inlineCommentMoved", "tooManyComments"],
  archive: ["duplicateEntry", "skippedEntry"],
} as const;

export type ReportCategory = keyof typeof reportCategories;
export type ProblemCode = (typeof reportCategories)[ReportCategory][number];
export const reportCategoryNames = Object.keys(reportCategories) as ReportCategory[];
export const problemCodes = Object.values(reportCategories).flat() as ProblemCode[];

export function categoryOf(code: string): ReportCategory | null {
  for (const [category, codes] of Object.entries(reportCategories)) {
    if ((codes as readonly string[]).includes(code)) return category as ReportCategory;
  }
  return null;
}

export interface ProblemInput {
  readonly code: ProblemCode;
  readonly sourceKind?: string | null;
  readonly sourceId?: string | null;
  readonly itemId?: string | null;
  readonly details?: Readonly<Record<string, string | number | null>>;
}

function problemKey(input: ProblemInput): string {
  const details = JSON.stringify(Object.entries(input.details ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  return createHash("sha256")
    .update(`${input.code}\u0000${input.sourceKind ?? ""}\u0000${input.sourceId ?? ""}\u0000${details}`)
    .digest("base64url");
}

export async function recordProblems(
  executor: Executor,
  importId: string,
  problems: readonly ProblemInput[],
): Promise<void> {
  if (problems.length === 0) return;
  const rows = problems.map((problem) => {
    const category = categoryOf(problem.code);
    if (!category) throw new Error(`Unknown report entry ${problem.code}`);
    return {
      id: uuidv7(),
      category,
      code: problem.code,
      key: problemKey(problem),
      source_kind: problem.sourceKind ?? null,
      source_id: problem.sourceId ?? null,
      item_id: problem.itemId ?? null,
      details: problem.details ?? {},
    };
  });
  await executor.execute(sql`
    insert into import_problems (id, import_id, category, code, key, source_kind, source_id, item_id, details)
    select r.id, ${importId}, r.category, r.code, r.key, r.source_kind, r.source_id, r.item_id, r.details
    from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
      as r(id uuid, category text, code text, key text, source_kind text, source_id text, item_id uuid, details jsonb)
    on conflict (import_id, key) do nothing`);
}
