import { queryOptions } from "@tanstack/react-query";
import { api } from "./client.js";
import { fetchAllPages } from "./queries.js";
import { request } from "./request.js";

const page = (cursor: string | undefined) => ({ limit: 200, ...(cursor ? { cursor } : {}) });

export const organizationKeys = {
  organization: (id: string) => ["organization", id] as const,
  members: (id: string) => ["organization", id, "members"] as const,
  invitations: (id: string) => ["organization", id, "invitations"] as const,
  groups: (id: string) => ["organization", id, "groups"] as const,
  roles: (id: string) => ["organization", id, "roles"] as const,
  assignments: (id: string) => ["organization", id, "assignments"] as const,
  serviceAccounts: (id: string) => ["organization", id, "serviceAccounts"] as const,
  tokens: (id: string) => ["organization", id, "tokens"] as const,
  settings: (id: string) => ["organization", id, "settings"] as const,
  domains: (id: string) => ["organization", id, "domains"] as const,
  group: (id: string) => ["group", id] as const,
  groupMembers: (id: string) => ["group", id, "members"] as const,
  serviceAccount: (id: string) => ["serviceAccount", id] as const,
  serviceAccountTokens: (id: string) => ["serviceAccount", id, "tokens"] as const,
  memberPermissions: (organizationId: string, accountId: string) =>
    ["organization", organizationId, "members", accountId, "permissions"] as const,
};

export function organizationQuery(id: string) {
  return queryOptions({
    queryKey: organizationKeys.organization(id),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/organizations/{organizationId}", { params: { path: { organizationId: id } } }),
      ),
    staleTime: 60_000,
  });
}

export function membersQuery(organizationId: string) {
  return queryOptions({
    queryKey: organizationKeys.members(organizationId),
    queryFn: () =>
      fetchAllPages((cursor) =>
        request(() =>
          api.GET("/api/v1/organizations/{organizationId}/members", {
            params: { path: { organizationId }, query: page(cursor) },
          }),
        ),
      ),
  });
}

export type Member = Awaited<ReturnType<NonNullable<ReturnType<typeof membersQuery>["queryFn"]>>>[number];

export function invitationsQuery(organizationId: string) {
  return queryOptions({
    queryKey: organizationKeys.invitations(organizationId),
    queryFn: () =>
      fetchAllPages((cursor) =>
        request(() =>
          api.GET("/api/v1/organizations/{organizationId}/invitations", {
            params: { path: { organizationId }, query: page(cursor) },
          }),
        ),
      ),
  });
}

export function groupsQuery(organizationId: string) {
  return queryOptions({
    queryKey: organizationKeys.groups(organizationId),
    queryFn: () =>
      fetchAllPages((cursor) =>
        request(() =>
          api.GET("/api/v1/organizations/{organizationId}/groups", {
            params: { path: { organizationId }, query: page(cursor) },
          }),
        ),
      ),
  });
}

export function groupQuery(groupId: string) {
  return queryOptions({
    queryKey: organizationKeys.group(groupId),
    queryFn: () => request(() => api.GET("/api/v1/groups/{groupId}", { params: { path: { groupId } } })),
  });
}

export function groupMembersQuery(groupId: string) {
  return queryOptions({
    queryKey: organizationKeys.groupMembers(groupId),
    queryFn: () =>
      fetchAllPages((cursor) =>
        request(() =>
          api.GET("/api/v1/groups/{groupId}/members", { params: { path: { groupId }, query: page(cursor) } }),
        ),
      ),
  });
}

export function rolesQuery(organizationId: string) {
  return queryOptions({
    queryKey: organizationKeys.roles(organizationId),
    queryFn: () =>
      fetchAllPages((cursor) =>
        request(() =>
          api.GET("/api/v1/organizations/{organizationId}/roles", {
            params: { path: { organizationId }, query: page(cursor) },
          }),
        ),
      ),
  });
}

export function assignmentsQuery(organizationId: string) {
  return queryOptions({
    queryKey: organizationKeys.assignments(organizationId),
    queryFn: () =>
      fetchAllPages((cursor) =>
        request(() =>
          api.GET("/api/v1/organizations/{organizationId}/role-assignments", {
            params: { path: { organizationId }, query: page(cursor) },
          }),
        ),
      ),
  });
}

export function serviceAccountsQuery(organizationId: string) {
  return queryOptions({
    queryKey: organizationKeys.serviceAccounts(organizationId),
    queryFn: () =>
      fetchAllPages((cursor) =>
        request(() =>
          api.GET("/api/v1/organizations/{organizationId}/service-accounts", {
            params: { path: { organizationId }, query: page(cursor) },
          }),
        ),
      ),
  });
}

export function serviceAccountQuery(serviceAccountId: string) {
  return queryOptions({
    queryKey: organizationKeys.serviceAccount(serviceAccountId),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/service-accounts/{serviceAccountId}", { params: { path: { serviceAccountId } } }),
      ),
  });
}

export function serviceAccountTokensQuery(serviceAccountId: string) {
  return queryOptions({
    queryKey: organizationKeys.serviceAccountTokens(serviceAccountId),
    queryFn: () =>
      fetchAllPages((cursor) =>
        request(() =>
          api.GET("/api/v1/service-accounts/{serviceAccountId}/tokens", {
            params: { path: { serviceAccountId }, query: page(cursor) },
          }),
        ),
      ),
  });
}

export function organizationTokensQuery(organizationId: string) {
  return queryOptions({
    queryKey: organizationKeys.tokens(organizationId),
    queryFn: () =>
      fetchAllPages((cursor) =>
        request(() =>
          api.GET("/api/v1/organizations/{organizationId}/api-tokens", {
            params: { path: { organizationId }, query: page(cursor) },
          }),
        ),
      ),
  });
}

export function organizationSettingsQuery(organizationId: string) {
  return queryOptions({
    queryKey: organizationKeys.settings(organizationId),
    queryFn: () =>
      fetchAllPages((cursor) =>
        request(() =>
          api.GET("/api/v1/organizations/{organizationId}/settings", {
            params: { path: { organizationId }, query: page(cursor) },
          }),
        ),
      ),
  });
}

export type SettingEntry = Awaited<
  ReturnType<NonNullable<ReturnType<typeof organizationSettingsQuery>["queryFn"]>>
>[number];

export function domainsQuery(organizationId: string) {
  return queryOptions({
    queryKey: organizationKeys.domains(organizationId),
    queryFn: () =>
      fetchAllPages((cursor) =>
        request(() =>
          api.GET("/api/v1/organizations/{organizationId}/domains", {
            params: { path: { organizationId }, query: page(cursor) },
          }),
        ),
      ),
  });
}

export function memberPermissionsQuery(organizationId: string, accountId: string) {
  return queryOptions({
    queryKey: organizationKeys.memberPermissions(organizationId, accountId),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/organizations/{organizationId}/members/{accountId}/permissions", {
          params: { path: { organizationId, accountId } },
        }),
      ),
  });
}
