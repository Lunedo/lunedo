import { api } from "../api/client.js";
import { request } from "../api/request.js";

export function navigateTo(url: string): void {
  globalThis.location.assign(url);
}

export async function startProviderSignIn(
  providerId: string,
  options: { returnTo?: string | null } = {},
): Promise<void> {
  const { url } = await request(
    () =>
      api.POST("/api/v1/auth/providers/{providerId}/start", {
        params: { path: { providerId } },
        body: options.returnTo ? { returnTo: options.returnTo } : {},
      }),
    { sessionHandling: false },
  );
  navigateTo(url);
}

export async function startProviderReauthentication(providerId: string, returnTo: string): Promise<void> {
  const { url } = await request(
    () => api.POST("/api/v1/auth/reauthenticate/provider", { body: { providerId, returnTo } }),
    { sessionHandling: false },
  );
  navigateTo(url);
}
