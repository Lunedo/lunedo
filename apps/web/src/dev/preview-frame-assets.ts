const SERVER_PATHS = ["/api", "/scim", "/collab", "/health"];

export function isPreviewFrameAsset(
  method: string | undefined,
  url: string | undefined,
  origin: string | undefined,
): boolean {
  if (origin !== "null" || (method !== "GET" && method !== "HEAD") || !url?.startsWith("/")) return false;
  const path = new URL(url, "http://localhost").pathname.toLowerCase();
  return !SERVER_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
