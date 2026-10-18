import { posix } from "node:path";
import type { Readable } from "node:stream";
import yazl from "yazl";
import { kinds, StagedConfluenceReader, titleKey } from "../confluence/staged.js";
import { ImportFormatError } from "../errors.js";
import { type BundledFile, type ByteSource, isBundle } from "../formats/bytes.js";
import { ZipArchive, type ZipEntryLocation, type ZipLimits } from "../formats/zip.js";
import type { ReadContext, ScanContext } from "../source.js";
import { convertInWorker } from "./convert.js";
import { convertWordHtml, MEDIA_PREFIX } from "./html.js";

export const MAX_DOCX_BYTES = 100 * 1024 * 1024;
export const DOCX_ZIP_LIMITS: ZipLimits = {
  maxEntries: 10_000,
  maxTotalBytes: 256 * 1024 ** 2,
  maxEntryBytes: 128 * 1024 ** 2,
  maxRatio: 200,
  ratioThresholdBytes: 1024 * 1024,
  maxNameBytes: 1024,
};

export const MAX_WORD_TEXT_BYTES = 8 * 1024 * 1024;
export const MAX_WORD_PARTS_BYTES = 32 * 1024 * 1024;
const MAX_METADATA_BYTES = 1024 * 1024;
const COMPOUND_FILE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const MACRO_PARTS = /^word\/vbaproject|^word\/vbadata/i;
const EMBEDDINGS = /^word\/embeddings\//i;
const MEDIA = /^word\/media\//i;
const TEXT_PARTS = new Set([
  "word/document.xml",
  "word/footnotes.xml",
  "word/endnotes.xml",
  "word/comments.xml",
]);
const CONVERTED_PARTS = /\.(xml|rels)$/i;
const MAX_TITLE = 255;

interface DocumentEntry {
  readonly name: string;
  readonly location: ZipEntryLocation;
  readonly size: number;
}

interface StagedWordFile {
  size: number;
  location: ZipEntryLocation;
  document: number;
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function documentTitle(fileName: string): string {
  return fileName.replace(/\.docx$/i, "").trim() || fileName;
}

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function conversionZip(
  archive: ZipArchive,
  entries: readonly DocumentEntry[],
): Promise<Uint8Array<ArrayBuffer>> {
  const zip = new yazl.ZipFile();
  for (const entry of entries) {
    if (MEDIA.test(entry.name)) {
      zip.addBuffer(Buffer.from(`${MEDIA_PREFIX}${entry.name}`, "utf8"), entry.name, { compress: false });
    } else if (CONVERTED_PARTS.test(entry.name) && !EMBEDDINGS.test(entry.name)) {
      zip.addReadStreamLazy(entry.name, { compress: false, size: entry.size }, (done) => {
        archive.openAt(entry.location).then(
          (stream) => done(null, stream),
          (error: Error) => done(error, undefined as unknown as Readable),
        );
      });
    }
  }
  zip.end();
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of zip.outputStream as AsyncIterable<Buffer>) {
    chunks.push(chunk);
    length += chunk.length;
  }
  const bytes = new Uint8Array(new ArrayBuffer(length));
  let offset = 0;
  for (const chunk of chunks.splice(0)) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

async function startsWithCompoundFile(source: ByteSource): Promise<boolean> {
  if (source.size < COMPOUND_FILE.length) return false;
  const head = await readAll(await source.read(0, COMPOUND_FILE.length));
  return head.equals(COMPOUND_FILE);
}

async function tooLarge(fileName: string, context: ScanContext): Promise<void> {
  await context.problem("documentTooLarge", {
    file: fileName,
    limit: Math.round(MAX_WORD_TEXT_BYTES / 1024 / 1024),
  });
}

class UniqueNames {
  readonly #used = new Set<string>();

  take(name: string): string {
    const dot = name.lastIndexOf(".");
    let candidate = name;
    for (let count = 2; this.#used.has(candidate.toLocaleLowerCase("en")); count += 1) {
      candidate = dot > 0 ? `${name.slice(0, dot)} (${count})${name.slice(dot)}` : `${name} (${count})`;
    }
    this.#used.add(candidate.toLocaleLowerCase("en"));
    return candidate;
  }
}

export class WordReader extends StagedConfluenceReader {
  readonly source = "word" as const;

  async scan(file: ByteSource, context: ScanContext): Promise<void> {
    if (!isBundle(file) || file.files.length === 0) {
      throw new ImportFormatError("fileMissing", "Choose the Word documents first.");
    }
    const [only] = file.files;
    const name = file.files.length === 1 && only ? documentTitle(only.name) : "Word documents";
    await context.staging.put({
      kind: kinds.space,
      sourceId: "word:documents",
      data: { key: name, name, homePageId: null },
    });
    const skip = typeof context.checkpoint.documents === "number" ? context.checkpoint.documents : 0;
    const ids = new UniqueNames();
    for (const [index, document] of file.files.entries()) {
      const pageId = `docx:${ids.take(document.name)}`;
      if (index < skip) continue;
      await this.#document(index, pageId, document, context);
      await context.staging.flush();
      await context.saveCheckpoint({ documents: index + 1 });
      await context.progress({ done: index + 1, total: file.files.length });
    }
    await context.staging.orderTree(kinds.page);
  }

  async #document(index: number, pageId: string, document: BundledFile, context: ScanContext): Promise<void> {
    const fileName = document.name;
    const failed = (code: string, message: string) => new ImportFormatError(code, `${fileName}: ${message}`);
    if (/\.(docm|dotm)$/i.test(fileName)) {
      throw failed("macroDocument", "Word documents with macros are not imported. Save it as .docx first.");
    }
    if (document.source.size > MAX_DOCX_BYTES) {
      throw failed("documentTooLarge", "The document is larger than 100 MB.");
    }
    if (await startsWithCompoundFile(document.source)) {
      throw failed("unreadableDocument", "The document is encrypted or in the old .doc format.");
    }
    let archive: ZipArchive;
    const entries: DocumentEntry[] = [];
    try {
      archive = await ZipArchive.open(document.source, DOCX_ZIP_LIMITS);
      for await (const entry of archive.entries()) {
        entries.push({ name: entry.name, location: entry.location, size: entry.size });
      }
    } catch (error) {
      if (error instanceof ImportFormatError) throw failed("unreadableDocument", error.message);
      throw error;
    }
    const byName = new Map(entries.map((entry) => [entry.name.toLowerCase(), entry]));
    if (!byName.has("word/document.xml")) {
      throw failed("unreadableDocument", "The file is not a Word document.");
    }
    const read = async (entry: DocumentEntry) => readAll(await archive.openAt(entry.location));
    const types = byName.get("[content_types].xml");
    if (types && types.size > MAX_METADATA_BYTES) {
      throw failed("unreadableDocument", "The document is damaged and cannot be read.");
    }
    const typeText = types ? (await read(types)).toString("utf8") : "";
    if (/macroEnabled/i.test(typeText) || entries.some((entry) => MACRO_PARTS.test(entry.name))) {
      throw failed("macroDocument", "Word documents with macros are not imported. Save it as .docx first.");
    }
    const textBytes = entries
      .filter((entry) => TEXT_PARTS.has(entry.name.toLowerCase()))
      .reduce((sum, entry) => sum + entry.size, 0);
    const partBytes = entries
      .filter((entry) => CONVERTED_PARTS.test(entry.name) && !EMBEDDINGS.test(entry.name))
      .reduce((sum, entry) => sum + entry.size, 0);
    if (textBytes > MAX_WORD_TEXT_BYTES || partBytes > MAX_WORD_PARTS_BYTES) {
      await tooLarge(fileName, context);
      return;
    }
    const core = byName.get("docprops/core.xml");
    const coreText = core && core.size <= MAX_METADATA_BYTES ? (await read(core)).toString("utf8") : "";
    const titled = /<dc:title>([^<]*)<\/dc:title>/.exec(coreText)?.[1];
    const title = (titled ? unescapeXml(titled).trim() : "") || documentTitle(fileName);
    const comments = byName.get("word/comments.xml");
    if (comments) {
      const count = ((await read(comments)).toString("utf8").match(/<w:comment\b/g) ?? []).length;
      if (count > 0) await context.problem("wordCommentsDropped", { file: fileName, count });
    }
    const conversion = await convertInWorker({
      zip: await conversionZip(archive, entries),
      idPrefix: `d${index}-`,
    });
    if (conversion.status === "tooLarge") {
      await tooLarge(fileName, context);
      return;
    }
    if (conversion.status === "damaged") {
      throw failed("unreadableDocument", "The document is damaged and cannot be read.");
    }
    const html = conversion.html;
    if (conversion.unreadableImages) await context.problem("unreadableImage", { file: fileName });
    const converted = convertWordHtml(html, {
      prefix: `d${index}-`,
      split: context.options.split === "heading",
      media: (path) => (MEDIA.test(path) && byName.has(path.toLowerCase()) ? posix.basename(path) : null),
    });
    const pages = converted.sections.map((section, position) => ({
      sourceId: position === 0 ? pageId : `${pageId}#${position}`,
      title: (position === 0 ? title : (section.title ?? `${title} ${position}`)).slice(0, MAX_TITLE),
      section,
      position,
    }));
    for (const page of pages) {
      await context.staging.put({
        kind: kinds.page,
        sourceId: page.sourceId,
        ref: titleKey(page.title),
        parentId: page.position === 0 ? null : pageId,
        sort:
          page.position === 0
            ? `1${title.toLocaleLowerCase("en")}`
            : `0${String(page.position).padStart(6, "0")}`,
        data: {
          title: page.title,
          version: 1,
          creatorKey: null,
          created: null,
          modifierKey: null,
          modified: null,
        },
      });
      for (const path of page.section.images) {
        const entry = byName.get(path.toLowerCase());
        if (!entry || !MEDIA.test(entry.name)) continue;
        await this.#attach(
          page.sourceId,
          `${page.sourceId}:${path}`,
          posix.basename(path),
          entry,
          index,
          context,
        );
      }
      await context.staging.put({
        kind: kinds.body,
        sourceId: page.sourceId,
        ref: page.sourceId,
        data: { body: page.section.body },
      });
    }
    for (const entry of entries) {
      if (!EMBEDDINGS.test(entry.name)) continue;
      const name = posix.basename(entry.name);
      await this.#attach(pageId, `${pageId}:${entry.name}`, name, entry, index, context);
      await context.problem("embeddedObject", { file: fileName, name });
    }
  }

  async #attach(
    pageId: string,
    sourceId: string,
    fileName: string,
    entry: DocumentEntry,
    document: number,
    context: ScanContext,
  ): Promise<void> {
    await context.staging.put({
      kind: kinds.attachment,
      sourceId,
      ref: sourceId,
      data: { pageId, originalId: null, fileName, version: 1, creatorKey: null, created: null },
    });
    await context.staging.put({
      kind: kinds.file,
      sourceId: `attachments/${pageId}/${sourceId}/1`,
      data: { size: entry.size, location: entry.location, document } satisfies StagedWordFile,
    });
  }

  override async openFile(file: ByteSource, context: ReadContext, path: string): Promise<Readable | null> {
    const stored = (await context.staging.get<StagedWordFile>(kinds.file, [path])).get(path)?.data;
    if (!stored || !isBundle(file)) return null;
    const document = file.files[stored.document];
    if (!document) return null;
    const archive = await ZipArchive.open(document.source, DOCX_ZIP_LIMITS);
    return archive.openAt(stored.location);
  }
}
