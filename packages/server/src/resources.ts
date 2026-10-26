import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MARKER = path.join("drizzle", "meta", "_journal.json");

export function findResourceRoot(start: string): string {
  let directory = start;
  for (;;) {
    if (existsSync(path.join(directory, MARKER))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) {
      throw new Error(`The server resources (drizzle/ and data/) were not found in ${start} or above it.`);
    }
    directory = parent;
  }
}

export const resourceRoot = findResourceRoot(path.dirname(fileURLToPath(import.meta.url)));

export function resourcePath(...segments: string[]): string {
  return path.join(resourceRoot, ...segments);
}
