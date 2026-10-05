import { slugify } from "@pagehall/editor-schema";
import { useEffect, useSyncExternalStore } from "react";
import { api } from "../api/client.js";
import { isApiError, request } from "../api/request.js";

export interface PageReference {
  title: string;
  spaceKey: string;
  kind: string;
  accessible: boolean;
}

export interface References {
  people: Record<string, string>;
  pages: Record<string, PageReference>;
}

const people = new Map<string, string>();
const pages = new Map<string, PageReference>();
const pending = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function rememberReferences(references: Partial<References>): void {
  let changed = false;
  for (const [id, name] of Object.entries(references.people ?? {})) {
    if (people.get(id) !== name) {
      people.set(id, name);
      changed = true;
    }
  }
  for (const [id, page] of Object.entries(references.pages ?? {})) {
    const known = pages.get(id);
    if (!known || known.title !== page.title || known.accessible !== page.accessible) {
      pages.set(id, page);
      changed = true;
    }
  }
  if (changed) emit();
}

export function personName(id: string): string | null {
  return people.get(id) ?? null;
}

export function pageReference(id: string): PageReference | null {
  return pages.get(id) ?? null;
}

export function usePersonName(id: string): string | null {
  return useSyncExternalStore(subscribe, () => (version >= 0 ? (people.get(id) ?? null) : null));
}

async function loadPage(id: string): Promise<void> {
  if (pending.has(id) || pages.has(id)) return;
  pending.add(id);
  try {
    const item = await request(() => api.GET("/api/v1/items/{itemId}", { params: { path: { itemId: id } } }));
    rememberReferences({
      pages: { [id]: { title: item.title, spaceKey: item.spaceKey, kind: item.kind, accessible: true } },
    });
  } catch (error) {
    if (isApiError(error, "notFound") || isApiError(error, "forbidden")) {
      rememberReferences({ pages: { [id]: { title: "", spaceKey: "", kind: "page", accessible: false } } });
    }
  } finally {
    pending.delete(id);
  }
}

export function usePageReference(id: string | null): PageReference | null {
  const page = useSyncExternalStore(subscribe, () => (id && version >= 0 ? (pages.get(id) ?? null) : null));
  useEffect(() => {
    if (id && !page) void loadPage(id);
  }, [id, page]);
  return page;
}

export function pagePath(spaceKey: string, pageId: string, title: string): string {
  return `/spaces/${encodeURIComponent(spaceKey)}/pages/${pageId}/${slugify(title)}`;
}

export async function followTitleLink(
  sourcePageId: string,
  target: { spaceId: string; title: string },
): Promise<string> {
  const result = await request(() =>
    api.POST("/api/v1/pages/{pageId}/links/follow", {
      params: { path: { pageId: sourcePageId } },
      body: target,
    }),
  );
  const item = await request(() =>
    api.GET("/api/v1/items/{itemId}", { params: { path: { itemId: result.itemId } } }),
  );
  rememberReferences({
    pages: { [item.id]: { title: item.title, spaceKey: item.spaceKey, kind: item.kind, accessible: true } },
  });
  return pagePath(item.spaceKey, item.id, item.title);
}

export async function searchPeople(query: string) {
  const page = await request(() => api.GET("/api/v1/people", { params: { query: { q: query, limit: 8 } } }));
  rememberReferences({ people: Object.fromEntries(page.items.map((person) => [person.id, person.name])) });
  return page.items;
}

export async function searchPages(query: string) {
  const items = await request(() => api.GET("/api/v1/items", { params: { query: { q: query, limit: 8 } } }));
  rememberReferences({
    pages: Object.fromEntries(
      items.map((item) => [
        item.id,
        { title: item.title, spaceKey: item.spaceKey, kind: item.kind, accessible: true },
      ]),
    ),
  });
  return items;
}
