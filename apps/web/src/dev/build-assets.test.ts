import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { isCompressible, precompress, withLocaleChunks } from "./build-assets.js";

describe("precompressed build files", () => {
  let directory = "";
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it("compress scripts, styles and pages but leave small files and images alone", () => {
    expect(isCompressible("assets/main-1234.js", 4096)).toBe(true);
    expect(isCompressible("drawio/31.4.6/js/app.min.js", 4096)).toBe(true);
    expect(isCompressible("index.html", 4096)).toBe(true);
    expect(isCompressible("assets/main-1234.css", 4096)).toBe(true);
    expect(isCompressible("assets/tiny-1234.js", 200)).toBe(false);
    expect(isCompressible("excalidraw/fonts/Virgil.woff2", 40_000)).toBe(false);
    expect(isCompressible("assets/logo.png", 40_000)).toBe(false);
    expect(isCompressible("assets/main-1234.js.br", 40_000)).toBe(false);
  });

  it("write brotli and gzip copies next to each file with the same content", async () => {
    directory = mkdtempSync(path.join(tmpdir(), "lunedo-build-"));
    const script = "export const value = 1;\n".repeat(500);
    writeFileSync(path.join(directory, "main.js"), script);
    writeFileSync(path.join(directory, "small.js"), "1");
    expect(await precompress(directory)).toBe(2);
    expect(brotliDecompressSync(readFileSync(path.join(directory, "main.js.br"))).toString()).toBe(script);
    expect(gunzipSync(readFileSync(path.join(directory, "main.js.gz"))).toString()).toBe(script);
    expect(() => readFileSync(path.join(directory, "small.js.br"))).toThrow();
  });
});

describe("the language files in the start page", () => {
  it("name the built file of each language so that the start script can preload the active one", () => {
    const html = `<script>var localeChunks = "__LUNEDO_LOCALE_CHUNKS__";</script>`;
    const result = withLocaleChunks(html, {
      a: { type: "chunk", fileName: "assets/de-1234.js", facadeModuleId: "/app/src/i18n/locales/de.json" },
      b: {
        type: "chunk",
        fileName: "assets/en-5678.js",
        facadeModuleId: "C:\\app\\src\\i18n\\locales\\en.json",
      },
      c: { type: "chunk", fileName: "assets/main-1.js", facadeModuleId: "/app/src/main.tsx" },
      d: { type: "asset", fileName: "assets/main-1.css" },
    });
    expect(result).toBe(
      `<script>var localeChunks = {"de":"/assets/de-1234.js","en":"/assets/en-5678.js"};</script>`,
    );
  });

  it("leave an empty list while developing", () => {
    expect(withLocaleChunks(`var localeChunks = "__LUNEDO_LOCALE_CHUNKS__";`, undefined)).toBe(
      "var localeChunks = {};",
    );
  });
});
