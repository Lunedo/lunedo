import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { copyPageFiles, pageFiles } from "./page-files.ts";

function dist(files: Record<string, string>): string {
  const folder = mkdtempSync(path.join(tmpdir(), "lunedo-page-files-"));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(folder, name)), { recursive: true });
    writeFileSync(path.join(folder, name), content);
  }
  return folder;
}

const built = {
  "print.html": `<script type="module" src="/assets/print-a1.js"></script><link rel="stylesheet" href="/assets/print-b2.css">`,
  "index.html": `<script type="module" src="/assets/index-c3.js"></script>`,
  "assets/print-a1.js": `import{a as t}from"./shared-d4.js";const l=()=>import("./math-e5.js");const n="index.js";`,
  "assets/shared-d4.js": `export const a=1;`,
  "assets/math-e5.js": `const d=["assets/math-f6.css"];`,
  "assets/math-f6.css": `.m{}`,
  "assets/print-b2.css": `@font-face{src:url(/assets/font-g7.woff2) format("woff2"),url(./font-g7.woff)}`,
  "assets/font-g7.woff2": "font",
  "assets/font-g7.woff": "font",
  "assets/index-c3.js": `import"./editor-h8.js";`,
  "assets/editor-h8.js": `export{};`,
  "assets/print-a1.js.br": "compressed",
};

describe("the files of one page", () => {
  it("follow static and dynamic imports, style sheets and fonts, and nothing of other pages", () => {
    assert.deepEqual(pageFiles(dist(built), "print.html"), [
      "assets/font-g7.woff",
      "assets/font-g7.woff2",
      "assets/math-e5.js",
      "assets/math-f6.css",
      "assets/print-a1.js",
      "assets/print-b2.css",
      "assets/shared-d4.js",
      "print.html",
    ]);
  });

  it("are copied with their folders into the target", () => {
    const source = dist(built);
    const target = mkdtempSync(path.join(tmpdir(), "lunedo-page-target-"));
    copyPageFiles(source, "print.html", target);
    assert.equal(readFileSync(path.join(target, "assets/shared-d4.js"), "utf8"), "export const a=1;");
    assert.ok(!readdirSync(path.join(target, "assets")).some((name) => name.endsWith(".br")));
    assert.ok(!readdirSync(path.join(target, "assets")).includes("editor-h8.js"));
  });
});
