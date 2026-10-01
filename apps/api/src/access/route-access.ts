import { applyDecorators, SetMetadata } from "@nestjs/common";

/**
 * How a route may be accessed. Every route declares exactly one; the global guard rejects
 * routes without a declaration.
 */
export type RouteAccess =
  | { kind: "public" }
  | { kind: "metricsToken" }
  | {
      kind: "session";
      secondFactorSetup: boolean;
      recentAuthentication: boolean;
    }
  | { kind: "setupCode" }
  | { kind: "setupSession" }
  | {
      kind: "permission";
      action: string;
      resource: ResourceSource;
      recentAuthentication: boolean;
    };

export type ResourceSource = { type: "instance" } | { type: string; param: string };

export const ROUTE_ACCESS = "pagehall:route-access";

export const INTERNAL_ROUTE = "pagehall:internal-route";

export const PublicRoute = () => SetMetadata(ROUTE_ACCESS, { kind: "public" } satisfies RouteAccess);

/** Requires the metrics bearer token from the configuration. */
export const MetricsTokenRoute = () =>
  SetMetadata(ROUTE_ACCESS, { kind: "metricsToken" } satisfies RouteAccess);

export const SessionRoute = (options: { secondFactorSetup?: boolean; recentAuthentication?: boolean } = {}) =>
  SetMetadata(ROUTE_ACCESS, {
    kind: "session",
    secondFactorSetup: options.secondFactorSetup ?? false,
    recentAuthentication: options.recentAuthentication ?? false,
  } satisfies RouteAccess);

export const SetupCodeRoute = () => SetMetadata(ROUTE_ACCESS, { kind: "setupCode" } satisfies RouteAccess);

export const SetupSessionRoute = () =>
  SetMetadata(ROUTE_ACCESS, { kind: "setupSession" } satisfies RouteAccess);

export const Permission = (
  action: string,
  resource: ResourceSource = { type: "instance" },
  options: { recentAuthentication?: boolean } = {},
) =>
  SetMetadata(ROUTE_ACCESS, {
    kind: "permission",
    action,
    resource,
    recentAuthentication: options.recentAuthentication ?? false,
  } satisfies RouteAccess);

export const InternalRoute = () => applyDecorators(SetMetadata(INTERNAL_ROUTE, true));
