const DOCS_BASE = "https://lunedo.org/docs/";

export function docsUrl(page: string): string {
  const hash = page.indexOf("#");
  const file = (hash < 0 ? page : page.slice(0, hash)).replace(/^\/+/, "");
  const anchor = hash < 0 ? "" : page.slice(hash);
  const path = file.replace(/(?:^|\/)README\.md$/, "").replace(/\.md$/, "");
  return `${DOCS_BASE}${path === "" ? "" : `${path}/`}${anchor}`;
}
