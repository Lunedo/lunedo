import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { api } from "../api/client.js";
import type { paths } from "../api/generated/schema.js";
import { request } from "../api/request.js";

type Json<T> = T extends { content: { "application/json": infer Body } } ? Body : never;
type Ok<Path extends keyof paths, Method extends "get" | "post" | "put"> = Json<
  NonNullable<paths[Path][Method]> extends { responses: infer Responses }
    ? Responses[keyof Responses & (200 | 201)]
    : never
>;

export type KnowledgeBaseSettings = Ok<"/api/v1/spaces/{spaceId}/knowledge-base", "get">;
export type Audience = KnowledgeBaseSettings["audience"];
export type Category = Ok<"/api/v1/spaces/{spaceId}/categories", "get">[number];
export type ArticleSummary = Ok<"/api/v1/spaces/{spaceId}/articles", "get">["items"][number];
export type ArticleType = "howTo" | "troubleshooting";
export type TemplateSections = Ok<"/api/v1/spaces/{spaceId}/knowledge-base/templates", "get">[number];
export type ArticleTypeFilter = ArticleType | "all";

export const ARTICLES_PAGE = 25;

export const knowledgeBaseKeys = {
  all: (spaceId: string) => ["spaces", spaceId, "knowledgeBase"] as const,
  settings: (spaceId: string) => ["spaces", spaceId, "knowledgeBase", "settings"] as const,
  categories: (spaceId: string) => ["spaces", spaceId, "knowledgeBase", "categories"] as const,
  templates: (spaceId: string) => ["spaces", spaceId, "knowledgeBase", "templates"] as const,
  articles: (spaceId: string, categoryId: string | null, type: ArticleTypeFilter) =>
    ["spaces", spaceId, "knowledgeBase", "articles", categoryId, type] as const,
};

export function knowledgeBaseSettingsQuery(spaceId: string) {
  return queryOptions({
    queryKey: knowledgeBaseKeys.settings(spaceId),
    queryFn: () =>
      request(() => api.GET("/api/v1/spaces/{spaceId}/knowledge-base", { params: { path: { spaceId } } })),
  });
}

export function categoriesQuery(spaceId: string) {
  return queryOptions({
    queryKey: knowledgeBaseKeys.categories(spaceId),
    queryFn: () =>
      request(() => api.GET("/api/v1/spaces/{spaceId}/categories", { params: { path: { spaceId } } })),
    staleTime: 10_000,
  });
}

export function templateSectionsQuery(spaceId: string) {
  return queryOptions({
    queryKey: knowledgeBaseKeys.templates(spaceId),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/spaces/{spaceId}/knowledge-base/templates", { params: { path: { spaceId } } }),
      ),
  });
}

export function articlesQuery(spaceId: string, categoryId: string | null, type: ArticleTypeFilter) {
  return infiniteQueryOptions({
    queryKey: knowledgeBaseKeys.articles(spaceId, categoryId, type),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      request(() =>
        api.GET("/api/v1/spaces/{spaceId}/articles", {
          params: {
            path: { spaceId },
            query: {
              limit: ARTICLES_PAGE,
              ...(categoryId ? { categoryId } : { topLevel: "true" as const }),
              ...(type === "all" ? {} : { type }),
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 10_000,
  });
}

export function isKnowledgeBase(space: { type: string }): boolean {
  return space.type === "knowledgeBase";
}
