export const SHEETJS_TAGS_URL = "https://git.sheetjs.com/api/v1/repos/sheetjs/sheetjs/tags?limit=50";

const PINNED = /cdn\.sheetjs\.com\/xlsx-(\d+\.\d+\.\d+)\/xlsx-\1\.tgz$/;
const RELEASE = /^v?(\d+)\.(\d+)\.(\d+)$/;

export function pinnedVersion(specifier: string | undefined): string | null {
  return specifier ? (PINNED.exec(specifier)?.[1] ?? null) : null;
}

function parts(version: string): [number, number, number] | null {
  const match = RELEASE.exec(version);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compare(a: [number, number, number], b: [number, number, number]): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export function latestRelease(tags: readonly { name?: unknown }[]): string | null {
  let latest: [number, number, number] | null = null;
  for (const tag of tags) {
    const version = typeof tag.name === "string" ? parts(tag.name) : null;
    if (version && (!latest || compare(version, latest) > 0)) latest = version;
  }
  return latest ? latest.join(".") : null;
}

export function formatReport(pinned: string | null, latest: string | null): string {
  const heading = "## SheetJS release";
  if (!pinned) return `${heading}\n\nThe pinned SheetJS tarball was not found in apps/web/package.json.\n`;
  if (!latest) return `${heading}\n\nThe latest SheetJS release could not be read. Pinned: ${pinned}.\n`;
  const pinnedParts = parts(pinned);
  const latestParts = parts(latest);
  if (pinnedParts && latestParts && compare(latestParts, pinnedParts) > 0) {
    return `${heading}\n\nSheetJS ${latest} is available; Pagehall pins ${pinned}. Update the tarball URL in apps/web/package.json and the lockfile.\n`;
  }
  return `${heading}\n\nThe pinned SheetJS ${pinned} is the latest release.\n`;
}
