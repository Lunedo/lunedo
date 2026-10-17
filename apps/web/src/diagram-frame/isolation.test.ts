import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = path.resolve(import.meta.dirname, "..");
const RENDERERS = /^(mermaid|@plantuml\/core)(\/|$)/;
const SPECIFIER = /import\s*\(\s*["']([^"']+)["']\s*\)|from\s*["']([^"']+)["']|import\s+["']([^"']+)["']/g;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.(test|d)\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe("diagram renderer isolation", () => {
  it("loads Mermaid and PlantUML only in the sandboxed diagram frame", () => {
    const importers = sourceFiles(SOURCE).filter((file) =>
      [...readFileSync(file, "utf8").matchAll(SPECIFIER)].some((match) =>
        RENDERERS.test(match[1] ?? match[2] ?? match[3] ?? ""),
      ),
    );
    expect(importers.map((file) => path.relative(SOURCE, file).replaceAll("\\", "/"))).toEqual([
      "diagram-frame/main.ts",
    ]);
  });

  it("opens the diagram frame and draw.io without same-origin rights", () => {
    const renderer = readFileSync(path.join(SOURCE, "diagrams", "text-renderer.ts"), "utf8");
    expect(renderer).toMatch(/setAttribute\("sandbox", "allow-scripts"\)/);
    const drawio = readFileSync(path.join(SOURCE, "diagrams", "drawio-editor.tsx"), "utf8");
    expect(drawio).toMatch(/sandbox="allow-scripts allow-downloads"/);
    for (const text of [renderer, drawio])
      expect(text).not.toMatch(/allow-same-origin|allow-popups|allow-top-navigation/);
    expect(readFileSync(path.resolve(SOURCE, "..", "diagram.html"), "utf8")).toMatch(
      /src="\/src\/diagram-frame\/main\.ts"/,
    );
  });
});
