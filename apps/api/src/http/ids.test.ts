import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { idSchema } from "@pagehall/shared";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../../..");
const SOURCES = ["apps/api/src", "packages/shared/src"];
const DEFINITION = path.join("packages", "shared", "src", "validation.ts");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

describe("IDs at the API boundary", () => {
  it("are normalized to small letters", () => {
    expect(idSchema.parse("01929B1E-8D4B-7E3F-A05C-4D3E2F1A6B7C")).toBe(
      "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c",
    );
    expect(idSchema.safeParse("not-an-id").success).toBe(false);
  });

  it("are validated with the shared ID schema everywhere", () => {
    const offenders = SOURCES.flatMap((source) => sourceFiles(path.join(root, source)))
      .filter((file) => path.relative(root, file) !== DEFINITION)
      .filter((file) => readFileSync(file, "utf8").includes("z.uuid("))
      .map((file) => path.relative(root, file));
    expect(offenders).toEqual([]);
  });
});
