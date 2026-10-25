import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip } from "node:zlib";

const brotli = promisify(brotliCompress);
const gzipped = promisify(gzip);

const COMPRESSIBLE = /\.(?:js|mjs|css|html|svg|json|wasm|txt|xml)$/;
const MIN_BYTES = 1024;
const LOCALE_CHUNKS_PLACEHOLDER = '"__LUNEDO_LOCALE_CHUNKS__"';

export function isCompressible(file: string, size: number): boolean {
  return size >= MIN_BYTES && COMPRESSIBLE.test(file);
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
      if (!isCompressible(file, size)) return;
      const content = await readFile(file);
      const [br, gz] = await Promise.all([
        brotli(content, {
          params: {
            [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
            [constants.BROTLI_PARAM_SIZE_HINT]: size,
          },
        }),
        gzipped(content, { level: constants.Z_BEST_COMPRESSION }),
      ]);
      if (br.length < size) {
        await writeFile(`${file}.br`, br);
        written += 1;
      }
      if (gz.length < size) {
        await writeFile(`${file}.gz`, gz);
        written += 1;
      }
    }),
  );
  return written;
}

export interface BundledChunk {
  type: string;
  fileName: string;
  facadeModuleId?: string | null;
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
