import type {
  AccountServices,
  NotificationHub,
  ServerRuntime,
  SettingsRegistry,
  SettingsService,
} from "@lunedo/server";

export const API_CONTEXT = Symbol("API_CONTEXT");

/** The parts of the server runtime the HTTP layer uses. */
export type ApiContext = Pick<ServerRuntime, "logger" | "metrics" | "metricsToken" | "readiness"> & {
  webRoot: string | undefined;
  trustedProxies: string[];
  configuredInstanceUrl: string | undefined;
  filesUrl: string | undefined;
  services: AccountServices | undefined;
  settings: SettingsService | undefined;
  settingsRegistry: SettingsRegistry | undefined;
  notificationHub: NotificationHub | undefined;
};

export function apiContextOf(runtime: ServerRuntime): ApiContext {
  return {
    logger: runtime.logger,
    metrics: runtime.metrics,
    metricsToken: runtime.metricsToken,
    readiness: runtime.readiness,
    webRoot: runtime.config.paths.webRoot,
    trustedProxies: runtime.config.trustedProxies,
    configuredInstanceUrl: runtime.config.instanceUrl,
    filesUrl: runtime.config.filesUrl,
    services: runtime.services,
    settings: runtime.settings,
    settingsRegistry: runtime.settingsRegistry,
    notificationHub: runtime.notificationHub,
  };
}
