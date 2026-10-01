const DOCS_BASE = "https://github.com/pagehall/pagehall/blob/main/docs/";

export function docsUrl(page: string): string {
  return `${DOCS_BASE}${page.replace(/^\/+/, "")}`;
}
