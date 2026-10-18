import { queryOptions } from "@tanstack/react-query";
import { withLanguageNumberFormat } from "../format/language-formats.js";
import { api } from "./client.js";
import { isApiError, request } from "./request.js";

export type InstanceInfo = Awaited<ReturnType<typeof fetchInstanceInfo>>;
export type SessionInfo = NonNullable<Awaited<ReturnType<typeof fetchSession>>>;
export type Preference = Awaited<ReturnType<typeof fetchPreferences>>[number];
export type OwnOrganization = Awaited<ReturnType<typeof fetchOrganizations>>[number];
export type Permissions = Awaited<ReturnType<typeof fetchPermissions>>;

export const queryKeys = {
  instanceInfo: ["instance", "info"] as const,
  session: ["auth", "session"] as const,
  preferences: ["account", "preferences"] as const,
  organizations: ["organizations"] as const,
  permissions: (organizationId: string | null) => ["account", "permissions", organizationId] as const,
};

async function fetchInstanceInfo() {
  return request(() => api.GET("/api/v1/instance/info"), { sessionHandling: false });
}

async function fetchSession() {
  try {
    return await request(() => api.GET("/api/v1/auth/session"), { sessionHandling: false });
  } catch (error) {
    if (isApiError(error, "notSignedIn") || isApiError(error, "sessionEnded")) return null;
    throw error;
  }
}

async function fetchPreferences() {
  return withLanguageNumberFormat(await request(() => api.GET("/api/v1/account/preferences")));
}

export async function fetchAllPages<T>(
  page: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | null }>,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const result = await page(cursor);
    items.push(...result.items);
    cursor = result.nextCursor ?? undefined;
  } while (cursor);
  return items;
}

async function fetchOrganizations() {
  return fetchAllPages((cursor) =>
    request(() =>
      api.GET("/api/v1/organizations", { params: { query: { limit: 200, ...(cursor ? { cursor } : {}) } } }),
    ),
  );
}

async function fetchPermissions(organizationId: string | null) {
  const result = await request(() =>
    api.GET("/api/v1/account/permissions", {
      params: { query: organizationId ? { organizationId } : {} },
    }),
  );
  return {
    instance: new Set(result.instance),
    organization: new Set(result.organization),
    grantableAreas: result.grantableAreas,
  };
}

export const instanceInfoQuery = queryOptions({
  queryKey: queryKeys.instanceInfo,
  queryFn: fetchInstanceInfo,
  staleTime: 60_000,
});

export const sessionQuery = queryOptions({
  queryKey: queryKeys.session,
  queryFn: fetchSession,
  staleTime: 30_000,
});

export const preferencesQuery = queryOptions({
  queryKey: queryKeys.preferences,
  queryFn: fetchPreferences,
  staleTime: 5 * 60_000,
});

export const organizationsQuery = queryOptions({
  queryKey: queryKeys.organizations,
  queryFn: fetchOrganizations,
  staleTime: 60_000,
});

export function permissionsQuery(organizationId: string | null) {
  return queryOptions({
    queryKey: queryKeys.permissions(organizationId),
    queryFn: () => fetchPermissions(organizationId),
    staleTime: 30_000,
  });
}
