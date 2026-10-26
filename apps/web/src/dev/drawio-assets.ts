import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import { DRAWIO_LANGUAGES, DRAWIO_PATH, DRAWIO_VERSION } from "../diagrams/drawio-version.js";

export const DRAWIO_ARCHIVE = {
  url: `https://github.com/jgraph/drawio/releases/download/v${DRAWIO_VERSION}/draw.war`,
  sha256: "f7798104da17d7e9494ab348c3ba9b2a65640096bd54f704d7a0fa2fab283938",
  license: "Apache-2.0",
};

const EXCLUDED_DIRECTORIES = [
  "WEB-INF/",
  "META-INF/",
  "connect/",
  "plugins/",
  "mxgraph/src/",
  "js/diagramly/",
  "js/grapheditor/",
  "js/dropbox/",
  "js/onedrive/",
  "js/simplepeer/",
];

const EXCLUDED_FILES = new Set([
  "service-worker.js",
  "js/integrate.min.js",
  "js/viewer.min.js",
  "js/viewer-static.min.js",
  "js/embed.dev.js",
  "js/PreConfig.js",
  "js/PostConfig.js",
  "monday-app-association.json",
]);

export const DRAWIO_OVERRIDES = ["js/PreConfig.js", "js/PostConfig.js"] as const;

const SHIPPED_TRANSLATIONS: ReadonlySet<string> = new Set(
  DRAWIO_LANGUAGES.filter((language) => language !== "en"),
);

export function isShippedDrawioFile(name: string): boolean {
  if (name.endsWith("/") || name.includes("..") || name.startsWith("/")) return false;
  if (EXCLUDED_DIRECTORIES.some((directory) => name.startsWith(directory))) return false;
  const translation = /^resources\/dia_(.+)\.txt$/.exec(name)?.[1];
  if (translation !== undefined && !SHIPPED_TRANSLATIONS.has(translation)) return false;
  if (EXCLUDED_FILES.has(name) || name.endsWith(".map") || /^workbox-[^/]+\.js$/.test(name)) return false;
  return !name.endsWith(".html") || name === "index.html";
}

export function drawioFile(url: string | undefined): string | null {
  if (!url) return null;
  const pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  if (!pathname.startsWith(DRAWIO_PATH)) return null;
  const name = pathname.slice(DRAWIO_PATH.length) || "index.html";
  return isServedDrawioFile(name) ? name : null;
}

export function isServedDrawioFile(name: string): boolean {
  return isShippedDrawioFile(name) || (DRAWIO_OVERRIDES as readonly string[]).includes(name);
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function download(target: string): Promise<void> {
  const response = await fetch(DRAWIO_ARCHIVE.url);
  if (!response.ok || !response.body) throw new Error(`draw.io ${DRAWIO_VERSION} could not be downloaded`);
  const partial = `${target}.partial`;
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(partial));
  const digest = createHash("sha256")
    .update(await readFile(partial))
    .digest("hex");
  if (digest !== DRAWIO_ARCHIVE.sha256) {
    await rm(partial, { force: true });
    throw new Error(`draw.io ${DRAWIO_VERSION} does not match its pinned checksum`);
  }
  await rename(partial, target);
}

function extract(archive: string, directory: string): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(archive, { lazyEntries: true, strictFileNames: true }, (error, zip) => {
      if (error) {
        reject(error);
        return;
      }
      zip.on("error", reject);
      zip.on("end", () => resolve());
      zip.on("entry", (entry: yauzl.Entry) => {
        if (!isShippedDrawioFile(entry.fileName)) {
          zip.readEntry();
          return;
        }
        const target = path.join(directory, entry.fileName);
        zip.openReadStream(entry, (failure, stream) => {
          if (failure) {
            reject(failure);
            return;
          }
          mkdir(path.dirname(target), { recursive: true })
            .then(() => pipeline(stream, createWriteStream(target)))
            .then(() => zip.readEntry(), reject);
        });
      });
      zip.readEntry();
    });
  });
}

export async function ensureDrawio(cacheRoot: string, overrides: string): Promise<string> {
  const directory = path.join(cacheRoot, DRAWIO_VERSION);
  const ready = path.join(directory, ".ready");
  if (!(await exists(ready))) {
    await mkdir(cacheRoot, { recursive: true });
    const archive = path.join(cacheRoot, `draw-${DRAWIO_VERSION}.war`);
    if (!(await exists(archive))) await download(archive);
    await rm(directory, { recursive: true, force: true });
    await extract(archive, directory);
    await writeFile(ready, DRAWIO_ARCHIVE.sha256);
  }
  for (const name of DRAWIO_OVERRIDES)
    await copyFile(path.join(overrides, path.basename(name)), path.join(directory, name));
  return directory;
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

export function drawioContentType(name: string): string {
  return CONTENT_TYPES[path.extname(name).toLowerCase()] ?? "application/octet-stream";
}
