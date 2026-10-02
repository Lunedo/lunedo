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
