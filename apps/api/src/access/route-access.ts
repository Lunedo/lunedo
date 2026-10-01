import { applyDecorators, SetMetadata } from "@nestjs/common";

/**
 * How a route may be accessed. Every route declares exactly one; the global guard rejects
 * routes without a declaration. Permission-based access is added with the authorization
 * service.
 */
export type RouteAccess =
  | { kind: "public" }
  | { kind: "metricsToken" }
  | {
      kind: "session";
      /** Also open to sessions that must set up a second factor first. */
      secondFactorSetup: boolean;
      /** Requires a successful re-authentication within the configured period. */
      recentAuthentication: boolean;
    }
  | { kind: "setupCode" }
  | { kind: "setupSession" };

export const ROUTE_ACCESS = "pagehall:route-access";

/** Marks routes that only the web client uses: excluded from the public API documentation. */
export const INTERNAL_ROUTE = "pagehall:internal-route";

/**
 * Open to everyone: health endpoints and the steps of signing in that come before a session,
 * such as entering a password.
 */
export const PublicRoute = () => SetMetadata(ROUTE_ACCESS, { kind: "public" } satisfies RouteAccess);

/** Requires the metrics bearer token from the configuration. */
export const MetricsTokenRoute = () =>
  SetMetadata(ROUTE_ACCESS, { kind: "metricsToken" } satisfies RouteAccess);

/** Requires a signed-in session. */
export const SessionRoute = (options: { secondFactorSetup?: boolean; recentAuthentication?: boolean } = {}) =>
  SetMetadata(ROUTE_ACCESS, {
    kind: "session",
    secondFactorSetup: options.secondFactorSetup ?? false,
    recentAuthentication: options.recentAuthentication ?? false,
  } satisfies RouteAccess);

/** Open to everyone until setup is complete; afterwards the route answers as if it did not exist. */
export const SetupCodeRoute = () => SetMetadata(ROUTE_ACCESS, { kind: "setupCode" } satisfies RouteAccess);

/** Requires a setup session; after setup the route answers as if it did not exist. */
export const SetupSessionRoute = () =>
  SetMetadata(ROUTE_ACCESS, { kind: "setupSession" } satisfies RouteAccess);

/** Marks a controller or route as internal. */
export const InternalRoute = () => applyDecorators(SetMetadata(INTERNAL_ROUTE, true));
