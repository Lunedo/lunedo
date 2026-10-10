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

export interface SourcePage {
  readonly sourceId: string;
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
  bodies(context: ReadContext, pageIds: readonly string[]): Promise<ReadonlyMap<string, SourceBody>>;
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
