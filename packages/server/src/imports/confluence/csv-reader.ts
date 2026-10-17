import { ImportFormatError } from "../errors.js";
import { type ByteSource, gunzipIfCompressed } from "../formats/bytes.js";
import { readCsvRecords } from "../formats/csv.js";
import type { ZipEntryLocation } from "../formats/zip.js";
import type { ScanContext } from "../source.js";
import {
  confluenceDate,
  contentKind,
  contentState,
  formerTitleRecord,
  isCurrentStatus,
  isProductAdmins,
  isTombstone,
  KEPT_PROPERTIES,
  kinds,
  pageSort,
  reportTrashed,
  type ScannedArchive,
  STORAGE_BODY_TYPE,
  StagedConfluenceReader,
  scanArchive,
  stageRestrictions,
  stageTrashed,
  titleKey,
  toNumber,
  versionSort,
} from "./staged.js";

type Row = Record<string, string>;

const MAX_EXPANDED_BYTES = 64 * 1024 ** 3;
const TREE_TYPES = new Set(["PAGE", "BLOGPOST", "FOLDER", "EMBED", "WHITEBOARD", "DATABASE"]);
const PROGRESS_STEP = 1000;
const TABLES = [
  "user_mapping",
  "spaces",
  "content",
  "bodycontent",
  "label",
  "content_label",
  "contentproperties",
  "likes",
  "notifications",
  "spacepermissions",
  "content_permissions",
  "content_perm_set",
  "content_perm",
  "pagetemplates",
] as const;
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
    await context.staging.removeOtherThan(kinds.template, "spaceId", spaceId);
    await context.staging.orderTree(kinds.page);
    await stageRestrictions(context.staging);
    await reportTrashed(context, spaceId);
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
      case "contentproperties": {
        const name = value(row, "propertyname");
        const content = optional(row, "contentid");
        if (!content || !KEPT_PROPERTIES.has(name)) return;
        const text = optional(row, "stringval") ?? optional(row, "longval") ?? optional(row, "dateval");
        await context.staging.put({
          kind: kinds.property,
          sourceId: value(row, "propertyid"),
          ref: content,
          data: { name, value: (text ?? "").slice(0, 2000) },
        });
        return;
      }
      case "likes": {
        const content = optional(row, "contentid");
        if (!content || value(row, "liked").toLowerCase() === "false") return;
        await context.staging.put({
          kind: kinds.like,
          sourceId: value(row, "id"),
          ref: content,
          data: { userKey: optional(row, "username"), created: confluenceDate(row.creationdate) },
        });
        return;
      }
      case "notifications": {
        const id = optional(row, "notificationid");
        if (id) await context.staging.put({ kind: kinds.watch, sourceId: id, data: {} });
        return;
      }
      case "spacepermissions": {
        if (
          value(row, "active").toLowerCase() === "false" ||
          isProductAdmins(value(row, "permalluserssubject"))
        )
          return;
        await context.staging.put({
          kind: kinds.spacePermission,
          sourceId: value(row, "permid"),
          data: {
            spaceId: optional(row, "spaceid"),
            type: value(row, "permtype").toUpperCase(),
            group: optional(row, "permgroupname"),
            userKey: optional(row, "permusername"),
            allUsers: optional(row, "permalluserssubject") !== null,
          },
        });
        return;
      }
      case "content_permissions": {
        const content = optional(row, "content_id");
        const kind = value(row, "permission_type").toLowerCase();
        if (!content || optional(row, "deleted_id") || (kind !== "view" && kind !== "edit")) return;
        const group = value(row, "principal_type").toUpperCase() === "GROUP";
        const principal = optional(row, "principal_id");
        const groupName = optional(row, "groupname");
        if ((group ? !groupName : !principal) || isTombstone(groupName, group ? null : principal)) return;
        await context.staging.put({
          kind: kinds.restriction,
          sourceId: `${content}:${kind}:${group ? `group:${groupName}` : `user:${principal}`}`,
          ref: content,
          data: {
            kind,
            origin: "table",
            userKey: null,
            accountId: group ? null : principal,
            group: group ? groupName : null,
          },
        });
        return;
      }
      case "content_perm_set": {
        const content = optional(row, "content_id");
        if (!content) return;
        await context.staging.put({
          kind: kinds.permissionSet,
          sourceId: value(row, "id"),
          data: { contentId: content, type: value(row, "cont_perm_type") },
        });
        return;
      }
      case "content_perm": {
        const set = optional(row, "cps_id");
        if (!set) return;
        await context.staging.put({
          kind: kinds.contentPermission,
          sourceId: value(row, "id"),
          ref: set,
          data: {
            type: value(row, "cp_type"),
            userKey: optional(row, "username"),
            accountId: null,
            group: optional(row, "groupname"),
          },
        });
        return;
      }
      case "pagetemplates": {
        const spaceId = optional(row, "spaceid");
        const bodyType = optional(row, "bodytypeid") ?? STORAGE_BODY_TYPE;
        if (!spaceId || optional(row, "prevver") || bodyType !== STORAGE_BODY_TYPE) return;
        await context.staging.put({
          kind: kinds.template,
          sourceId: value(row, "templateid"),
          data: {
            name: value(row, "templatename"),
            description: value(row, "templatedesc"),
            body: row.content ?? "",
            spaceId,
            creatorKey: optional(row, "creator"),
            created: confluenceDate(row.creationdate),
            modified: confluenceDate(row.lastmoddate),
          },
        });
        return;
      }
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
    const id = value(row, "contentid");
    if (!id) return;
    if (TREE_TYPES.has(type)) {
      const state = contentState(value(row, "content_status"));
      if (state === "other") return;
      const title = value(row, "title");
      const version = toNumber(row.version) ?? 1;
      const original = optional(row, "prevver");
      if (state === "trashed") {
        if (!original) await stageTrashed(context.staging, id, title, optional(row, "spaceid"));
        return;
      }
      if (original) {
        await context.staging.put({
          kind: kinds.version,
          sourceId: id,
          ref: original,
          sort: versionSort(version),
          data: {
            title,
            version,
            authorKey: optional(row, "lastmodifier") ?? optional(row, "creator"),
            created: confluenceDate(row.lastmoddate) ?? confluenceDate(row.creationdate),
          },
        });
        if (title) await context.staging.put(formerTitleRecord(original, title));
        return;
      }
      const blog = type === "BLOGPOST";
      const created = confluenceDate(row.creationdate);
      await context.staging.put({
        kind: kinds.page,
        sourceId: id,
        ref: titleKey(title),
        parentId: blog ? null : optional(row, "parentid"),
        sort: blog ? `2${created ?? ""}` : pageSort(toNumber(row.child_position), title),
        data: {
          ...contentKind(type),
          ...(state === "archived" ? { archived: true } : {}),
          title,
          version,
          creatorKey: optional(row, "creator"),
          created,
          modifierKey: optional(row, "lastmodifier"),
          modified: confluenceDate(row.lastmoddate),
          spaceId: optional(row, "spaceid"),
        },
      });
      return;
    }
    if (!isCurrentStatus(value(row, "content_status"))) return;
    if (type === "COMMENT") {
      if (optional(row, "prevver")) return;
      const container = optional(row, "pageid");
      if (!container) return;
      const created = confluenceDate(row.creationdate);
      await context.staging.put({
        kind: kinds.comment,
        sourceId: id,
        ref: container,
        parentId: optional(row, "parentcommentid"),
        sort: created ?? "",
        data: { creatorKey: optional(row, "creator"), created, modified: confluenceDate(row.lastmoddate) },
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
