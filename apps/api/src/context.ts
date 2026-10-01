import type { AccountServices, ServerRuntime, SettingsService } from "@pagehall/server";

export const API_CONTEXT = Symbol("API_CONTEXT");

/** The parts of the server runtime the HTTP layer uses. */
export type ApiContext = Pick<ServerRuntime, "logger" | "metrics" | "metricsToken" | "readiness"> & {
  webRoot: string | undefined;
  /** Proxies whose forwarding headers are trusted for the client address and protocol. */
  trustedProxies: string[];
  /** Accounts, sign-in and setup; without them only the operational routes exist. */
  services: AccountServices | undefined;
  settings: SettingsService | undefined;
};

export function apiContextOf(runtime: ServerRuntime): ApiContext {
  return {
    logger: runtime.logger,
    metrics: runtime.metrics,
    metricsToken: runtime.metricsToken,
    readiness: runtime.readiness,
    webRoot: runtime.config.paths.webRoot,
    trustedProxies: runtime.config.trustedProxies,
    services: runtime.services,
    settings: runtime.settings,
  };
}
