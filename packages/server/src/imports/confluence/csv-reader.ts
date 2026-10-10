import { ImportFormatError } from "../errors.js";
import { type ByteSource, gunzipIfCompressed } from "../formats/bytes.js";
import { readCsvRecords } from "../formats/csv.js";
import type { ZipEntryLocation } from "../formats/zip.js";
import type { ScanContext } from "../source.js";
import {
  confluenceDate,
  isCurrentStatus,
  kinds,
  pageSort,
  type ScannedArchive,
  STORAGE_BODY_TYPE,
  StagedConfluenceReader,
  scanArchive,
  titleKey,
  toNumber,
} from "./staged.js";

type Row = Record<string, string>;

const MAX_EXPANDED_BYTES = 64 * 1024 ** 3;
const PROGRESS_STEP = 1000;
const TABLES = ["user_mapping", "spaces", "content", "bodycontent", "label", "content_label"] as const;
type Table = (typeof TABLES)[number];

function value(row: Row, column: string): string {
  return (row[column] ?? "").trim();
}

function optional(row: Row, column: string): string | null {
  const text = value(row, column);
  return text.length > 0 ? text : null;
}

export class ConfluenceCsvReader extends StagedConfluenceReader {
  readonly source = "confluence-csv" as const;

  async scan(file: ByteSource, context: ScanContext): Promise<void> {
    const scanned = await scanArchive(file, context);
    if (scanned.format !== "csv") {
      throw new ImportFormatError("wrongFormat", "The file is an XML space export, not a CSV export.", {
        found: "xml",
      });
    }
    const done = new Set(
      Array.isArray(context.checkpoint.tables) ? (context.checkpoint.tables as string[]) : [],
    );
    let spaceRow: Row | null = null;
    const spaceKey = scanned.descriptor.spaceKey ?? null;
    let processed = 0;
    for (const table of TABLES) {
      const location = this.#location(scanned, table);
      if (!location) {
        if (table === "content" || table === "spaces") {
          throw new ImportFormatError("notConfluenceExport", "The export misses a required table.");
        }
        continue;
      }
      if (done.has(table) && table !== "spaces") continue;
      const rows = readCsvRecords(
        gunzipIfCompressed(await scanned.archive.openAt(location), MAX_EXPANDED_BYTES),
      );
      for await (const row of rows) {
        processed += 1;
        if (processed % PROGRESS_STEP === 0) {
          context.signal.throwIfAborted();
          await context.progress({ done: done.size, total: TABLES.length });
        }
        if (table === "spaces") {
          const key = value(row, "spacekey");
          if (spaceRow === null || key === spaceKey) spaceRow = row;
          continue;
        }
        await this.#stage(table, row, context);
      }
      await context.staging.flush();
      done.add(table);
      await context.saveCheckpoint({ tables: [...done] });
    }
    if (!spaceRow) throw new ImportFormatError("notConfluenceExport", "The export contains no space.");
    const spaceId = value(spaceRow, "spaceid");
    await context.staging.put({
      kind: kinds.space,
      sourceId: spaceId,
      data: {
        key: value(spaceRow, "spacekey"),
        name: value(spaceRow, "spacename"),
        homePageId: optional(spaceRow, "homepage"),
      },
    });
    await context.staging.flush();
    await context.staging.removeOtherThan(kinds.page, "spaceId", spaceId);
    await context.staging.orderTree(kinds.page);
  }

  #location(scanned: ScannedArchive, table: Table): ZipEntryLocation | undefined {
    return scanned.files.get(`${table}.csv`) ?? scanned.files.get(`${table}.csv.gz`);
  }

  async #stage(table: Table, row: Row, context: ScanContext): Promise<void> {
    switch (table) {
      case "user_mapping": {
        const key = value(row, "user_key");
        if (!key) return;
        await context.staging.put({
          kind: kinds.user,
          sourceId: key,
          data: { accountId: optional(row, "aaid") },
        });
        return;
      }
      case "content":
        await this.#content(row, context);
        return;
      case "bodycontent": {
        if (value(row, "bodytypeid") !== STORAGE_BODY_TYPE) return;
        const content = optional(row, "contentid");
        if (!content) return;
        await context.staging.put({
          kind: kinds.body,
          sourceId: value(row, "bodycontentid"),
          ref: content,
          data: { body: row.body ?? "" },
        });
        return;
      }
      case "label":
        await context.staging.put({
          kind: kinds.label,
          sourceId: value(row, "labelid"),
          data: { name: value(row, "name"), namespace: value(row, "namespace") || "global" },
        });
        return;
      case "content_label": {
        const content = optional(row, "contentid");
        const label = optional(row, "labelid");
        if (!content || !label) return;
        await context.staging.put({
          kind: kinds.labelling,
          sourceId: value(row, "id"),
          ref: content,
          data: { labelId: label },
        });
        return;
      }
      default:
        return;
    }
  }

  async #content(row: Row, context: ScanContext): Promise<void> {
    const type = value(row, "contenttype").toUpperCase();
    if (!isCurrentStatus(value(row, "content_status"))) return;
    const id = value(row, "contentid");
    if (!id) return;
    if (type === "PAGE") {
      if (optional(row, "prevver")) return;
      const title = value(row, "title");
      await context.staging.put({
        kind: kinds.page,
        sourceId: id,
        ref: titleKey(title),
        parentId: optional(row, "parentid"),
        sort: pageSort(toNumber(row.child_position), title),
        data: {
          title,
          version: toNumber(row.version) ?? 1,
          creatorKey: optional(row, "creator"),
          created: confluenceDate(row.creationdate),
          modifierKey: optional(row, "lastmodifier"),
          modified: confluenceDate(row.lastmoddate),
          spaceId: optional(row, "spaceid"),
        },
      });
      return;
    }
    if (type === "ATTACHMENT") {
      const pageId = optional(row, "pageid");
      if (!pageId) return;
      const originalId = optional(row, "prevver");
      await context.staging.put({
        kind: kinds.attachment,
        sourceId: id,
        ref: originalId ?? id,
        data: {
          pageId,
          originalId,
          fileName: value(row, "title"),
          version: toNumber(row.version) ?? 1,
          creatorKey: optional(row, "creator"),
          created: confluenceDate(row.creationdate),
        },
      });
    }
  }
}
