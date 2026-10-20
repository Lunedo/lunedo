import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { api } from "../../api/client.js";
import type { paths } from "../../api/generated/schema.js";
import { request } from "../../api/request.js";

type Ok<Path extends keyof paths> =
  NonNullable<paths[Path]["get"]> extends {
    responses: { 200: { content: { "application/json": infer Body } } };
  }
    ? Body
    : never;

export type Statistics = Ok<"/api/v1/spaces/{spaceId}/statistics">;
export type StatisticsPeriod = "7d" | "30d" | "90d" | "12m";
export type SearchTerm = Statistics["topTerms"][number];
export type UnhelpfulArticle = Statistics["unhelpful"][number];
export type ReadArticle = Statistics["mostRead"][number];
export type FeedbackNote =
  Ok<"/api/v1/spaces/{spaceId}/statistics/articles/{itemId}/feedback">["items"][number];

export const STATISTICS_PERIODS: StatisticsPeriod[] = ["7d", "30d", "90d", "12m"];

export const statisticsKeys = {
  all: (spaceId: string) => ["spaces", spaceId, "knowledgeBase", "statistics"] as const,
  overview: (spaceId: string, period: StatisticsPeriod) =>
    ["spaces", spaceId, "knowledgeBase", "statistics", "overview", period] as const,
  feedback: (spaceId: string, itemId: string, period: StatisticsPeriod) =>
    ["spaces", spaceId, "knowledgeBase", "statistics", "feedback", itemId, period] as const,
};

export function statisticsQuery(spaceId: string, period: StatisticsPeriod) {
  return queryOptions({
    queryKey: statisticsKeys.overview(spaceId, period),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/spaces/{spaceId}/statistics", {
          params: { path: { spaceId }, query: { period } },
        }),
      ),
    staleTime: 60_000,
  });
}

export function feedbackQuery(spaceId: string, itemId: string, period: StatisticsPeriod) {
  return infiniteQueryOptions({
    queryKey: statisticsKeys.feedback(spaceId, itemId, period),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      request(() =>
        api.GET("/api/v1/spaces/{spaceId}/statistics/articles/{itemId}/feedback", {
          params: {
            path: { spaceId, itemId },
            query: { period, ...(pageParam ? { cursor: pageParam } : {}) },
          },
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
