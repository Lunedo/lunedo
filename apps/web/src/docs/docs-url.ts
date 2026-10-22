const DOCS_BASE = "https://github.com/lunedo/lunedo/blob/main/docs/";

export function docsUrl(page: string): string {
  return `${DOCS_BASE}${page.replace(/^\/+/, "")}`;
}
