import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ExcalidrawFallbackError,
  fontPath,
  isExcalidrawChunk,
  withoutFontFallback,
} from "./excalidraw-assets.js";

const PRODUCTION = path.resolve("node_modules/@excalidraw/excalidraw/dist/prod");

describe("Excalidraw assets", () => {
  it("removes the CDN fallback for fonts from the installed production build", () => {
    const chunks = readdirSync(PRODUCTION).filter((name) => name.endsWith(".js"));
    const changed = chunks
      .map((name) => withoutFontFallback(readFileSync(path.join(PRODUCTION, name), "utf8")))
      .filter((code): code is string => code !== null);
    expect(changed).toHaveLength(1);
    expect(changed[0]).not.toMatch(/push\(new URL\(\w+,\w+\.ASSETS_FALLBACK_URL\)\)/);
  });

  it("fails the build when a new version loads fonts from the CDN in another way", () => {
    expect(() => withoutFontFallback("urls.push(ASSETS_FALLBACK_URL)")).toThrow(ExcalidrawFallbackError);
    expect(withoutFontFallback("const unrelated = 1;")).toBeNull();
  });

  it("recognizes the production chunks of Excalidraw only", () => {
    expect(isExcalidrawChunk("/repo/node_modules/@excalidraw/excalidraw/dist/prod/chunk-K2UTITRG.js")).toBe(
      true,
    );
    expect(
      isExcalidrawChunk("C:\\repo\\node_modules\\@excalidraw\\excalidraw\\dist\\prod\\index.js?v=1"),
    ).toBe(true);
    expect(isExcalidrawChunk("/repo/node_modules/@excalidraw/excalidraw/dist/dev/index.js")).toBe(false);
    expect(isExcalidrawChunk("/repo/src/whiteboards/canvas.tsx")).toBe(false);
  });

  it("serves only font files below the asset path", () => {
    expect(fontPath("/excalidraw/fonts/Excalifont/Excalifont-Regular-349f.woff2")).toBe(
      "fonts/Excalifont/Excalifont-Regular-349f.woff2",
    );
    expect(fontPath("/excalidraw/fonts/../../../etc/passwd")).toBeNull();
    expect(fontPath("/excalidraw/fonts/%2e%2e/secret.woff2")).toBeNull();
    expect(fontPath("/excalidraw/index.js")).toBeNull();
    expect(fontPath("/assets/app.js")).toBeNull();
    expect(fontPath(undefined)).toBeNull();
  });
});
