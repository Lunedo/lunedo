import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";

const brotli = promisify(brotliCompress);
const gzipped = promisify(gzip);

const COMPRESSIBLE = /\.(?:js|mjs|css|html|svg|json|wasm|txt|xml)$/;
const MIN_BYTES = 1024;
const LOCALE_CHUNKS_PLACEHOLDER = '"__LUNEDO_LOCALE_CHUNKS__"';
export const BUILD_PLACEHOLDER = "__LUNEDO_BUILD__";
const GZIP_ONLY = /^drawio\//;

export const ICON_MODULES =
  /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?lucide-react[\\/]/;

export type Encoding = "br" | "gz";

export function encodingsFor(file: string, size: number): Encoding[] {
  if (size < MIN_BYTES || !COMPRESSIBLE.test(file)) return [];
  return GZIP_ONLY.test(file) ? ["gz"] : ["br", "gz"];
}

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const full = path.join(directory, entry.name);
      return entry.isDirectory() ? filesBelow(full) : Promise.resolve([full]);
    }),
  );
  return nested.flat();
}

export async function precompress(directory: string): Promise<number> {
  const files = await filesBelow(directory);
  let written = 0;
  await Promise.all(
    files.map(async (file) => {
      const { size } = await stat(file);
      const encodings = encodingsFor(path.relative(directory, file).split(path.sep).join("/"), size);
      if (encodings.length === 0) return;
      const content = await readFile(file);
      await Promise.all(
        encodings.map(async (encoding) => {
          const compressed =
            encoding === "br"
              ? await brotli(content, {
                  params: {
                    [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
                    [constants.BROTLI_PARAM_SIZE_HINT]: size,
                  },
                })
              : await gzipped(content, { level: constants.Z_BEST_COMPRESSION });
          if (compressed.length >= size) return;
          await writeFile(`${file}.${encoding}`, compressed);
          written += 1;
        }),
      );
    }),
  );
  return written;
}

export interface BundledChunk {
  type: string;
  fileName: string;
  facadeModuleId?: string | null;
  source?: string | Uint8Array;
}

export function buildIdentity(bundle: Record<string, BundledChunk>): string {
  const chunks = Object.values(bundle)
    .filter((item) => item.type === "chunk")
    .map((item) => item.fileName)
    .sort();
  return createHash("sha256").update(chunks.join("\n")).digest("hex").slice(0, 16);
}

export function stampBuild(bundle: Record<string, BundledChunk>): string {
  const build = buildIdentity(bundle);
  for (const output of Object.values(bundle)) {
    if (output.type === "asset" && output.fileName.endsWith(".html") && typeof output.source === "string") {
      output.source = output.source.replaceAll(BUILD_PLACEHOLDER, build);
    }
  }
  return build;
}

export function withLocaleChunks(html: string, bundle: Record<string, BundledChunk> | undefined): string {
  const chunks: Record<string, string> = {};
  for (const output of Object.values(bundle ?? {})) {
    if (output.type !== "chunk" || !output.facadeModuleId) continue;
    const language = /[\\/]i18n[\\/]locales[\\/]([a-z]{2})\.json$/.exec(output.facadeModuleId)?.[1];
    if (language) chunks[language] = `/${output.fileName}`;
  }
  return html.replace(LOCALE_CHUNKS_PLACEHOLDER, JSON.stringify(chunks));
}
