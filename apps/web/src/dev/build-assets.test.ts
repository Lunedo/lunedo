import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUILD_PLACEHOLDER,
  buildIdentity,
  encodingsFor,
  ICON_MODULES,
  precompress,
  stampBuild,
  withLocaleChunks,
} from "./build-assets.js";

describe("precompressed build files", () => {
  let directory = "";
  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it("compress scripts, styles and pages but leave small files and images alone", () => {
    expect(encodingsFor("assets/main-1234.js", 4096)).toEqual(["br", "gz"]);
    expect(encodingsFor("index.html", 4096)).toEqual(["br", "gz"]);
    expect(encodingsFor("assets/main-1234.css", 4096)).toEqual(["br", "gz"]);
    expect(encodingsFor("assets/tiny-1234.js", 200)).toEqual([]);
    expect(encodingsFor("excalidraw/fonts/Virgil.woff2", 40_000)).toEqual([]);
    expect(encodingsFor("assets/logo.png", 40_000)).toEqual([]);
    expect(encodingsFor("assets/main-1234.js.br", 40_000)).toEqual([]);
  });

  it("keep only a gzip copy of the draw.io files, which load only when a diagram is edited", () => {
    expect(encodingsFor("drawio/31.4.6/js/app.min.js", 4096)).toEqual(["gz"]);
    expect(encodingsFor("drawio/31.4.6/stencils/aws4.xml", 4096)).toEqual(["gz"]);
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

  it("write only the gzip copy below the draw.io folder", async () => {
    directory = mkdtempSync(path.join(tmpdir(), "lunedo-build-"));
    const script = "export const value = 1;\n".repeat(500);
    mkdirSync(path.join(directory, "drawio", "js"), { recursive: true });
    writeFileSync(path.join(directory, "drawio", "js", "app.min.js"), script);
    expect(await precompress(directory)).toBe(1);
    expect(gunzipSync(readFileSync(path.join(directory, "drawio", "js", "app.min.js.gz"))).toString()).toBe(
      script,
    );
    expect(existsSync(path.join(directory, "drawio", "js", "app.min.js.br"))).toBe(false);
  });
});

describe("the icon chunk", () => {
  it("takes every icon module, on Windows and Unix paths, and nothing else", () => {
    expect(
      ICON_MODULES.test(
        "/repo/node_modules/.pnpm/lucide-react@1.0.0_react@19/node_modules/lucide-react/dist/esm/icons/x.js",
      ),
    ).toBe(true);
    expect(ICON_MODULES.test("C:\\repo\\node_modules\\lucide-react\\dist\\esm\\icons\\monitor.js")).toBe(
      true,
    );
    expect(ICON_MODULES.test("/repo/node_modules/lucide/dist/esm/icons/x.js")).toBe(false);
    expect(ICON_MODULES.test("/repo/apps/web/src/shell/lucide-react-icons.ts")).toBe(false);
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

describe("the build identity", () => {
  it("is the same in the start page and in build.json, taken from the final list of chunks", () => {
    const page = {
      type: "asset",
      fileName: "index.html",
      source: `<meta name="lunedo-build" content="${BUILD_PLACEHOLDER}">`,
    };
    const bundle = {
      main: { type: "chunk", fileName: "assets/main-1.js" },
      page,
      style: { type: "asset", fileName: "assets/main-1.css", source: BUILD_PLACEHOLDER },
    };
    const build = stampBuild(bundle);
    expect(build).toBe(buildIdentity(bundle));
    expect(page.source).toBe(`<meta name="lunedo-build" content="${build}">`);
    expect(bundle.style.source).toBe(BUILD_PLACEHOLDER);
    expect(stampBuild({ ...bundle, late: { type: "chunk", fileName: "assets/late-2.js" } })).not.toBe(build);
  });
});
