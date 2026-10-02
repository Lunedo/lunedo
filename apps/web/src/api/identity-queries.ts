import { queryOptions } from "@tanstack/react-query";
import { api } from "./client.js";
import type { paths } from "./generated/schema.js";
import { request } from "./request.js";

type ProviderResponse =
  paths["/api/v1/instance/identity-providers/{providerId}"]["get"]["responses"]["200"]["content"]["application/json"];

export type IdentityProvider = ProviderResponse;
export type ProviderConfig = IdentityProvider["config"];
export type ProviderPreset = ProviderConfig["preset"];
export type ProviderCredential = IdentityProvider["credentials"][number];
export type ProviderWarning = IdentityProvider["warnings"][number];

type CreateBody =
  paths["/api/v1/instance/identity-providers"]["post"]["requestBody"]["content"]["application/json"];
export type ProviderConfigInput = CreateBody["config"];
export type CredentialInput = CreateBody["credential"];

export type SignInOptions =
  paths["/api/v1/auth/sign-in-options"]["get"]["responses"]["200"]["content"]["application/json"];
export type SignInProvider = NonNullable<SignInOptions["directProvider"]>;

export type DiscoveredStep =
  paths["/api/v1/auth/sign-in/discover"]["post"]["responses"]["200"]["content"]["application/json"];

export type LinkedIdentity =
  paths["/api/v1/account/identities"]["get"]["responses"]["200"]["content"]["application/json"][number];

export type TestResult =
  paths["/api/v1/instance/identity-providers/{providerId}/test-results/{flowId}"]["get"]["responses"]["200"]["content"]["application/json"];

export type SignInRefusal =
  paths["/api/v1/instance/sign-in-refusals/{reference}"]["get"]["responses"]["200"]["content"]["application/json"];

export type RefusalReason = SignInRefusal["reason"];

export const refusalReasons: readonly RefusalReason[] = [
  "accountCreationDisabled",
  "domainNotAllowed",
  "emailNotVerified",
  "groupRequired",
  "accountInactive",
  "linkDeclined",
  "linkUnavailable",
  "invalidResponse",
];

export function isRefusalReason(value: unknown): value is RefusalReason {
  return refusalReasons.includes(value as RefusalReason);
}

export const identityKeys = {
  providers: ["identityProviders"] as const,
  provider: (providerId: string) => ["identityProviders", providerId] as const,
  signInOptions: ["auth", "signInOptions"] as const,
  ownIdentities: ["account", "identities"] as const,
  accountIdentities: (accountId: string) => ["instance", "accounts", "identities", accountId] as const,
};

export const signInOptionsQuery = queryOptions({
  queryKey: identityKeys.signInOptions,
  queryFn: () => request(() => api.GET("/api/v1/auth/sign-in-options"), { sessionHandling: false }),
});

export function discoverSignIn(email: string) {
  return request(() => api.POST("/api/v1/auth/sign-in/discover", { body: { email } }), {
    sessionHandling: false,
  });
}

export const signInSecurityQuery = queryOptions({
  queryKey: ["instance", "signInSecurity"] as const,
  queryFn: () => request(() => api.GET("/api/v1/instance/sign-in-security")),
  staleTime: Number.POSITIVE_INFINITY,
});

export const providersQuery = queryOptions({
  queryKey: identityKeys.providers,
  queryFn: () => request(() => api.GET("/api/v1/instance/identity-providers")),
});

export function providerQuery(providerId: string) {
  return queryOptions({
    queryKey: identityKeys.provider(providerId),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/instance/identity-providers/{providerId}", { params: { path: { providerId } } }),
      ),
  });
}

export const ownIdentitiesQuery = queryOptions({
  queryKey: identityKeys.ownIdentities,
  queryFn: () => request(() => api.GET("/api/v1/account/identities")),
});

export function accountIdentitiesQuery(accountId: string) {
  return queryOptions({
    queryKey: identityKeys.accountIdentities(accountId),
    queryFn: () =>
      request(() => api.GET("/api/v1/accounts/{accountId}/identities", { params: { path: { accountId } } })),
  });
}

export function createProvider(body: {
  name: string;
  config: ProviderConfigInput;
  credential: CredentialInput;
}) {
  return request(() => api.POST("/api/v1/instance/identity-providers", { body }));
}

export function updateProvider(providerId: string, body: { name?: string; config?: ProviderConfigInput }) {
  return request(() =>
    api.PATCH("/api/v1/instance/identity-providers/{providerId}", { params: { path: { providerId } }, body }),
  );
}

export function deactivateProvider(providerId: string) {
  return request(() =>
    api.POST("/api/v1/instance/identity-providers/{providerId}/deactivate", {
      params: { path: { providerId } },
    }),
  );
}

export function activateProvider(providerId: string) {
  return request(() =>
    api.POST("/api/v1/instance/identity-providers/{providerId}/activate", {
      params: { path: { providerId } },
    }),
  );
}

export function removalPreviewQuery(providerId: string) {
  return queryOptions({
    queryKey: [...identityKeys.provider(providerId), "removalPreview"] as const,
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/instance/identity-providers/{providerId}/removal-preview", {
          params: { path: { providerId } },
        }),
      ),
  });
}

export async function removeProvider(providerId: string): Promise<void> {
  await request(() =>
    api.DELETE("/api/v1/instance/identity-providers/{providerId}", { params: { path: { providerId } } }),
  );
}

export function addCredential(providerId: string, body: CredentialInput) {
  return request(() =>
    api.POST("/api/v1/instance/identity-providers/{providerId}/credentials", {
      params: { path: { providerId } },
      body,
    }),
  );
}

export async function removeCredential(providerId: string, credentialId: string): Promise<void> {
  await request(() =>
    api.DELETE("/api/v1/instance/identity-providers/{providerId}/credentials/{credentialId}", {
      params: { path: { providerId, credentialId } },
    }),
  );
}

export function certificateUrl(providerId: string, credentialId: string): string {
  return `/api/v1/instance/identity-providers/${providerId}/credentials/${credentialId}/certificate`;
}

export function providerLogoUrl(provider: { id: string; logoRef: string | null }): string | null {
  return provider.logoRef ? `/api/v1/identity-providers/${provider.id}/logo?v=${provider.logoRef}` : null;
}

export function uploadProviderLogo(
  providerId: string,
  body: { contentType: "image/png" | "image/jpeg" | "image/webp"; data: string },
) {
  return request(() =>
    api.PUT("/api/v1/instance/identity-providers/{providerId}/logo", {
      params: { path: { providerId } },
      body,
    }),
  );
}

export async function removeProviderLogo(providerId: string): Promise<void> {
  await request(() =>
    api.DELETE("/api/v1/instance/identity-providers/{providerId}/logo", { params: { path: { providerId } } }),
  );
}

export function startProviderTest(providerId: string, returnTo: string) {
  return request(() =>
    api.POST("/api/v1/instance/identity-providers/{providerId}/test", {
      params: { path: { providerId } },
      body: { returnTo },
    }),
  );
}

export function providerTestResultQuery(providerId: string, flowId: string) {
  return queryOptions({
    queryKey: [...identityKeys.provider(providerId), "test", flowId] as const,
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/instance/identity-providers/{providerId}/test-results/{flowId}", {
          params: { path: { providerId, flowId } },
        }),
      ),
    retry: false,
  });
}

export function refusalQuery(reference: string) {
  return queryOptions({
    queryKey: ["signInRefusal", reference] as const,
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/instance/sign-in-refusals/{reference}", { params: { path: { reference } } }),
      ),
    retry: false,
  });
}

const RULES_PATH = "/api/v1/instance/identity-providers/{providerId}/mapping-rules" as const;
const SYNC_RUNS_PATH = "/api/v1/instance/identity-providers/{providerId}/sync-runs" as const;

export type MappingRule =
  paths[typeof RULES_PATH]["get"]["responses"]["200"]["content"]["application/json"][number];
export type MappingRuleInput = paths[typeof RULES_PATH]["post"]["requestBody"]["content"]["application/json"];
export type ProviderGroup =
  paths["/api/v1/instance/identity-providers/{providerId}/groups"]["get"]["responses"]["200"]["content"]["application/json"][number];
export type GroupPreview =
  paths["/api/v1/instance/identity-providers/{providerId}/group-preview"]["get"]["responses"]["200"]["content"]["application/json"];
export type SyncRun =
  paths[typeof SYNC_RUNS_PATH]["get"]["responses"]["200"]["content"]["application/json"]["items"][number];
export type SyncRunDetail =
  paths["/api/v1/instance/identity-providers/{providerId}/sync-runs/{runId}"]["get"]["responses"]["200"]["content"]["application/json"];
export type SyncRunFilter = "all" | "changes" | "failed";

export const mappingKeys = {
  rules: (providerId: string) => [...identityKeys.provider(providerId), "rules"] as const,
  runs: (providerId: string, filter: SyncRunFilter) =>
    [...identityKeys.provider(providerId), "syncRuns", filter] as const,
  run: (providerId: string, runId: string) =>
    [...identityKeys.provider(providerId), "syncRun", runId] as const,
  preview: (providerId: string, groupId: string) =>
    [...identityKeys.provider(providerId), "groupPreview", groupId] as const,
};

export function mappingRulesQuery(providerId: string) {
  return queryOptions({
    queryKey: mappingKeys.rules(providerId),
    queryFn: () => request(() => api.GET(RULES_PATH, { params: { path: { providerId } } })),
  });
}

export function createMappingRule(providerId: string, body: MappingRuleInput) {
  return request(() => api.POST(RULES_PATH, { params: { path: { providerId } }, body }));
}

export function updateMappingRule(providerId: string, ruleId: string, body: MappingRuleInput) {
  return request(() =>
    api.PUT("/api/v1/instance/identity-providers/{providerId}/mapping-rules/{ruleId}", {
      params: { path: { providerId, ruleId } },
      body,
    }),
  );
}

export async function removeMappingRule(providerId: string, ruleId: string): Promise<void> {
  await request(() =>
    api.DELETE("/api/v1/instance/identity-providers/{providerId}/mapping-rules/{ruleId}", {
      params: { path: { providerId, ruleId } },
    }),
  );
}

export async function orderMappingRules(providerId: string, ruleIds: string[]): Promise<void> {
  await request(() =>
    api.PUT("/api/v1/instance/identity-providers/{providerId}/mapping-rule-order", {
      params: { path: { providerId } },
      body: { ruleIds },
    }),
  );
}

export function searchProviderGroups(providerId: string, q: string) {
  return request(() =>
    api.GET("/api/v1/instance/identity-providers/{providerId}/groups", {
      params: { path: { providerId }, query: { q } },
    }),
  );
}

export function groupPreviewQuery(providerId: string, groupId: string) {
  return queryOptions({
    queryKey: mappingKeys.preview(providerId, groupId),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/instance/identity-providers/{providerId}/group-preview", {
          params: { path: { providerId }, query: { group: groupId } },
        }),
      ),
  });
}

export function syncRunsQuery(providerId: string, filter: SyncRunFilter) {
  return queryOptions({
    queryKey: mappingKeys.runs(providerId, filter),
    queryFn: () =>
      request(() =>
        api.GET(SYNC_RUNS_PATH, { params: { path: { providerId }, query: { filter, limit: 50 } } }),
      ),
  });
}

export function syncRunQuery(providerId: string, runId: string) {
  return queryOptions({
    queryKey: mappingKeys.run(providerId, runId),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/instance/identity-providers/{providerId}/sync-runs/{runId}", {
          params: { path: { providerId, runId } },
        }),
      ),
  });
}

export async function cancelSync(providerId: string, runId: string): Promise<void> {
  await request(() =>
    api.POST("/api/v1/instance/identity-providers/{providerId}/sync-runs/{runId}/cancel", {
      params: { path: { providerId, runId } },
    }),
  );
}

export function startSync(providerId: string) {
  return request(() =>
    api.POST("/api/v1/instance/identity-providers/{providerId}/sync", { params: { path: { providerId } } }),
  );
}

export async function setDirectoryKey(providerId: string, key: string): Promise<void> {
  await request(() =>
    api.PUT("/api/v1/instance/identity-providers/{providerId}/directory-key", {
      params: { path: { providerId } },
      body: { key },
    }),
  );
}

export async function removeDirectoryKey(providerId: string): Promise<void> {
  await request(() =>
    api.DELETE("/api/v1/instance/identity-providers/{providerId}/directory-key", {
      params: { path: { providerId } },
    }),
  );
}

export function hasDirectory(provider: IdentityProvider): boolean {
  return provider.capabilities.directorySync;
}
