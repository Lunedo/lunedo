import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = path.resolve(import.meta.dirname, "..");
const FRAME_ENTRY = path.join(SOURCE, "preview", "main.ts");
const APP_ENTRY = path.join(SOURCE, "main.tsx");
const DOCUMENT_PARSERS = /^(mammoth|xlsx|pdfjs-dist)(\/|$)/;
const SPECIFIER =
  /(?:import|export)\s[^"'`]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|import\s+["']([^"']+)["']/g;

function specifiers(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(SPECIFIER)].map((match) => match[1] ?? match[2] ?? match[3] ?? "");
}

function resolveLocal(from: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = path.resolve(path.dirname(from), specifier);
  const candidates = [
    base,
    base.replace(/\.js$/, ".ts"),
    base.replace(/\.js$/, ".tsx"),
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile()) ?? null;
}

function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file) || !/\.tsx?$/.test(file)) continue;
    seen.add(file);
    for (const specifier of specifiers(file)) {
      const next = resolveLocal(file, specifier);
      if (next) queue.push(next);
    }
  }
  return seen;
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("document parser isolation", () => {
  it("imports Word, Excel and PDF parsers only in the sandboxed preview frame", () => {
    const importers = sourceFiles(SOURCE).filter((file) =>
      specifiers(file).some((specifier) => DOCUMENT_PARSERS.test(specifier)),
    );
    expect(importers.map((file) => path.relative(SOURCE, file).replaceAll("\\", "/"))).toEqual([
      "preview/main.ts",
    ]);
  });

  it("keeps the preview frame out of the application's own module graph", () => {
    const app = reachable(APP_ENTRY);
    expect(app.size).toBeGreaterThan(50);
    expect(app.has(FRAME_ENTRY)).toBe(false);
    for (const file of app) {
      expect(specifiers(file).filter((specifier) => DOCUMENT_PARSERS.test(specifier))).toEqual([]);
    }
  });

  it("loads the frame without same-origin rights", () => {
    const host = readFileSync(path.join(SOURCE, "files", "preview-frame.tsx"), "utf8");
    expect(host).toMatch(/sandbox="allow-scripts"/);
    expect(host).not.toMatch(/allow-same-origin/);
    expect(readFileSync(path.resolve(SOURCE, "..", "preview.html"), "utf8")).toMatch(
      /src="\/src\/preview\/main\.ts"/,
    );
  });
});
