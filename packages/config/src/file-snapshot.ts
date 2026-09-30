import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const IGNORED = new Set(["node_modules", ".turbo", ".git"]);

/**
 * Describes the files below the given directories by path, size and modification time.
 * Polling works on bind mounts where file system events do not arrive, such as
 * Windows folders mounted into Linux containers.
 */
export function snapshot(directories: readonly string[]): string {
  const entries: string[] = [];
  const visit = (directory: string) => {
    let names: string[];
    try {
      names = readdirSync(directory);
    } catch {
      return;
    }
    for (const name of names) {
      if (IGNORED.has(name)) continue;
      const file = path.join(directory, name);
      const stats = statSync(file, { throwIfNoEntry: false });
      if (!stats) continue;
      if (stats.isDirectory()) visit(file);
      else entries.push(`${file}:${stats.size}:${stats.mtimeMs}`);
    }
  };
  for (const directory of directories) visit(directory);
  return entries.sort().join("\n");
}
