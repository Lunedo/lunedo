import { posix } from "node:path";
import { kinds, StagedConfluenceReader, titleKey } from "../confluence/staged.js";
import { ImportFormatError } from "../errors.js";
import type { ByteSource } from "../formats/bytes.js";
import { DEFAULT_ZIP_LIMITS, ZipArchive, type ZipEntryLocation, type ZipLimits } from "../formats/zip.js";
import type { ScanContext } from "../source.js";
import { convertMarkdown, type MarkdownLookup } from "./convert.js";

export const MARKDOWN_ZIP_LIMITS: ZipLimits = { ...DEFAULT_ZIP_LIMITS, maxEntries: 100_000 };
export const MAX_MARKDOWN_BYTES = 5 * 1024 * 1024;
const BATCH = 50;
const INDEX_NAMES = ["index.md", "_index.md", "readme.md", "index.markdown", "readme.markdown"];

interface Entry {
  readonly path: string;
  readonly size: number;
  readonly location: ZipEntryLocation;
}

interface Folder {
  readonly path: string;
  readonly pageId: string | null;
  readonly index: string | null;
}

type Problem = { code: "unsupportedMarkdown" | "unresolvedFileLink"; details: Record<string, string> };

export function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

function hidden(path: string): boolean {
  return path.split("/").some((segment) => segment.startsWith(".") || segment === "__MACOSX");
}

function stem(path: string): string {
  return posix.basename(path).replace(/\.(md|markdown)$/i, "");
}

function displayName(name: string): string {
  return /\s/.test(name) ? name : name.replace(/[-_]+/g, " ").trim() || name;
}

function naturalSort(name: string): string {
  return `1${name.toLocaleLowerCase("en").replace(/\d+/g, (digits) => digits.padStart(12, "0"))}`;
}

function directoryOf(path: string): string {
  const directory = posix.dirname(path);
  return directory === "." ? "" : directory;
}

function decodePath(target: string): string | null {
  const clean = target
    .replace(/^<|>$/g, "")
    .replace(/[?#].*$/, "")
    .trim();
  if (clean.length === 0) return null;
  try {
    return decodeURIComponent(clean);
  } catch {
    return clean;
  }
}

export function pageIdOf(path: string): string {
  return `md:${path}`;
}

export class MarkdownTree {
  readonly files = new Map<string, Entry>();
  readonly markdown: string[] = [];
  readonly folders = new Map<string, Folder>();
  readonly root: string;
  readonly #markdown = new Set<string>();
  readonly #byStem = new Map<string, string[]>();
  readonly #byName = new Map<string, string[]>();

  constructor(entries: readonly Entry[]) {
    const visible = entries.filter((entry) => !hidden(entry.path));
    const firsts = new Set(visible.map((entry) => entry.path.split("/")[0]));
    const [only] = firsts;
    const prefix =
      firsts.size === 1 && only && visible.every((entry) => entry.path.includes("/")) ? `${only}/` : "";
    this.root = prefix ? prefix.slice(0, -1) : "";
    for (const entry of visible) {
      const path = entry.path.slice(prefix.length);
      this.files.set(path, { ...entry, path });
    }
    for (const path of [...this.files.keys()].sort()) {
      const entry = this.files.get(path) as Entry;
      if (isMarkdown(path)) {
        if (entry.size > MAX_MARKDOWN_BYTES) continue;
        this.markdown.push(path);
        this.#markdown.add(path);
        const key = stem(path).toLocaleLowerCase("en");
        this.#byStem.set(key, [...(this.#byStem.get(key) ?? []), path]);
      } else {
        const name = posix.basename(path).toLocaleLowerCase("en");
        this.#byName.set(name, [...(this.#byName.get(name) ?? []), path]);
      }
    }
    const directories = new Set<string>([""]);
    for (const path of this.markdown) {
      for (let directory = directoryOf(path); directory !== ""; directory = directoryOf(directory)) {
        if (directories.has(directory)) break;
        directories.add(directory);
      }
    }
    for (const directory of directories) {
      const names = new Map(
        this.markdown
          .filter((path) => directoryOf(path) === directory)
          .map((path) => [posix.basename(path).toLocaleLowerCase("en"), path] as const),
      );
      const index = INDEX_NAMES.map((name) => names.get(name)).find((path) => path !== undefined) ?? null;
      const pageId = index ? pageIdOf(index) : directory === "" ? null : `md:${directory}/`;
      this.folders.set(directory, { path: directory, pageId, index });
    }
  }

  isIndex(path: string): boolean {
    return this.folders.get(directoryOf(path))?.index === path;
  }

  pageIn(directory: string): string | null {
    for (let current = directory; ; current = directoryOf(current)) {
      const pageId = this.folders.get(current)?.pageId;
      if (pageId) return pageId;
      if (current === "") return null;
    }
  }

  parentOfFile(path: string): string | null {
    if (!this.isIndex(path)) return this.pageIn(directoryOf(path));
    const directory = directoryOf(path);
    return directory === "" ? null : this.pageIn(directoryOf(directory));
  }

  parentOfFolder(directory: string): string | null {
    return this.pageIn(directoryOf(directory));
  }

  #resolve(from: string, target: string): string | null {
    const decoded = decodePath(target);
    if (!decoded || /^[a-z][a-z0-9+.-]*:/i.test(decoded)) return null;
    const joined = decoded.startsWith("/")
      ? posix.normalize(decoded.slice(1))
      : posix.normalize(posix.join(directoryOf(from), decoded));
    if (joined === ".." || joined.startsWith("../")) return null;
    return joined === "." ? "" : joined.replace(/\/$/, "");
  }

  #pageAt(path: string): string | null {
    for (const candidate of [path, `${path}.md`, `${path}.markdown`]) {
      if (this.#markdown.has(candidate)) return pageIdOf(candidate);
    }
    return this.folders.get(path)?.pageId ?? null;
  }

  page(from: string, target: string, wiki: boolean): string | null {
    if (!wiki) {
      const path = this.#resolve(from, target);
      return path === null ? null : this.#pageAt(path);
    }
    const name = target.trim();
    if (name.includes("/")) {
      const direct = this.#pageAt(posix.normalize(name.replace(/^\//, "")));
      if (direct) return direct;
    }
    const here = directoryOf(from);
    const matches = [...(this.#byStem.get(stem(name).toLocaleLowerCase("en")) ?? [])].sort(
      (left, right) =>
        Number(directoryOf(right) === here) - Number(directoryOf(left) === here) ||
        left.split("/").length - right.split("/").length ||
        left.localeCompare(right),
    );
    const [best] = matches;
    if (best) return pageIdOf(best);
    const wanted = posix.basename(name).toLocaleLowerCase("en");
    const folder = [...this.folders.values()]
      .filter((entry) => entry.pageId && posix.basename(entry.path).toLocaleLowerCase("en") === wanted)
      .sort((left, right) => left.path.split("/").length - right.path.split("/").length)[0];
    return folder?.pageId ?? null;
  }

  file(from: string, target: string, wiki: boolean): string | null {
    const path = this.#resolve(from, target);
    if (path !== null && this.files.has(path) && !isMarkdown(path)) return path;
    if (!wiki) return null;
    const rooted = posix.normalize(target.trim().replace(/^\//, ""));
    if (this.files.has(rooted) && !isMarkdown(rooted)) return rooted;
    const matches = this.#byName.get(posix.basename(target.trim()).toLocaleLowerCase("en")) ?? [];
    return [...matches].sort((left, right) => left.split("/").length - right.split("/").length)[0] ?? null;
  }
}

async function readText(archive: ZipArchive, entry: Entry): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of await archive.openAt(entry.location)) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

class AttachmentNames {
  readonly #names = new Map<string, string>();
  readonly #used: Set<string>;

  constructor(used: Iterable<string> = []) {
    this.#used = new Set([...used].map((name) => name.toLocaleLowerCase("en")));
  }

  name(path: string): string {
    const existing = this.#names.get(path);
    if (existing) return existing;
    const base = posix.basename(path);
    const dot = base.lastIndexOf(".");
    let name = base;
    for (let count = 2; this.#used.has(name.toLocaleLowerCase("en")); count += 1) {
      name = dot > 0 ? `${base.slice(0, dot)} (${count})${base.slice(dot)}` : `${base} (${count})`;
    }
    this.#used.add(name.toLocaleLowerCase("en"));
    this.#names.set(path, name);
    return name;
  }

  entries(): [string, string][] {
    return [...this.#names.entries()];
  }
}

export class MarkdownReader extends StagedConfluenceReader {
  readonly source = "markdown" as const;

  async scan(file: ByteSource, context: ScanContext): Promise<void> {
    const archive = await ZipArchive.open(file, MARKDOWN_ZIP_LIMITS);
    const entries: Entry[] = [];
    const duplicates: string[] = [];
    for await (const entry of archive.entries((problem) => {
      if (problem.code === "duplicateEntry") duplicates.push(problem.name);
    })) {
      if (entries.length % 1000 === 0) context.signal.throwIfAborted();
      entries.push({ path: entry.name, size: entry.size, location: entry.location });
    }
    for (const name of duplicates) await context.problem("duplicateEntry", { name });
    const tree = new MarkdownTree(entries);
    if (tree.markdown.length === 0) {
      throw new ImportFormatError("noMarkdown", "The ZIP file contains no Markdown files.");
    }
    for (const entry of tree.files.values()) {
      if (isMarkdown(entry.path) && entry.size > MAX_MARKDOWN_BYTES) {
        await context.problem("unsupportedMarkdown", { file: entry.path, construct: "tooLarge" });
      }
    }
    const spaceName = displayName(tree.root || "Markdown");
    const rootIndex = tree.folders.get("")?.index ?? null;
    await context.staging.put({
      kind: kinds.space,
      sourceId: `md:${tree.root || "markdown"}`,
      data: { key: spaceName, name: spaceName, homePageId: rootIndex ? pageIdOf(rootIndex) : null },
    });
    const skip = typeof context.checkpoint.files === "number" ? context.checkpoint.files : 0;
    for (const [index, path] of tree.markdown.entries()) {
      if (index < skip) continue;
      await this.#page(archive, tree, path, context);
      if ((index + 1) % BATCH === 0) {
        await context.staging.flush();
        await context.saveCheckpoint({ files: index + 1 });
        await context.progress({ done: index + 1, total: tree.markdown.length });
      }
    }
    for (const folder of tree.folders.values()) {
      if (folder.index || !folder.pageId) continue;
      const title = displayName(posix.basename(folder.path));
      await context.staging.put({
        kind: kinds.page,
        sourceId: folder.pageId,
        ref: titleKey(title),
        parentId: tree.parentOfFolder(folder.path),
        sort: naturalSort(posix.basename(folder.path)),
        data: { title, version: 1, creatorKey: null, created: null, modified: null, modifierKey: null },
      });
      await context.staging.put({
        kind: kinds.body,
        sourceId: folder.pageId,
        ref: folder.pageId,
        data: { body: "" },
      });
    }
    await context.staging.flush();
    await this.#unreferenced(tree, context);
    await context.staging.flush();
    await context.staging.orderTree(kinds.page, rootIndex ? [pageIdOf(rootIndex)] : []);
    await context.saveCheckpoint({ files: tree.markdown.length });
  }

  async #page(archive: ZipArchive, tree: MarkdownTree, path: string, context: ScanContext): Promise<void> {
    const source = await readText(archive, tree.files.get(path) as Entry);
    const pageId = pageIdOf(path);
    const attachments = new AttachmentNames();
    const problems: Problem[] = [];
    const lookup: MarkdownLookup = {
      page: (target, wiki) => {
        const id = tree.page(path, target, wiki);
        return id ? { sourceId: id, title: displayName(stem(id.slice(3).replace(/\/$/, ""))) } : null;
      },
      file: (target, wiki) => {
        const file = tree.file(path, target, wiki);
        return file ? attachments.name(file) : null;
      },
      problem: (code, details) => problems.push({ code, details: { file: path, ...details } }),
    };
    const converted = convertMarkdown(source, lookup);
    const index = tree.isIndex(path);
    const directory = directoryOf(path);
    const fallback = index ? posix.basename(directory) || tree.root || stem(path) : stem(path);
    const title = (converted.frontMatter.title ?? converted.heading ?? displayName(fallback)).slice(0, 255);
    await context.staging.put({
      kind: kinds.page,
      sourceId: pageId,
      ref: titleKey(title),
      parentId: tree.parentOfFile(path),
      sort: naturalSort(index ? posix.basename(directory) : posix.basename(path)),
      data: {
        title,
        version: 1,
        creatorKey: null,
        created: converted.frontMatter.created,
        modifierKey: null,
        modified: converted.frontMatter.modified ?? converted.frontMatter.created,
      },
    });
    await context.staging.put({
      kind: kinds.body,
      sourceId: pageId,
      ref: pageId,
      data: { body: converted.body },
    });
    for (const label of converted.frontMatter.labels) {
      const labelId = `global:${label}`;
      await context.staging.put({
        kind: kinds.label,
        sourceId: labelId,
        data: { name: label, namespace: "global" },
      });
      await context.staging.put({
        kind: kinds.labelling,
        sourceId: `${pageId}/${labelId}`,
        ref: pageId,
        data: { labelId },
      });
    }
    for (const [file, name] of attachments.entries()) await this.#attach(tree, pageId, file, name, context);
    for (const problem of problems) await context.problem(problem.code, problem.details);
  }

  async #attach(
    tree: MarkdownTree,
    pageId: string,
    path: string,
    name: string,
    context: ScanContext,
  ): Promise<void> {
    const entry = tree.files.get(path);
    if (!entry) return;
    const sourceId = `${pageId}:${path}`;
    await context.staging.put({
      kind: kinds.attachment,
      sourceId,
      ref: sourceId,
      data: { pageId, originalId: null, fileName: name, version: 1, creatorKey: null, created: null, path },
    });
    await context.staging.put({
      kind: kinds.file,
      sourceId: `attachments/${pageId}/${sourceId}/1`,
      data: { size: entry.size, location: entry.location },
    });
  }

  async #unreferenced(tree: MarkdownTree, context: ScanContext): Promise<void> {
    const referenced = new Set<string>();
    const used = new Map<string, string[]>();
    for await (const record of context.staging.iterate<{ pageId: string; fileName: string; path: string }>(
      kinds.attachment,
    )) {
      referenced.add(record.data.path);
      used.set(record.data.pageId, [...(used.get(record.data.pageId) ?? []), record.data.fileName]);
    }
    const names = new Map<string, AttachmentNames>();
    for (const entry of tree.files.values()) {
      if (isMarkdown(entry.path) || referenced.has(entry.path)) continue;
      const pageId = tree.pageIn(directoryOf(entry.path));
      if (!pageId) {
        await context.problem("skippedEntry", { name: entry.path });
        continue;
      }
      const taken = names.get(pageId) ?? new AttachmentNames(used.get(pageId) ?? []);
      names.set(pageId, taken);
      await this.#attach(tree, pageId, entry.path, taken.name(entry.path), context);
    }
  }
}
