// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SOURCE = fileURLToPath(new URL(".", import.meta.url));

const FORBIDDEN = [
  { name: "hex color", pattern: /#[0-9a-fA-F]{3,8}\b/ },
  { name: "rgb or hsl color", pattern: /\b(?:rgba?|hsla?|oklch|oklab)\(/ },
  { name: "pixel size", pattern: /\d+(?:\.\d+)?px\b/ },
  { name: "arbitrary value", pattern: /(?:^|[\s:])-?[a-z][\w-]*-\[[^\]]*\]/ },
  { name: "arbitrary variant", pattern: /(?:^|\s)[\w-]*\[[^\]]*\]:/ },
  { name: "arbitrary property", pattern: /(?:^|\s)\[[a-z-]+:[^\]]+\]/ },
  { name: "variable shorthand", pattern: /-\(--/ },
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "testing" ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function stringLiterals(source: string): string[] {
  return [...source.matchAll(/"([^"\n]*)"|`([^`]*)`/g)].map((match) => match[1] ?? match[2] ?? "");
}

function rawValues(source: string): string[] {
  return stringLiterals(source).flatMap((literal) =>
    FORBIDDEN.filter(({ pattern }) => pattern.test(literal)).map(({ name }) => `${name}: ${literal}`),
  );
}

describe("component styles", () => {
  it("use only token-based classes", () => {
    const files = sourceFiles(SOURCE);
    expect(files.length).toBeGreaterThan(10);
    const findings = files.flatMap((file) =>
      rawValues(readFileSync(file, "utf8")).map((finding) => `${path.basename(file)}: ${finding}`),
    );
    expect(findings).toEqual([]);
  });

  it("detect raw values", () => {
    expect(rawValues('className="bg-[#fff]"')).not.toEqual([]);
    expect(rawValues('className="w-[13px] p-2"')).not.toEqual([]);
    expect(rawValues('className="data-[state=open]:bg-hover"')).not.toEqual([]);
    expect(rawValues('const color = "rgb(1, 2, 3)"')).not.toEqual([]);
    expect(rawValues('className="w-(--width)"')).not.toEqual([]);
    expect(rawValues('className="bg-accent p-4 aria-checked:bg-accent"')).toEqual([]);
  });
});
