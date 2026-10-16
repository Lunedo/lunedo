export const EXCALIDRAW_ASSET_PATH = "/excalidraw/";

const FALLBACK = /(\w+)\.push\(new URL\((\w+),(\w+)\.ASSETS_FALLBACK_URL\)\),/;
const PRODUCTION_CHUNK = /[\\/]@excalidraw[\\/]excalidraw[\\/]dist[\\/]prod[\\/][^\\/]+\.js$/;

export class ExcalidrawFallbackError extends Error {
  override name = "ExcalidrawFallbackError";
}

export function isExcalidrawChunk(id: string): boolean {
  return PRODUCTION_CHUNK.test(id.split("?")[0] ?? "");
}

export function withoutFontFallback(code: string): string | null {
  if (!code.includes("ASSETS_FALLBACK_URL")) return null;
  if (!FALLBACK.test(code)) {
    throw new ExcalidrawFallbackError(
      "Excalidraw loads fonts from a CDN when the instance does not serve them; update the pattern for this version",
    );
  }
  return code.replace(FALLBACK, "");
}

export function fontPath(url: string | undefined): string | null {
  if (!url) return null;
  const path = new URL(url, "http://localhost").pathname;
  if (!path.startsWith(`${EXCALIDRAW_ASSET_PATH}fonts/`)) return null;
  const relative = decodeURIComponent(path.slice(EXCALIDRAW_ASSET_PATH.length));
  if (relative.split("/").some((part) => part === ".." || part === "")) return null;
  return /^fonts\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+\.woff2$/.test(relative) ? relative : null;
}
