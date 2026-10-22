import { posix } from "node:path";
import { isArticleLanguage } from "../../knowledge-bases/translations.js";
import { kinds, StagedConfluenceReader, titleKey } from "../confluence/staged.js";
import { ImportFormatError } from "../errors.js";
import type { ByteSource } from "../formats/bytes.js";
import { DEFAULT_ZIP_LIMITS, ZipArchive, type ZipEntryLocation, type ZipLimits } from "../formats/zip.js";
import type { ScanContext } from "../source.js";
import {
  convertMarkdown,
  type FrontMatter,
  type MarkdownLookup,
  parseFrontMatter,
  splitFrontMatter,
} from "./convert.js";

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

function shallowest(map: Map<string, string>, key: string, path: string): void {
  const current = map.get(key);
  if (!current || path.split("/").length < current.split("/").length) map.set(key, path);
}

function append<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function pageIdOf(path: string): string {
  return `md:${path}`;
}

export class MarkdownTree {
  readonly files = new Map<string, Entry>();
  readonly markdown: string[] = [];
  readonly folders = new Map<string, Folder>();
  readonly namedFolders: string[] = [];
  readonly root: string;
  readonly #markdown = new Set<string>();
  readonly #stemBest = new Map<string, string>();
  readonly #stemInDirectory = new Map<string, string>();
  readonly #nameBest = new Map<string, string>();
  readonly #folderByName = new Map<string, string>();

  constructor(entries: readonly Entry[], options: { indexOnly?: ReadonlySet<string> } = {}) {
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
        shallowest(this.#stemBest, key, path);
        const local = `${key}\u0000${directoryOf(path)}`;
        if (!this.#stemInDirectory.has(local)) this.#stemInDirectory.set(local, path);
      } else {
        shallowest(this.#nameBest, posix.basename(path).toLocaleLowerCase("en"), path);
      }
    }
    const directories = new Set<string>([""]);
    const byDirectory = new Map<string, string[]>();
    for (const path of this.markdown) {
      append(byDirectory, directoryOf(path), path);
      for (let directory = directoryOf(path); directory !== ""; directory = directoryOf(directory)) {
        if (directories.has(directory)) break;
        directories.add(directory);
      }
    }
    for (const directory of directories) {
      const names = new Map(
        (byDirectory.get(directory) ?? []).map(
          (path) => [posix.basename(path).toLocaleLowerCase("en"), path] as const,
        ),
      );
      const own = posix
        .basename(directory)
        .replace(/ \(\d+\)$/, "")
        .toLocaleLowerCase("en");
      const generic = INDEX_NAMES.map((name) => names.get(name)).find((path) => path !== undefined);
      const named =
        generic === undefined && directory !== ""
          ? (names.get(`${own}.md`) ?? names.get(`${own}.markdown`))
          : undefined;
      if (named !== undefined) this.namedFolders.push(directory);
      const index = generic ?? (options.indexOnly?.has(directory) ? undefined : named) ?? null;
      const pageId = index ? pageIdOf(index) : directory === "" ? null : `md:${directory}/`;
      this.folders.set(directory, { path: directory, pageId, index });
    }
    const shallowFirst = [...this.folders.values()].sort(
      (left, right) => left.path.split("/").length - right.path.split("/").length,
    );
    for (const folder of shallowFirst) {
      const key = posix.basename(folder.path).toLocaleLowerCase("en");
      if (folder.pageId && key && !this.#folderByName.has(key)) this.#folderByName.set(key, folder.pageId);
    }
  }

  separateIndex(directory: string): void {
    const folder = this.folders.get(directory);
    if (!folder?.index) return;
    this.folders.set(directory, {
      path: directory,
      pageId: directory === "" ? null : `md:${directory}/`,
      index: null,
    });
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
    const key = stem(name).toLocaleLowerCase("en");
    const best = this.#stemInDirectory.get(`${key}\u0000${directoryOf(from)}`) ?? this.#stemBest.get(key);
    if (best) return pageIdOf(best);
    return this.#folderByName.get(posix.basename(name).toLocaleLowerCase("en")) ?? null;
  }

  file(from: string, target: string, wiki: boolean): string | null {
    const path = this.#resolve(from, target);
    if (path !== null && this.files.has(path) && !isMarkdown(path)) return path;
    if (!wiki) return null;
    const rooted = posix.normalize(target.trim().replace(/^\//, ""));
    if (this.files.has(rooted) && !isMarkdown(rooted)) return rooted;
    return this.#nameBest.get(posix.basename(target.trim()).toLocaleLowerCase("en")) ?? null;
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

function refusedTranslation(
  language: string,
  originalLanguage: string | null,
  originalId: string,
  claimed: Set<string>,
): "unknown" | "defaultLanguage" | "duplicate" | null {
  if (!isArticleLanguage(language)) return "unknown";
  if (language === originalLanguage) return "defaultLanguage";
  const key = `${originalId} ${language}`;
  if (claimed.has(key)) return "duplicate";
  claimed.add(key);
  return null;
}

export class MarkdownReader extends StagedConfluenceReader {
  readonly source = "markdown" as const;

  async #tree(entries: readonly Entry[], context: ScanContext): Promise<MarkdownTree> {
    const tree = new MarkdownTree(entries);
    if (tree.namedFolders.length === 0 || !context.knownPages) return tree;
    const known = await context.knownPages(tree.namedFolders.map((directory) => `md:${directory}/`));
    const indexOnly = new Set(tree.namedFolders.filter((directory) => known.has(`md:${directory}/`)));
    return indexOnly.size === 0 ? tree : new MarkdownTree(entries, { indexOnly });
  }

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
    const tree = await this.#tree(entries, context);
    if (tree.markdown.length === 0) {
      throw new ImportFormatError("noMarkdown", "The ZIP file contains no Markdown files.");
    }
    const knowledgeBase = context.options.knowledgeBase === true;
    const spaceTitle = tree.folders.get("")?.index
      ? await this.#frontMatterTitle(archive, tree, tree.folders.get("")?.index ?? "")
      : null;
    const articles = new Map<string, string | null>();
    const claimed = new Set<string>();
    if (knowledgeBase) {
      for (const folder of [...tree.folders.values()]) {
        if (!folder.index) continue;
        const facts = (await this.#frontMatter(archive, tree, folder.index))?.lunedo;
        if (folder.path !== "" && facts?.kind === "page") articles.set(folder.pageId ?? "", facts.language);
        else tree.separateIndex(folder.path);
      }
    }
    const placement = (parentId: string | null, translation: boolean): string | null => {
      if (!parentId || !articles.has(parentId) || translation) return parentId;
      const directory = parentId.slice(3).replace(/\/[^/]*$/, "");
      return tree.parentOfFolder(directory);
    };
    for (const entry of tree.files.values()) {
      if (isMarkdown(entry.path) && entry.size > MAX_MARKDOWN_BYTES) {
        await context.problem("unsupportedMarkdown", { file: entry.path, construct: "tooLarge" });
      }
    }
    const folderName = displayName(tree.root || "Markdown");
    const rootIndex = tree.folders.get("")?.index ?? null;
    const spaceName = spaceTitle ?? folderName;
    await context.staging.put({
      kind: kinds.space,
      sourceId: `md:${tree.root || "markdown"}`,
      data: { key: folderName, name: spaceName, homePageId: rootIndex ? pageIdOf(rootIndex) : null },
    });
    const known =
      knowledgeBase && context.knownPages
        ? await context.knownPages(tree.markdown.map(pageIdOf))
        : new Set<string>();
    const order = [
      ...tree.markdown.filter((path) => known.has(pageIdOf(path))),
      ...tree.markdown.filter((path) => !known.has(pageIdOf(path))),
    ];
    const skip = typeof context.checkpoint.files === "number" ? context.checkpoint.files : 0;
    for (const [index, path] of order.entries()) {
      if (index < skip) continue;
      await this.#page(archive, tree, path, context, knowledgeBase ? { articles, claimed, placement } : null);
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
        parentId: knowledgeBase
          ? placement(tree.parentOfFolder(folder.path), false)
          : tree.parentOfFolder(folder.path),
        sort: naturalSort(posix.basename(folder.path)),
        data: {
          ...(knowledgeBase ? { type: "folder" as const } : {}),
          title,
          version: 1,
          creatorKey: null,
          created: null,
          modified: null,
          modifierKey: null,
        },
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

  async #frontMatter(archive: ZipArchive, tree: MarkdownTree, path: string): Promise<FrontMatter | null> {
    const entry = tree.files.get(path);
    if (!entry || entry.size > MAX_MARKDOWN_BYTES) return null;
    const { yaml } = splitFrontMatter(await readText(archive, entry));
    return parseFrontMatter(yaml, () => undefined);
  }

  async #frontMatterTitle(archive: ZipArchive, tree: MarkdownTree, path: string): Promise<string | null> {
    const title = (await this.#frontMatter(archive, tree, path))?.title?.trim();
    return title ? title.slice(0, 100) : null;
  }

  async #page(
    archive: ZipArchive,
    tree: MarkdownTree,
    path: string,
    context: ScanContext,
    knowledgeBase: {
      articles: ReadonlyMap<string, string | null>;
      claimed: Set<string>;
      placement: (parentId: string | null, translation: boolean) => string | null;
    } | null,
  ): Promise<void> {
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
    const facts = converted.frontMatter.lunedo;
    const parentId = tree.parentOfFile(path);
    const wanted =
      knowledgeBase !== null &&
      facts?.translation === true &&
      facts.language !== null &&
      parentId !== null &&
      knowledgeBase.articles.has(parentId);
    const refused =
      wanted && knowledgeBase && facts?.language && parentId
        ? refusedTranslation(
            facts.language,
            knowledgeBase.articles.get(parentId) ?? null,
            parentId,
            knowledgeBase.claimed,
          )
        : null;
    if (refused && facts?.language) {
      await context.problem("translationNotImported", {
        title,
        language: facts.language,
        reason: refused,
        outcome: "separate",
      });
    }
    const translation = wanted && refused === null;
    await context.staging.put({
      kind: kinds.page,
      sourceId: pageId,
      ref: titleKey(title),
      parentId: knowledgeBase ? knowledgeBase.placement(parentId, translation) : parentId,
      sort: naturalSort(index ? posix.basename(directory) : posix.basename(path)),
      data: {
        ...(knowledgeBase
          ? {
              article: {
                articleType: facts?.articleType ?? null,
                language: facts?.language ?? null,
                translation,
              },
            }
          : {}),
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
      append(used, record.data.pageId, record.data.fileName);
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
