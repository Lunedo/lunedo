import { slugify } from "@lunedo/editor-schema";
import { useEffect, useSyncExternalStore } from "react";
import { api } from "../api/client.js";
import { isApiError, request } from "../api/request.js";

export interface PageReference {
  title: string;
  spaceKey: string;
  kind: string;
  accessible: boolean;
  inTrash?: boolean;
}

export interface TopicReference {
  title: string;
  status: string;
}

export interface References {
  people: Record<string, string>;
  pages: Record<string, PageReference>;
  topics?: Record<string, TopicReference>;
  tooLargeImages?: string[];
}

const people = new Map<string, string>();
const topics = new Map<string, TopicReference>();
const pages = new Map<string, PageReference>();
const tooLargeImages = new Set<string>();
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
  for (const id of references.tooLargeImages ?? []) {
    if (!tooLargeImages.has(id)) {
      tooLargeImages.add(id);
      changed = true;
    }
  }
  for (const [id, topic] of Object.entries(references.topics ?? {})) {
    const known = topics.get(id);
    if (!known || known.title !== topic.title || known.status !== topic.status) {
      topics.set(id, topic);
      changed = true;
    }
  }
  if (changed) emit();
}

export function useImageTooLarge(id: string | null): boolean {
  return useSyncExternalStore(subscribe, () => version >= 0 && id !== null && tooLargeImages.has(id));
}

export function topicReference(id: string): TopicReference | null {
  return topics.get(id) ?? null;
}

export function useTopicReference(id: string | null): TopicReference | null {
  useSyncExternalStore(subscribe, () => version);
  return id ? (topics.get(id) ?? null) : null;
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

export function usePageReferences(ids: readonly string[]): Record<string, PageReference> {
  useSyncExternalStore(subscribe, () => version);
  const key = ids.join(",");
  useEffect(() => {
    for (const id of key.split(",")) if (id && !pages.has(id)) void loadPage(id);
  }, [key]);
  return Object.fromEntries(
    ids.flatMap((id) => {
      const page = pages.get(id);
      return page ? [[id, page] as const] : [];
    }),
  );
}
