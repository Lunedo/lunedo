import { queryOptions } from "@tanstack/react-query";
import { api } from "./client.js";
import { fetchAllPages } from "./queries.js";
import { request } from "./request.js";

export const accountKeys = {
  security: ["account", "security"] as const,
  sessions: ["account", "sessions"] as const,
  tokens: ["account", "tokens"] as const,
};

export const securityQuery = queryOptions({
  queryKey: accountKeys.security,
  queryFn: () => request(() => api.GET("/api/v1/account/security")),
});

export type ManagingProvider = NonNullable<
  Awaited<ReturnType<NonNullable<(typeof securityQuery)["queryFn"]>>>["managedBy"]
>;

export function signsInOnlyThroughProvider(managedBy: { providerType: string } | null | undefined): boolean {
  return managedBy !== null && managedBy !== undefined && managedBy.providerType !== "ldap";
}

export const sessionsQuery = queryOptions({
  queryKey: accountKeys.sessions,
  queryFn: () =>
    fetchAllPages((cursor) =>
      request(() =>
        api.GET("/api/v1/account/sessions", {
          params: { query: { limit: 200, ...(cursor ? { cursor } : {}) } },
        }),
      ),
    ),
});

export const ownTokensQuery = queryOptions({
  queryKey: accountKeys.tokens,
  queryFn: () =>
    fetchAllPages((cursor) =>
      request(() =>
        api.GET("/api/v1/account/tokens", {
          params: { query: { limit: 200, ...(cursor ? { cursor } : {}) } },
        }),
      ),
    ),
});

export type ApiToken = Awaited<ReturnType<NonNullable<(typeof ownTokensQuery)["queryFn"]>>>[number];

export function tokenLifetimeQuery(organizationId: string | null) {
  return queryOptions({
    queryKey: [...accountKeys.tokens, "lifetime", organizationId],
    queryFn: async () =>
      (
        await request(() =>
          api.GET("/api/v1/account/tokens/lifetime", {
            params: { query: organizationId ? { organizationId } : {} },
          }),
        )
      ).maxLifetimeDays,
  });
}
