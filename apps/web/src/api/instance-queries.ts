import { queryOptions } from "@tanstack/react-query";
import { api } from "./client.js";
import { fetchAllPages } from "./queries.js";
import { request } from "./request.js";

const page = (cursor: string | undefined) => ({ limit: 200, ...(cursor ? { cursor } : {}) });

export const instanceKeys = {
  organizations: ["instance", "organizations"] as const,
  accounts: ["instance", "accounts"] as const,
  roles: ["instance", "roles"] as const,
  assignments: ["instance", "assignments"] as const,
  settings: ["instance", "settings"] as const,
  mail: ["instance", "mail"] as const,
  breakGlass: ["instance", "breakGlass"] as const,
  address: ["instance", "address"] as const,
};

export const instanceAddressQuery = queryOptions({
  queryKey: instanceKeys.address,
  queryFn: () => request(() => api.GET("/api/v1/instance/address")),
});

export const instanceOrganizationsQuery = queryOptions({
  queryKey: instanceKeys.organizations,
  queryFn: () =>
    fetchAllPages((cursor) =>
      request(() => api.GET("/api/v1/instance/organizations", { params: { query: page(cursor) } })),
    ),
});

export const instanceAccountsQuery = queryOptions({
  queryKey: instanceKeys.accounts,
  queryFn: () =>
    fetchAllPages((cursor) =>
      request(() => api.GET("/api/v1/instance/accounts", { params: { query: page(cursor) } })),
    ),
});

export type InstanceAccount = Awaited<
  ReturnType<NonNullable<(typeof instanceAccountsQuery)["queryFn"]>>
>[number];

export const instanceRolesQuery = queryOptions({
  queryKey: instanceKeys.roles,
  queryFn: () =>
    fetchAllPages((cursor) =>
      request(() => api.GET("/api/v1/instance/roles", { params: { query: page(cursor) } })),
    ),
});

export const instanceAssignmentsQuery = queryOptions({
  queryKey: instanceKeys.assignments,
  queryFn: () =>
    fetchAllPages((cursor) =>
      request(() => api.GET("/api/v1/instance/role-assignments", { params: { query: page(cursor) } })),
    ),
});

export const instanceSettingsQuery = queryOptions({
  queryKey: instanceKeys.settings,
  queryFn: () =>
    fetchAllPages((cursor) =>
      request(() => api.GET("/api/v1/instance/settings", { params: { query: page(cursor) } })),
    ),
});

export const mailQuery = queryOptions({
  queryKey: instanceKeys.mail,
  queryFn: () => request(() => api.GET("/api/v1/instance/mail")),
});

export const breakGlassQuery = queryOptions({
  queryKey: instanceKeys.breakGlass,
  queryFn: () =>
    fetchAllPages((cursor) =>
      request(() => api.GET("/api/v1/instance/break-glass", { params: { query: page(cursor) } })),
    ),
});
