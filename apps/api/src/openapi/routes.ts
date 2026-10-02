import { RequestMethod, type Type } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import { INTERNAL_ROUTE, ROUTE_ACCESS, type RouteAccess } from "../access/route-access.js";
import { AuditController } from "../audit/audit.controller.js";
import { AccountController } from "../auth/account.controller.js";
import { AuthController } from "../auth/auth.controller.js";
import { DocsController } from "../docs/docs.controller.js";
import { API_ROUTE, type ApiRouteDefinition } from "../http/api-route.js";
import { IdentityProvidersController } from "../identity/identity-providers.controller.js";
import { ProviderAuthController } from "../identity/provider-auth.controller.js";
import { NotificationsController } from "../notifications/notifications.controller.js";
import { AccountsController } from "../organizations/accounts.controller.js";
import { GroupsController } from "../organizations/groups.controller.js";
import { InstanceController } from "../organizations/instance.controller.js";
import { OrganizationsController } from "../organizations/organizations.controller.js";
import { SetupController } from "../setup/setup.controller.js";
import { ServiceAccountsController } from "../tokens/service-accounts.controller.js";
import { TokensController } from "../tokens/tokens.controller.js";

export const apiControllers = (): Type[] => [
  AuthController,
  AccountController,
  SetupController,
  OrganizationsController,
  GroupsController,
  InstanceController,
  AccountsController,
  ServiceAccountsController,
  TokensController,
  AuditController,
  NotificationsController,
  IdentityProvidersController,
  ProviderAuthController,
  DocsController,
];

export interface ApiRouteInfo {
  method: string;
  path: string;
  handler: string;
  controller: string;
  access: RouteAccess | undefined;
  internal: boolean;
  definition: ApiRouteDefinition | undefined;
}

export function joinPath(...parts: unknown[]): string {
  const segments = parts
    .flatMap((part) => (Array.isArray(part) ? part : [part]))
    .filter((part): part is string => typeof part === "string")
    .flatMap((part) => part.split("/"))
    .filter(Boolean);
  return `/${segments.join("/")}`;
}

function metadata<T>(key: string, ...targets: object[]): T | undefined {
  for (const target of targets) {
    const value = Reflect.getMetadata(key, target) as T | undefined;
    if (value !== undefined) return value;
  }
  return undefined;
}

export function routesOf(controller: Type): ApiRouteInfo[] {
  const prototype = controller.prototype as Record<string, unknown>;
  const routes: ApiRouteInfo[] = [];
  for (const name of Object.getOwnPropertyNames(prototype)) {
    const handler = prototype[name];
    if (name === "constructor" || typeof handler !== "function") continue;
    const path: unknown = Reflect.getMetadata(PATH_METADATA, handler);
    if (path === undefined) continue;
    const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod] ?? "GET";
    routes.push({
      method,
      path: joinPath(Reflect.getMetadata(PATH_METADATA, controller), path),
      handler: name,
      controller: controller.name,
      access: metadata<RouteAccess>(ROUTE_ACCESS, handler, controller),
      internal: metadata<boolean>(INTERNAL_ROUTE, handler, controller) ?? false,
      definition: metadata<ApiRouteDefinition>(API_ROUTE, handler),
    });
  }
  return routes;
}

export function apiRoutes(): ApiRouteInfo[] {
  return apiControllers().flatMap(routesOf);
}
