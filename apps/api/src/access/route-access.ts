import { applyDecorators, SetMetadata } from "@nestjs/common";

export type RouteAccess =
  | { kind: "public" }
  | { kind: "metricsToken" }
  | {
      kind: "session";
      secondFactorSetup: boolean;
      recentAuthentication: boolean;
      portalAccounts?: boolean;
    }
  | { kind: "setupCode" }
  | { kind: "setupSession" }
  | { kind: "apiDocumentation" }
  | { kind: "scimToken"; param: string }
  | {
      kind: "permission";
      action: string;
      alternatives: string[];
      resource: ResourceSource;
      recentAuthentication: boolean;
      sessionOnly: boolean;
      publicForSoleOrganization: boolean;
    };

export type ResourceSource = { type: "instance" } | { type: string; param: string };

export const ROUTE_ACCESS = "pagehall:route-access";

export const INTERNAL_ROUTE = "pagehall:internal-route";

export const PublicRoute = () => SetMetadata(ROUTE_ACCESS, { kind: "public" } satisfies RouteAccess);

export const MetricsTokenRoute = () =>
  SetMetadata(ROUTE_ACCESS, { kind: "metricsToken" } satisfies RouteAccess);

export const SessionRoute = (
  options: { secondFactorSetup?: boolean; recentAuthentication?: boolean; portalAccounts?: boolean } = {},
) =>
  SetMetadata(ROUTE_ACCESS, {
    kind: "session",
    secondFactorSetup: options.secondFactorSetup ?? false,
    recentAuthentication: options.recentAuthentication ?? false,
    portalAccounts: options.portalAccounts ?? false,
  } satisfies RouteAccess);

export const SetupCodeRoute = () => SetMetadata(ROUTE_ACCESS, { kind: "setupCode" } satisfies RouteAccess);

export const SetupSessionRoute = () =>
  SetMetadata(ROUTE_ACCESS, { kind: "setupSession" } satisfies RouteAccess);

export const ScimTokenRoute = (param = "providerId") =>
  SetMetadata(ROUTE_ACCESS, { kind: "scimToken", param } satisfies RouteAccess);

export const ApiDocumentationRoute = () =>
  SetMetadata(ROUTE_ACCESS, { kind: "apiDocumentation" } satisfies RouteAccess);

export const Permission = (
  action: string | [string, ...string[]],
  resource: ResourceSource = { type: "instance" },
  options: {
    recentAuthentication?: boolean;
    sessionOnly?: boolean;
    publicForSoleOrganization?: boolean;
  } = {},
) =>
  SetMetadata(ROUTE_ACCESS, {
    kind: "permission",
    action: typeof action === "string" ? action : action[0],
    alternatives: typeof action === "string" ? [] : action.slice(1),
    resource,
    recentAuthentication: options.recentAuthentication ?? false,
    sessionOnly: options.sessionOnly ?? false,
    publicForSoleOrganization: options.publicForSoleOrganization ?? false,
  } satisfies RouteAccess);

export const InternalRoute = () => applyDecorators(SetMetadata(INTERNAL_ROUTE, true));
