import { queryOptions } from "@tanstack/react-query";
import { api } from "./client.js";
import type { paths } from "./generated/schema.js";
import { request } from "./request.js";

type ProviderResponse =
  paths["/api/v1/instance/identity-providers/{providerId}"]["get"]["responses"]["200"]["content"]["application/json"];

export type IdentityProvider = ProviderResponse;
export type ProviderDraft =
  paths["/api/v1/instance/identity-provider-drafts/{draftId}"]["get"]["responses"]["200"]["content"]["application/json"];
export type DraftInput = NonNullable<
  paths["/api/v1/instance/identity-provider-drafts"]["post"]["requestBody"]
>["content"]["application/json"];
export type DraftUpdate = NonNullable<
  paths["/api/v1/instance/identity-provider-drafts/{draftId}"]["patch"]["requestBody"]
>["content"]["application/json"];
export type ProviderType = IdentityProvider["type"];
export type OidcProvider = Extract<IdentityProvider, { type: "oidc" }>;
export type SamlProvider = Extract<IdentityProvider, { type: "saml" }>;
export type LdapProvider = Extract<IdentityProvider, { type: "ldap" }>;
export type ProviderConfig = IdentityProvider["config"];
export type OidcConfig = OidcProvider["config"];
export type SamlConfig = SamlProvider["config"];
export type LdapConfig = LdapProvider["config"];
export type ProviderPreset = ProviderConfig["preset"];
export type ProviderCredential = IdentityProvider["credentials"][number];
export type ProviderWarning = IdentityProvider["warnings"][number];
export type CaCertificate = NonNullable<LdapProvider["ldap"]["caCertificate"]>;

export const providerTypes: readonly ProviderType[] = ["oidc", "saml", "ldap"];

export type CreateProviderBody =
  paths["/api/v1/instance/identity-providers"]["post"]["requestBody"]["content"]["application/json"];
type UpdateBody =
  paths["/api/v1/instance/identity-providers/{providerId}"]["patch"]["requestBody"]["content"]["application/json"];
export type ProviderConfigInput = NonNullable<UpdateBody["config"]>;
export type OidcConfigInput = Extract<CreateProviderBody, { type: "oidc" }>["config"];
export type SamlConfigInput = Extract<CreateProviderBody, { type: "saml" }>["config"];
export type LdapConfigInput = Extract<CreateProviderBody, { type: "ldap" }>["config"];
export type CredentialInput =
  paths["/api/v1/instance/identity-providers/{providerId}/credentials"]["post"]["requestBody"]["content"]["application/json"];

export type DirectoryTestResult =
  paths["/api/v1/instance/identity-providers/{providerId}/directory-test"]["post"]["responses"]["200"]["content"]["application/json"];
export type DirectoryTestStep = DirectoryTestResult["steps"][number];

export type DirectorySignInResult =
  paths["/api/v1/auth/providers/{providerId}/password"]["post"]["responses"]["200"]["content"]["application/json"];

export type SignInOptions =
  paths["/api/v1/auth/sign-in-options"]["get"]["responses"]["200"]["content"]["application/json"];
export type SignInProvider = SignInOptions["providers"][number];

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
  "secondFactorMissing",
  "linkAmbiguous",
];

export function isRefusalReason(value: unknown): value is RefusalReason {
  return refusalReasons.includes(value as RefusalReason);
}

export const identityKeys = {
  providers: ["identityProviders"] as const,
  provider: (providerId: string) => ["identityProviders", providerId] as const,
  drafts: ["identityProviderDrafts"] as const,
  draft: (draftId: string) => ["identityProviderDrafts", draftId] as const,
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

export const draftsQuery = queryOptions({
  queryKey: identityKeys.drafts,
  queryFn: () => request(() => api.GET("/api/v1/instance/identity-provider-drafts")),
});

export function draftQuery(draftId: string) {
  return queryOptions({
    queryKey: identityKeys.draft(draftId),
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/instance/identity-provider-drafts/{draftId}", { params: { path: { draftId } } }),
      ),
  });
}

export function createDraft(body: DraftInput) {
  return request(() => api.POST("/api/v1/instance/identity-provider-drafts", { body }));
}

export function updateDraft(draftId: string, body: DraftUpdate) {
  return request(() =>
    api.PATCH("/api/v1/instance/identity-provider-drafts/{draftId}", { params: { path: { draftId } }, body }),
  );
}

export async function removeDraft(draftId: string): Promise<void> {
  await request(() =>
    api.DELETE("/api/v1/instance/identity-provider-drafts/{draftId}", { params: { path: { draftId } } }),
  );
}

export function completeSetup(providerId: string) {
  return request(() =>
    api.POST("/api/v1/instance/identity-providers/{providerId}/complete-setup", {
      params: { path: { providerId } },
    }),
  );
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

export type ConnectionCheckBody =
  paths["/api/v1/instance/identity-provider-connection-checks"]["post"]["requestBody"]["content"]["application/json"];
export type ConnectionCheckResult = Awaited<ReturnType<typeof checkConnection>>;

export function checkConnection(body: ConnectionCheckBody) {
  return request(() => api.POST("/api/v1/instance/identity-provider-connection-checks", { body }));
}

export function createProvider(body: CreateProviderBody) {
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

export async function chooseCredential(
  providerId: string,
  credentialId: string,
  use: "this" | "newest",
): Promise<IdentityProvider> {
  return request(() =>
    api.PUT("/api/v1/instance/identity-providers/{providerId}/credentials/{credentialId}/use", {
      params: { path: { providerId, credentialId } },
      body: { use },
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

export function confirmSync(providerId: string, runId: string) {
  return request(() =>
    api.POST("/api/v1/instance/identity-providers/{providerId}/sync-runs/{runId}/confirm", {
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

export function uploadSamlMetadata(providerId: string, xml: string) {
  return request(() =>
    api.PUT("/api/v1/instance/identity-providers/{providerId}/saml-metadata", {
      params: { path: { providerId } },
      body: { xml },
    }),
  );
}

export function refreshSamlMetadata(providerId: string) {
  return request(() =>
    api.POST("/api/v1/instance/identity-providers/{providerId}/saml-metadata/refresh", {
      params: { path: { providerId } },
    }),
  );
}

export function setCaCertificate(providerId: string, certificate: string) {
  return request(() =>
    api.PUT("/api/v1/instance/identity-providers/{providerId}/ca-certificate", {
      params: { path: { providerId } },
      body: { certificate },
    }),
  );
}

export function removeCaCertificate(providerId: string) {
  return request(() =>
    api.DELETE("/api/v1/instance/identity-providers/{providerId}/ca-certificate", {
      params: { path: { providerId } },
    }),
  );
}

export function testDirectory(providerId: string, signInName: string | null) {
  return request(() =>
    api.POST("/api/v1/instance/identity-providers/{providerId}/directory-test", {
      params: { path: { providerId } },
      body: { signInName },
    }),
  );
}

export function signInWithDirectory(providerId: string, body: { signInName: string; password: string }) {
  return request(
    () =>
      api.POST("/api/v1/auth/providers/{providerId}/password", {
        params: { path: { providerId } },
        body,
      }),
    { sessionHandling: false },
  );
}

export async function reauthenticateWithDirectory(providerId: string, password: string): Promise<void> {
  await request(() => api.POST("/api/v1/auth/reauthenticate/directory", { body: { providerId, password } }), {
    sessionHandling: false,
  });
}

export function hasDirectory(provider: IdentityProvider): boolean {
  return provider.capabilities.directorySync;
}

export type ScimStatus =
  paths["/api/v1/instance/identity-providers/{providerId}/scim"]["get"]["responses"]["200"]["content"]["application/json"];
export type CreatedScimToken =
  paths["/api/v1/instance/identity-providers/{providerId}/scim/tokens"]["post"]["responses"]["201"]["content"]["application/json"];

export function scimStatusQuery(providerId: string) {
  return queryOptions({
    queryKey: [...identityKeys.provider(providerId), "scim"] as const,
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/instance/identity-providers/{providerId}/scim", {
          params: { path: { providerId } },
        }),
      ),
  });
}

export function createScimToken(providerId: string) {
  return request(() =>
    api.POST("/api/v1/instance/identity-providers/{providerId}/scim/tokens", {
      params: { path: { providerId } },
    }),
  );
}

export function renewScimToken(providerId: string, tokenId: string) {
  return request(() =>
    api.POST("/api/v1/instance/identity-providers/{providerId}/scim/tokens/{tokenId}/renew", {
      params: { path: { providerId, tokenId } },
    }),
  );
}

export async function removeScimToken(providerId: string, tokenId: string): Promise<void> {
  await request(() =>
    api.DELETE("/api/v1/instance/identity-providers/{providerId}/scim/tokens/{tokenId}", {
      params: { path: { providerId, tokenId } },
    }),
  );
}
