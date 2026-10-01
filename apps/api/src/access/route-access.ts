import { SetMetadata } from "@nestjs/common";

/**
 * How a route may be accessed. Every route declares exactly one; the global guard rejects
 * routes without a declaration. Permission-based access is added with the authorization
 * service.
 */
export type RouteAccess = { kind: "public" } | { kind: "metricsToken" };

export const ROUTE_ACCESS = "pagehall:route-access";

/** Open to everyone. Only for health endpoints and similar operational routes. */
export const PublicRoute = () => SetMetadata(ROUTE_ACCESS, { kind: "public" } satisfies RouteAccess);

/** Requires the metrics bearer token from the configuration. */
export const MetricsTokenRoute = () =>
  SetMetadata(ROUTE_ACCESS, { kind: "metricsToken" } satisfies RouteAccess);
