import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { api } from "../../api/client.js";
import type { paths } from "../../api/generated/schema.js";
import { request } from "../../api/request.js";

type Json<T> = T extends { content: { "application/json": infer Body } } ? Body : never;
type Ok<Path extends keyof paths, Method extends "get" | "post" | "put"> = Json<
  NonNullable<paths[Path][Method]> extends { responses: infer Responses }
    ? Responses[keyof Responses & (200 | 201)]
    : never
>;

export type ReviewSettings = Ok<"/api/v1/spaces/{spaceId}/knowledge-base/reviews", "get">;
export type ReviewList = Ok<"/api/v1/spaces/{spaceId}/reviews", "get">;
export type ReviewItem = ReviewList["items"][number];
export type ReviewFilter = "all" | "due" | "soon" | "unowned" | "translations";
export type ArticleReview = Ok<"/api/v1/articles/{itemId}/review", "get">;
export type ReviewState = ArticleReview["state"];
export type ArticleSource = Ok<"/api/v1/articles/{itemId}/sources", "get">[number];
export type HomeReviews = Ok<"/api/v1/reviews/mine", "get">;

export const REVIEWS_PAGE = 50;

export const reviewKeys = {
  settings: (spaceId: string) => ["spaces", spaceId, "knowledgeBase", "reviews", "settings"] as const,
  lists: (spaceId: string) => ["spaces", spaceId, "knowledgeBase", "reviews", "list"] as const,
  list: (spaceId: string, filter: ReviewFilter, mine: boolean) =>
    ["spaces", spaceId, "knowledgeBase", "reviews", "list", filter, mine] as const,
  article: (itemId: string) => ["items", itemId, "review"] as const,
  sources: (itemId: string) => ["items", itemId, "sources"] as const,
  hiddenSources: (itemId: string) => ["items", itemId, "hiddenSources"] as const,
  mine: ["reviews", "mine"] as const,
};

export function reviewSettingsQuery(spaceId: string) {
  return queryOptions({
    queryKey: reviewKeys.settings(spaceId),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/spaces/{spaceId}/knowledge-base/reviews", { params: { path: { spaceId } } }),
      ),
  });
}

export function reviewListQuery(spaceId: string, filter: ReviewFilter, mine: boolean) {
  return infiniteQueryOptions({
    queryKey: reviewKeys.list(spaceId, filter, mine),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      request(() =>
        api.GET("/api/v1/spaces/{spaceId}/reviews", {
          params: {
            path: { spaceId },
            query: {
              limit: REVIEWS_PAGE,
              filter,
              mine: mine ? "true" : "false",
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 10_000,
  });
}

export function reviewCountsQuery(spaceId: string) {
  return queryOptions({
    queryKey: [...reviewKeys.lists(spaceId), "counts"] as const,
    queryFn: async () =>
      (
        await request(() =>
          api.GET("/api/v1/spaces/{spaceId}/reviews", {
            params: { path: { spaceId }, query: { limit: 1, filter: "due", mine: "false" } },
          }),
        )
      ).counts,
    staleTime: 30_000,
  });
}

export function articleReviewQuery(itemId: string) {
  return queryOptions({
    queryKey: reviewKeys.article(itemId),
    queryFn: () =>
      request(() => api.GET("/api/v1/articles/{itemId}/review", { params: { path: { itemId } } })),
  });
}

export function articleSourcesQuery(itemId: string) {
  return queryOptions({
    queryKey: reviewKeys.sources(itemId),
    queryFn: () =>
      request(() => api.GET("/api/v1/articles/{itemId}/sources", { params: { path: { itemId } } })),
  });
}

export function hiddenSourcesQuery(itemId: string) {
  return queryOptions({
    queryKey: reviewKeys.hiddenSources(itemId),
    queryFn: () =>
      request(() => api.GET("/api/v1/articles/{itemId}/hidden-sources", { params: { path: { itemId } } })),
  });
}

export function homeReviewsQuery() {
  return queryOptions({
    queryKey: reviewKeys.mine,
    queryFn: () => request(() => api.GET("/api/v1/reviews/mine")),
    staleTime: 30_000,
  });
}
