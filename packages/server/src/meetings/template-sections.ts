import type { DocumentJson, NodeJson } from "@lunedo/editor-schema";
import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../database/database.js";
import { defineJob } from "../jobs/job-queue.js";
import type { Logger } from "../logging/logger.js";
import type { PageDocumentService } from "../spaces/documents.js";

export const LEGACY_SECTION_KEYS = [
  "agenda",
  "topics",
  "openTasks",
  "newTasks",
  "decisions",
  "notes",
] as const;

export const meetingTemplateSectionsJob = defineJob({
  name: "meetings.remove-template-sections",
  duringMaintenance: "wait",
  payload: z.object({}),
  retryLimit: 3,
  expireInSeconds: 30 * 60,
});

const LISTS = new Set(["bulletList", "orderedList", "taskList"]);

function untouchedParagraph(node: NodeJson): boolean {
  return node.type === "paragraph" && (node.content ?? []).every((child) => child.type === "placeholder");
}

function untouched(node: NodeJson): boolean {
  if (node.type === "taskReport") return true;
  if (untouchedParagraph(node)) return true;
  if (LISTS.has(node.type)) {
    return (node.content ?? []).every((item) => (item.content ?? []).every(untouchedParagraph));
  }
  return false;
}

function legacySection(node: NodeJson): boolean {
  return (
    node.type === "section" &&
    typeof node.attrs?.key === "string" &&
    (LEGACY_SECTION_KEYS as readonly string[]).includes(node.attrs.key)
  );
}

export function withoutTemplateSections(document: DocumentJson): DocumentJson | null {
  const content = document.content ?? [];
  const kept = content.filter((node) => !(legacySection(node) && (node.content ?? []).every(untouched)));
  if (kept.length === content.length) return null;
  return { ...document, content: kept.length > 0 ? kept : [{ type: "paragraph" }] };
}

const LEGACY_FILTER = sql.raw(
  `jsonb_path_exists(d.snapshot, '$.content[*] ? (@.type == "section" && (${LEGACY_SECTION_KEYS.map(
    (key) => `@.attrs.key == "${key}"`,
  ).join(" || ")}))')`,
);

export class MeetingTemplateSections {
  readonly #database: Database;
  readonly #documents: PageDocumentService;

  constructor(options: { database: Database; documents: PageDocumentService }) {
    this.#database = options.database;
    this.#documents = options.documents;
  }

  async #candidates(after: string | null): Promise<string[]> {
    const result = await this.#database.execute<{ item_id: string }>(sql`
      select d.item_id from page_documents d join meetings m on m.item_id = d.item_id
      where ${LEGACY_FILTER} ${after ? sql`and d.item_id > ${after}` : sql``}
      order by d.item_id limit 100`);
    return result.rows.map((row) => row.item_id);
  }

  async pending(): Promise<boolean> {
    return (await this.#candidates(null)).length > 0;
  }

  async removeUntouched(logger: Logger, signal?: AbortSignal): Promise<{ cleaned: number; kept: number }> {
    let cleaned = 0;
    let kept = 0;
    let after: string | null = null;
    for (;;) {
      const batch = await this.#candidates(after);
      if (batch.length === 0) break;
      for (const id of batch) {
        signal?.throwIfAborted();
        const changed = await this.#database.transaction((tx) =>
          this.#documents.editLocked(tx, id, withoutTemplateSections, null),
        );
        if (changed) cleaned += 1;
        else kept += 1;
      }
      after = batch.at(-1) ?? null;
    }
    logger.info({ cleaned, kept }, "Unused template sections removed from meeting pages");
    return { cleaned, kept };
  }
}
