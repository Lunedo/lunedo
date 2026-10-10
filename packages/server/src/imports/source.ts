import type { Readable } from "node:stream";
import type { ByteSource } from "./formats/bytes.js";
import type { StagingStore } from "./staging.js";

export const importSources = ["confluence-xml", "confluence-csv"] as const;
export type ImportSource = (typeof importSources)[number];

export interface SourceSpace {
  readonly sourceId: string;
  readonly key: string;
  readonly name: string;
  readonly homePageId: string | null;
}

export interface SourcePerson {
  readonly sourceId: string;
  readonly accountId: string | null;
  readonly userKey: string | null;
}

export interface SourceBody {
  readonly format: "confluence-storage";
  readonly content: string;
}

export type SourceContentType = "page" | "blogPost";

export interface SourcePage {
  readonly sourceId: string;
  readonly type: SourceContentType;
  readonly parentId: string | null;
  readonly title: string;
  readonly creatorId: string | null;
  readonly createdAt: string | null;
  readonly modifierId: string | null;
  readonly modifiedAt: string | null;
  readonly version: number;
}

export interface SourceAttachmentVersion {
  readonly sourceId: string;
  readonly version: number;
  readonly creatorId: string | null;
  readonly createdAt: string | null;
  readonly file: string | null;
}

export interface SourceAttachment {
  readonly sourceId: string;
  readonly pageId: string;
  readonly fileName: string;
  readonly versions: readonly SourceAttachmentVersion[];
}

export interface SourceLabel {
  readonly pageId: string;
  readonly name: string;
}

export interface SourceVersion {
  readonly sourceId: string;
  readonly pageId: string;
  readonly version: number;
  readonly title: string;
  readonly authorId: string | null;
  readonly createdAt: string | null;
}

export type SourceCommentStatus = "open" | "resolved" | "dangling";

export interface SourceComment {
  readonly sourceId: string;
  readonly pageId: string;
  readonly parentId: string | null;
  readonly authorId: string | null;
  readonly createdAt: string | null;
  readonly modifiedAt: string | null;
  readonly inline: { readonly markerRef: string | null; readonly selection: string | null } | null;
  readonly status: SourceCommentStatus;
  readonly resolvedById: string | null;
  readonly resolvedAt: string | null;
}

export interface SourceLike {
  readonly sourceId: string;
  readonly contentId: string;
  readonly personId: string | null;
  readonly createdAt: string | null;
}

export interface SourceSpacePermission {
  readonly sourceId: string;
  readonly type: string;
  readonly group: string | null;
  readonly personId: string | null;
  readonly allUsers: boolean;
}

export interface SourceRestriction {
  readonly sourceId: string;
  readonly contentId: string;
  readonly kind: "view" | "edit";
  readonly personId: string | null;
  readonly group: string | null;
}

export interface ScanProgress {
  readonly done: number;
  readonly total: number;
}

export interface ScanContext {
  readonly staging: StagingStore;
  readonly checkpoint: Readonly<Record<string, unknown>>;
  saveCheckpoint(checkpoint: Record<string, unknown>): Promise<void>;
  progress(progress: ScanProgress): Promise<void>;
  problem(code: string, details?: Record<string, string | number>): Promise<void>;
  readonly signal: AbortSignal;
}

export interface ExportSummary {
  readonly pages: number;
  readonly blogPosts: number;
  readonly versions: number;
  readonly comments: number;
  readonly likes: number;
  readonly watchers: number;
  readonly attachments: number;
  readonly attachmentBytes: number;
  readonly people: number;
  readonly spaceKey: string;
  readonly spaceName: string;
}

export interface ReadContext {
  readonly staging: StagingStore;
}

export interface ImportReader {
  readonly source: ImportSource;
  scan(file: ByteSource, context: ScanContext): Promise<void>;
  summary(context: ReadContext): Promise<ExportSummary>;
  space(context: ReadContext): Promise<SourceSpace>;
  people(context: ReadContext): AsyncIterable<SourcePerson>;
  pages(context: ReadContext): AsyncIterable<SourcePage>;
  bodies(context: ReadContext, contentIds: readonly string[]): Promise<ReadonlyMap<string, SourceBody>>;
  versions(context: ReadContext, pageId: string): AsyncIterable<SourceVersion>;
  comments(context: ReadContext, contentIds: readonly string[]): Promise<readonly SourceComment[]>;
  likes(context: ReadContext): AsyncIterable<SourceLike>;
  spacePermissions(context: ReadContext): AsyncIterable<SourceSpacePermission>;
  restrictions(context: ReadContext, contentIds: readonly string[]): Promise<readonly SourceRestriction[]>;
  attachments(context: ReadContext): AsyncIterable<SourceAttachment>;
  openFile(file: ByteSource, context: ReadContext, path: string): Promise<Readable | null>;
  labels(context: ReadContext, pageIds: readonly string[]): Promise<readonly SourceLabel[]>;
  pagesByTitle(context: ReadContext, titles: readonly string[]): Promise<ReadonlyMap<string, string>>;
  resolvePeople(
    context: ReadContext,
    references: readonly PersonReference[],
  ): Promise<readonly (SourcePerson | null)[]>;
}

export interface PersonReference {
  readonly accountId: string | null;
  readonly userKey: string | null;
}

export class ImportReaderRegistry {
  readonly #readers = new Map<ImportSource, ImportReader>();

  register(...readers: ImportReader[]): this {
    for (const reader of readers) {
      if (this.#readers.has(reader.source))
        throw new Error(`The reader ${reader.source} is registered twice`);
      this.#readers.set(reader.source, reader);
    }
    return this;
  }

  get(source: ImportSource): ImportReader {
    const reader = this.#readers.get(source);
    if (!reader) throw new Error(`No reader for ${source}`);
    return reader;
  }
}
