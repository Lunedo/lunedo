import { readServiceConfig, type ServiceConfig } from "@pagehall/shared/node";

export interface ApiConfig extends ServiceConfig {
  /** Directory with the built web client. The API serves it when set. */
  webRoot: string | undefined;
}

export const API_CONFIG = Symbol("API_CONFIG");

export function readApiConfig(env: Record<string, string | undefined>): ApiConfig {
  return {
    ...readServiceConfig(env, "PAGEHALL_API_PORT", 3000),
    webRoot: env.PAGEHALL_WEB_ROOT?.trim() || undefined,
  };
}
