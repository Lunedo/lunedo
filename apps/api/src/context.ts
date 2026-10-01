import type { ServerRuntime } from "@pagehall/server";

export const API_CONTEXT = Symbol("API_CONTEXT");

/** The parts of the server runtime the HTTP layer uses. */
export type ApiContext = Pick<ServerRuntime, "logger" | "metrics" | "metricsToken" | "readiness"> & {
  webRoot: string | undefined;
};

export function apiContextOf(runtime: ServerRuntime): ApiContext {
  return {
    logger: runtime.logger,
    metrics: runtime.metrics,
    metricsToken: runtime.metricsToken,
    readiness: runtime.readiness,
    webRoot: runtime.config.paths.webRoot,
  };
}
