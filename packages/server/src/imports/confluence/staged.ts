import type { Readable } from "node:stream";
import { ImportFormatError } from "../errors.js";
import { type ByteSource, gunzipIfCompressed } from "../formats/bytes.js";
import { ZipArchive, type ZipEntryLocation } from "../formats/zip.js";
import type {
  ExportSummary,
  ImportReader,
  ImportSource,
  PersonReference,
  ReadContext,
  ScanContext,
  SourceAttachment,
  SourceAttachmentVersion,
  SourceBody,
  SourceComment,
  SourceCommentStatus,
  SourceContentType,
  SourceLabel,
  SourceLike,
  SourcePage,
  SourcePerson,
  SourceRestriction,
  SourceSpace,
  SourceSpacePermission,
  SourceVersion,
} from "../source.js";
import type { StagingStore } from "../staging.js";

export const STORAGE_BODY_TYPE = "2";

export interface StagedSpace {
  key: string;
  name: string;
  homePageId: string | null;
}

export interface StagedPage {
  type?: SourceContentType;
  title: string;
  version: number;
  creatorKey: string | null;
  created: string | null;
  modifierKey: string | null;
  modified: string | null;
}

export interface StagedAttachment {
  pageId: string;
  originalId: string | null;
  fileName: string;
  version: number;
  creatorKey: string | null;
  created: string | null;
}

export interface StagedBody {
  body: string;
}

export interface StagedLabel {
  name: string;
  namespace: string;
}

export interface StagedLabelling {
  labelId: string;
}

export interface StagedUser {
  accountId: string | null;
}

export interface StagedFile {
  size: number;
  location: ZipEntryLocation;
}

export interface StagedVersion {
  title: string;
  version: number;
  authorKey: string | null;
  created: string | null;
}

export interface StagedComment {
  creatorKey: string | null;
  created: string | null;
  modified: string | null;
}

export interface StagedProperty {
  name: string;
  value: string;
}

export interface StagedLike {
  userKey: string | null;
  created: string | null;
}

export interface StagedSpacePermission {
  spaceId: string | null;
  type: string;
  group: string | null;
  userKey: string | null;
  allUsers: boolean;
}

export interface StagedPermissionSet {
  contentId: string;
  type: string;
}

export interface StagedContentPermission {
  type: string | null;
  userKey: string | null;
  accountId: string | null;
  group: string | null;
}

export interface StagedRestriction {
  kind: "view" | "edit";
  origin: "table" | "legacy";
  userKey: string | null;
  accountId: string | null;
  group: string | null;
}

export const COMMENT_PROPERTIES = new Set([
  "inline-comment",
  "actualCommentType",
  "inline-marker-ref",
  "inline-original-selection",
  "status",
  "status-lastmodifier",
  "status-lastmoddate",
]);

export const kinds = {
  space: "space",
  page: "page",
  attachment: "attachment",
  body: "body",
  label: "label",
  labelling: "labelling",
  user: "user",
  file: "file",
  version: "version",
  comment: "comment",
  property: "property",
  like: "like",
  watch: "watch",
  spacePermission: "spacePermission",
  permissionSet: "permissionSet",
  contentPermission: "contentPermission",
  restriction: "restriction",
} as const;

export function versionSort(version: number): string {
  return String(Math.max(0, Math.trunc(version))).padStart(10, "0");
}

export function restrictionKind(type: string | null | undefined): "view" | "edit" | null {
  const value = (type ?? "").trim().toLowerCase();
  if (value === "view") return "view";
  if (value === "edit") return "edit";
  return null;
}

export function commentStatus(value: string | undefined): SourceCommentStatus {
  const status = (value ?? "").trim().toLowerCase();
  if (status === "resolved") return "resolved";
  if (status === "dangling") return "dangling";
  return "open";
}

export function propertyDate(value: string | undefined): string | null {
  if (!value) return null;
  const text = value.trim();
  if (/^\d{10,}$/.test(text)) {
    const date = new Date(Number(text));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return confluenceDate(text);
}

const POSITION_OFFSET = 1_000_000_000_000;

export function pageSort(position: number | null, title: string): string {
  if (position !== null && Number.isFinite(position)) {
    return `0${String(Math.trunc(position) + POSITION_OFFSET).padStart(16, "0")}`;
  }
  return `1${title.toLocaleLowerCase("en")}`;
}

export function titleKey(title: string): string {
  return title.trim().toLocaleLowerCase("en");
}

export function personId(accountId: string | null, userKey: string | null): string | null {
  if (accountId) return accountId;
  if (userKey) return `key:${userKey}`;
  return null;
}

export function isCurrentStatus(status: string): boolean {
  return status.trim().toLowerCase() === "current";
}

export function toNumber(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function confluenceDate(value: string | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?/.exec(value.trim());
  if (!match) return null;
  const date = new Date(`${match[1]}T${match[2]}${match[3] ?? ""}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export interface ArchiveLayout {
  readonly prefix: string;
  readonly descriptor: Readonly<Record<string, string>>;
}

export function parseProperties(text: string): Record<string, string> {
  const properties: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    properties[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return properties;
}

export function attachmentPaths(prefix: string, attachment: StagedAttachment, sourceId: string): string[] {
  const owner = attachment.originalId ?? sourceId;
  const paths = [`${prefix}attachments/${attachment.pageId}/${owner}/${attachment.version}`];
  if (owner !== sourceId)
    paths.push(`${prefix}attachments/${attachment.pageId}/${sourceId}/${attachment.version}`);
  return paths;
}

export abstract class StagedConfluenceReader implements ImportReader {
  abstract readonly source: ImportSource;

  abstract scan(file: ByteSource, context: ScanContext): Promise<void>;

  async #people(
    staging: StagingStore,
    keys: readonly (string | null)[],
  ): Promise<Map<string, string | null>> {
    const wanted = [...new Set(keys.filter((key): key is string => key !== null))];
    const users = await staging.get<StagedUser>(kinds.user, wanted);
    return new Map(wanted.map((key) => [key, personId(users.get(key)?.data.accountId ?? null, key)]));
  }

  async space(context: ReadContext): Promise<SourceSpace> {
    for await (const record of context.staging.iterate<StagedSpace>(kinds.space)) {
      return {
        sourceId: record.sourceId,
        key: record.data.key,
        name: record.data.name,
        homePageId: record.data.homePageId,
      };
    }
    throw new Error("The export has no space");
  }

  async summary(context: ReadContext): Promise<ExportSummary> {
    const space = await this.space(context);
    let attachments = 0;
    let attachmentBytes = 0;
    for await (const attachment of this.attachments(context)) {
      attachments += 1;
      const latest = attachment.versions.at(-1);
      if (latest?.file) {
        const file = await context.staging.get<StagedFile>(kinds.file, [latest.file]);
        attachmentBytes += file.get(latest.file)?.data.size ?? 0;
      }
    }
    let people = 0;
    for await (const _person of this.people(context)) people += 1;
    const blogPosts = await context.staging.count(kinds.page, { field: "type", value: "blogPost" });
    return {
      pages: (await context.staging.count(kinds.page)) - blogPosts,
      blogPosts,
      versions: await context.staging.count(kinds.version),
      comments: await context.staging.count(kinds.comment),
      likes: await context.staging.count(kinds.like),
      watchers: await context.staging.count(kinds.watch),
      attachments,
      attachmentBytes,
      people,
      spaceKey: space.key,
      spaceName: space.name,
    };
  }

  async *people(context: ReadContext): AsyncGenerator<SourcePerson> {
    const seen = new Set<string>();
    for await (const record of context.staging.iterate<StagedUser>(kinds.user)) {
      const id = personId(record.data.accountId, record.sourceId);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      yield { sourceId: id, accountId: record.data.accountId, userKey: record.sourceId };
    }
  }

  async *pages(context: ReadContext): AsyncGenerator<SourcePage> {
    let batch: { sourceId: string; parentId: string | null; data: StagedPage }[] = [];
    const flush = async function* (this: StagedConfluenceReader) {
      const people = await this.#people(
        context.staging,
        batch.flatMap((page) => [page.data.creatorKey, page.data.modifierKey]),
      );
      for (const page of batch) {
        yield {
          sourceId: page.sourceId,
          type: page.data.type ?? "page",
          parentId: page.data.type === "blogPost" ? null : page.parentId,
          title: page.data.title,
          creatorId: page.data.creatorKey ? (people.get(page.data.creatorKey) ?? null) : null,
          createdAt: page.data.created,
          modifierId: page.data.modifierKey ? (people.get(page.data.modifierKey) ?? null) : null,
          modifiedAt: page.data.modified,
          version: page.data.version,
        } satisfies SourcePage;
      }
      batch = [];
    }.bind(this);
    for await (const record of context.staging.iterate<StagedPage>(kinds.page, "ordinal")) {
      batch.push({ sourceId: record.sourceId, parentId: record.parentId, data: record.data });
      if (batch.length >= 200) yield* flush();
    }
    yield* flush();
  }

  async *versions(context: ReadContext, pageId: string): AsyncGenerator<SourceVersion> {
    let batch: { sourceId: string; data: StagedVersion }[] = [];
    const flush = async function* (this: StagedConfluenceReader) {
      const people = await this.#people(
        context.staging,
        batch.map((version) => version.data.authorKey),
      );
      for (const version of batch) {
        yield {
          sourceId: version.sourceId,
          pageId,
          version: version.data.version,
          title: version.data.title,
          authorId: version.data.authorKey ? (people.get(version.data.authorKey) ?? null) : null,
          createdAt: version.data.created,
        } satisfies SourceVersion;
      }
      batch = [];
    }.bind(this);
    for await (const record of context.staging.iterateRef<StagedVersion>(kinds.version, pageId, 20)) {
      batch.push({ sourceId: record.sourceId, data: record.data });
      if (batch.length >= 20) yield* flush();
    }
    yield* flush();
  }

  async comments(context: ReadContext, contentIds: readonly string[]): Promise<readonly SourceComment[]> {
    const records = (await context.staging.byRef<StagedComment>(kinds.comment, contentIds)).sort(
      (left, right) =>
        (left.ref ?? "").localeCompare(right.ref ?? "") ||
        (left.data.created ?? "").localeCompare(right.data.created ?? "") ||
        left.sourceId.localeCompare(right.sourceId),
    );
    const properties = await context.staging.byRef<StagedProperty>(
      kinds.property,
      records.map((comment) => comment.sourceId),
    );
    const byComment = new Map<string, Map<string, string>>();
    for (const property of properties) {
      if (!property.ref) continue;
      const map = byComment.get(property.ref) ?? new Map<string, string>();
      map.set(property.data.name, property.data.value);
      byComment.set(property.ref, map);
    }
    const people = await this.#people(context.staging, [
      ...records.map((comment) => comment.data.creatorKey),
      ...[...byComment.values()].map((map) => map.get("status-lastmodifier")?.trim() || null),
    ]);
    const result: SourceComment[] = [];
    for (const comment of records) {
      if (!comment.ref) continue;
      const own = byComment.get(comment.sourceId) ?? new Map<string, string>();
      const markerRef = own.get("inline-marker-ref")?.trim() || null;
      const inline =
        own.get("inline-comment")?.trim().toLowerCase() === "true" ||
        own.get("actualCommentType")?.trim().toLowerCase() === "inline" ||
        markerRef !== null;
      const status = commentStatus(own.get("status"));
      const resolverKey = own.get("status-lastmodifier")?.trim() || null;
      result.push({
        sourceId: comment.sourceId,
        pageId: comment.ref,
        parentId: comment.parentId,
        authorId: comment.data.creatorKey ? (people.get(comment.data.creatorKey) ?? null) : null,
        createdAt: comment.data.created,
        modifiedAt: comment.data.modified,
        inline:
          inline && comment.parentId === null
            ? { markerRef, selection: own.get("inline-original-selection") ?? null }
            : null,
        status,
        resolvedById: status === "resolved" && resolverKey ? (people.get(resolverKey) ?? null) : null,
        resolvedAt: status === "resolved" ? propertyDate(own.get("status-lastmoddate")) : null,
      });
    }
    return result;
  }

  async *likes(context: ReadContext): AsyncGenerator<SourceLike> {
    let batch: { sourceId: string; ref: string; data: StagedLike }[] = [];
    const flush = async function* (this: StagedConfluenceReader) {
      const people = await this.#people(
        context.staging,
        batch.map((like) => like.data.userKey),
      );
      for (const like of batch) {
        yield {
          sourceId: like.sourceId,
          contentId: like.ref,
          personId: like.data.userKey ? (people.get(like.data.userKey) ?? null) : null,
          createdAt: like.data.created,
        } satisfies SourceLike;
      }
      batch = [];
    }.bind(this);
    for await (const record of context.staging.iterate<StagedLike>(kinds.like, "ref")) {
      if (!record.ref) continue;
      batch.push({ sourceId: record.sourceId, ref: record.ref, data: record.data });
      if (batch.length >= 200) yield* flush();
    }
    yield* flush();
  }

  async *spacePermissions(context: ReadContext): AsyncGenerator<SourceSpacePermission> {
    const space = await this.space(context);
    let batch: { sourceId: string; data: StagedSpacePermission }[] = [];
    const flush = async function* (this: StagedConfluenceReader) {
      const people = await this.#people(
        context.staging,
        batch.map((record) => record.data.userKey),
      );
      for (const record of batch) {
        yield {
          sourceId: record.sourceId,
          type: record.data.type,
          group: record.data.group,
          personId: record.data.userKey ? (people.get(record.data.userKey) ?? null) : null,
          allUsers: record.data.allUsers,
        } satisfies SourceSpacePermission;
      }
      batch = [];
    }.bind(this);
    for await (const record of context.staging.iterate<StagedSpacePermission>(kinds.spacePermission)) {
      if (record.data.spaceId !== null && record.data.spaceId !== space.sourceId) continue;
      batch.push({ sourceId: record.sourceId, data: record.data });
      if (batch.length >= 200) yield* flush();
    }
    yield* flush();
  }

  async restrictions(
    context: ReadContext,
    contentIds: readonly string[],
  ): Promise<readonly SourceRestriction[]> {
    const records = await context.staging.byRef<StagedRestriction>(kinds.restriction, contentIds);
    const people = await this.#people(
      context.staging,
      records.map((record) => record.data.userKey),
    );
    const result: SourceRestriction[] = [];
    for (const record of records) {
      if (!record.ref) continue;
      result.push({
        sourceId: record.sourceId,
        contentId: record.ref,
        kind: record.data.kind,
        personId: record.data.accountId
          ? personId(record.data.accountId, null)
          : record.data.userKey
            ? (people.get(record.data.userKey) ?? null)
            : null,
        group: record.data.group,
      });
    }
    return result;
  }

  async bodies(context: ReadContext, pageIds: readonly string[]): Promise<ReadonlyMap<string, SourceBody>> {
    const records = await context.staging.byRef<StagedBody>(kinds.body, pageIds);
    const result = new Map<string, SourceBody>();
    for (const record of records) {
      if (!record.ref) continue;
      const existing = result.get(record.ref);
      if (!existing || record.data.body.length > existing.content.length) {
        result.set(record.ref, { format: "confluence-storage", content: record.data.body });
      }
    }
    return result;
  }

  async *attachments(context: ReadContext): AsyncGenerator<SourceAttachment> {
    const prefix = await this.#prefix(context.staging);
    type Group = { owner: string; versions: { sourceId: string; data: StagedAttachment }[] };
    let groups: Group[] = [];
    let current = null as Group | null;
    const emit = async (batch: Group[]): Promise<SourceAttachment[]> => {
      const latestOf = (group: Group) =>
        [...group.versions].sort((a, b) => a.data.version - b.data.version).at(-1)?.data;
      const pages = await context.staging.get<StagedPage>(
        kinds.page,
        batch.map((group) => latestOf(group)?.pageId ?? ""),
      );
      const kept = batch.filter((group) => pages.has(latestOf(group)?.pageId ?? ""));
      const files = await context.staging.get<StagedFile>(
        kinds.file,
        kept.flatMap((group) =>
          group.versions.flatMap((version) => attachmentPaths(prefix, version.data, version.sourceId)),
        ),
      );
      const people = await this.#people(
        context.staging,
        kept.flatMap((group) => group.versions.map((version) => version.data.creatorKey)),
      );
      return kept.map((group) => {
        const sorted = [...group.versions].sort((a, b) => a.data.version - b.data.version);
        const latest = sorted.at(-1)?.data as StagedAttachment;
        const versions: SourceAttachmentVersion[] = sorted.map((version) => ({
          sourceId: version.sourceId,
          version: version.data.version,
          creatorId: version.data.creatorKey ? (people.get(version.data.creatorKey) ?? null) : null,
          createdAt: version.data.created,
          file:
            attachmentPaths(prefix, version.data, version.sourceId).find((path) => files.has(path)) ?? null,
        }));
        return { sourceId: group.owner, pageId: latest.pageId, fileName: latest.fileName, versions };
      });
    };
    for await (const record of context.staging.iterate<StagedAttachment>(kinds.attachment, "ref")) {
      const owner = record.ref ?? record.sourceId;
      if (current?.owner !== owner) {
        if (current) groups.push(current);
        current = { owner, versions: [] };
        if (groups.length >= 100) {
          yield* await emit(groups);
          groups = [];
        }
      }
      current.versions.push({ sourceId: record.sourceId, data: record.data });
    }
    if (current) groups.push(current);
    if (groups.length > 0) yield* await emit(groups);
  }

  async #prefix(staging: StagingStore): Promise<string> {
    const layout = await staging.get<{ prefix: string }>("layout", ["layout"]);
    return layout.get("layout")?.data.prefix ?? "";
  }

  async openFile(file: ByteSource, context: ReadContext, path: string): Promise<Readable | null> {
    const stored = await context.staging.get<StagedFile>(kinds.file, [path]);
    const location = stored.get(path)?.data.location;
    if (!location) return null;
    const archive = await ZipArchive.open(file);
    return archive.openAt(location);
  }

  async pagesByTitle(context: ReadContext, titles: readonly string[]): Promise<ReadonlyMap<string, string>> {
    const wanted = [...new Set(titles.map(titleKey))];
    const records = await context.staging.byRef<StagedPage>(kinds.page, wanted);
    const result = new Map<string, string>();
    for (const record of records)
      if (record.ref && !result.has(record.ref)) result.set(record.ref, record.sourceId);
    return result;
  }

  async resolvePeople(
    context: ReadContext,
    references: readonly PersonReference[],
  ): Promise<readonly (SourcePerson | null)[]> {
    const keys = references
      .map((reference) => reference.userKey)
      .filter((key): key is string => key !== null);
    const users = await context.staging.get<StagedUser>(kinds.user, keys);
    return references.map((reference) => {
      const accountId =
        reference.accountId ??
        (reference.userKey ? (users.get(reference.userKey)?.data.accountId ?? null) : null);
      const sourceId = personId(accountId, reference.userKey);
      return sourceId ? { sourceId, accountId, userKey: reference.userKey } : null;
    });
  }

  async labels(context: ReadContext, pageIds: readonly string[]): Promise<readonly SourceLabel[]> {
    const labellings = await context.staging.byRef<StagedLabelling>(kinds.labelling, pageIds);
    const labels = await context.staging.get<StagedLabel>(
      kinds.label,
      labellings.map((labelling) => labelling.data.labelId),
    );
    const result: SourceLabel[] = [];
    const seen = new Set<string>();
    for (const labelling of labellings) {
      const label = labels.get(labelling.data.labelId);
      if (!label || !labelling.ref) continue;
      const namespace = label.data.namespace.trim().toLowerCase();
      if (namespace !== "" && namespace !== "global" && namespace !== "team") continue;
      const key = `${labelling.ref}\u0000${label.data.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ pageId: labelling.ref, name: label.data.name });
    }
    return result;
  }
}

export async function stageRestrictions(staging: StagingStore): Promise<void> {
  await staging.flush();
  if ((await staging.count(kinds.restriction, { field: "origin", value: "table" })) > 0) {
    await staging.removeWhere(kinds.restriction, "origin", "legacy");
    await staging.remove(kinds.contentPermission);
    await staging.remove(kinds.permissionSet);
    return;
  }
  let batch: { sourceId: string; ref: string; data: StagedContentPermission }[] = [];
  const flush = async () => {
    const sets = await staging.get<StagedPermissionSet>(
      kinds.permissionSet,
      batch.map((permission) => permission.ref),
    );
    for (const permission of batch) {
      const set = sets.get(permission.ref);
      const kind = restrictionKind(set?.data.type ?? permission.data.type);
      if (!set || !kind || (!permission.data.userKey && !permission.data.accountId && !permission.data.group))
        continue;
      await staging.put({
        kind: kinds.restriction,
        sourceId: permission.sourceId,
        ref: set.data.contentId,
        data: {
          kind,
          origin: "legacy",
          userKey: permission.data.userKey,
          accountId: permission.data.accountId,
          group: permission.data.group,
        } satisfies StagedRestriction,
      });
    }
    batch = [];
  };
  for await (const record of staging.iterate<StagedContentPermission>(kinds.contentPermission)) {
    if (!record.ref) continue;
    batch.push({ sourceId: record.sourceId, ref: record.ref, data: record.data });
    if (batch.length >= 200) await flush();
  }
  await flush();
  await staging.flush();
  await staging.remove(kinds.contentPermission);
  await staging.remove(kinds.permissionSet);
}

export interface ScannedArchive {
  readonly archive: ZipArchive;
  readonly prefix: string;
  readonly descriptor: Readonly<Record<string, string>>;
  readonly files: ReadonlyMap<string, ZipEntryLocation>;
  readonly format: "xml" | "csv";
}

const MARKERS = [
  "exportDescriptor.properties",
  "exportDescriptor.properties.gz",
  "entities.xml",
  "content.csv",
  "content.csv.gz",
];
const DESCRIPTOR_BYTES = 64 * 1024;

function markerPrefix(name: string): string | null {
  for (const marker of MARKERS) {
    if (name === marker) return "";
    if (name.endsWith(`/${marker}`)) {
      const prefix = name.slice(0, -marker.length);
      if (prefix.split("/").length === 2) return prefix;
    }
  }
  return null;
}

export async function scanArchive(file: ByteSource, context: ScanContext): Promise<ScannedArchive> {
  const archive = await ZipArchive.open(file);
  const entries: { name: string; location: ZipEntryLocation }[] = [];
  let prefix: string | null = null;
  const problems: { code: string; name: string }[] = [];
  let count = 0;
  for await (const entry of archive.entries((problem) => problems.push(problem))) {
    count += 1;
    if (count % 1000 === 0) context.signal.throwIfAborted();
    const candidate = markerPrefix(entry.name);
    if (candidate !== null && (prefix === null || candidate.length < prefix.length)) prefix = candidate;
    if (entry.name.includes("/attachments/") || entry.name.startsWith("attachments/")) {
      await context.staging.put({
        kind: kinds.file,
        sourceId: entry.name,
        data: { size: entry.size, location: entry.location },
      });
    } else entries.push({ name: entry.name, location: entry.location });
  }
  for (const problem of problems) await context.problem(problem.code, { name: problem.name });
  if (prefix === null) {
    throw new ImportFormatError("notConfluenceExport", "The archive is not a Confluence space export.");
  }
  const files = new Map<string, ZipEntryLocation>();
  for (const entry of entries) {
    if (entry.name.startsWith(prefix)) files.set(entry.name.slice(prefix.length), entry.location);
  }
  await context.staging.put({ kind: "layout", sourceId: "layout", data: { prefix } });
  const descriptorLocation =
    files.get("exportDescriptor.properties") ?? files.get("exportDescriptor.properties.gz");
  let descriptor: Record<string, string> = {};
  if (descriptorLocation) {
    const chunks: Buffer[] = [];
    for await (const chunk of gunzipIfCompressed(
      await archive.openAt(descriptorLocation),
      DESCRIPTOR_BYTES,
    )) {
      chunks.push(chunk);
    }
    descriptor = parseProperties(Buffer.concat(chunks).toString("utf8"));
  }
  const exportType = descriptor.exportType?.toLowerCase();
  if (exportType && exportType !== "space") {
    throw new ImportFormatError("notSpaceExport", "The archive is a site export, not a space export.");
  }
  const csv =
    descriptor.exportFormat?.toLowerCase() === "csv" ||
    (!files.has("entities.xml") && (files.has("content.csv") || files.has("content.csv.gz")));
  if (!csv && !files.has("entities.xml")) {
    throw new ImportFormatError("notConfluenceExport", "The archive is not a Confluence space export.");
  }
  return { archive, prefix, descriptor, files, format: csv ? "csv" : "xml" };
}
