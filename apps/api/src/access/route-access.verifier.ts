import { Inject, Injectable, type OnApplicationBootstrap, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import { DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import { API_ROUTE, type ApiRouteDefinition } from "../http/api-route.js";
import { joinPath } from "../openapi/routes.js";
import { ROUTE_ACCESS, type RouteAccess } from "./route-access.js";

export interface RegisteredRoute {
  route: string;
  path: string;
  controller: string;
  access: RouteAccess | undefined;
  definition: ApiRouteDefinition | undefined;
}

export function registeredRoutes(
  discovery: DiscoveryService,
  scanner: MetadataScanner,
  reflector: Reflector,
): RegisteredRoute[] {
  const routes: RegisteredRoute[] = [];
  for (const wrapper of discovery.getControllers()) {
    const { instance, metatype } = wrapper;
    if (!instance || !metatype) continue;
    const prototype = Object.getPrototypeOf(instance) as Record<string, unknown>;
    const controllerPath: unknown = Reflect.getMetadata(PATH_METADATA, metatype);
    for (const name of scanner.getAllMethodNames(prototype)) {
      const handler = prototype[name];
      if (typeof handler !== "function") continue;
      const path: unknown = Reflect.getMetadata(PATH_METADATA, handler);
      if (path === undefined) continue;
      const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod] ?? "GET";
      const fullPath = joinPath(controllerPath, path);
      routes.push({
        route: `${method} ${fullPath} (${metatype.name}.${name})`,
        path: fullPath,
        controller: metatype.name,
        access: reflector.getAllAndOverride<RouteAccess | undefined>(ROUTE_ACCESS, [handler, metatype]),
        definition: reflector.get<ApiRouteDefinition | undefined>(API_ROUTE, handler),
      });
    }
  }
  return routes;
}

@Injectable()
export class RouteAccessVerifier implements OnApplicationBootstrap {
  constructor(
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(MetadataScanner) private readonly scanner: MetadataScanner,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  onApplicationBootstrap(): void {
    const routes = registeredRoutes(this.discovery, this.scanner, this.reflector);
    const undeclared = routes.filter((route) => route.access === undefined);
    if (undeclared.length > 0) {
      throw new Error(
        `Routes without an access declaration: ${undeclared.map((route) => route.route).join(", ")}`,
      );
    }
    const undescribed = routes.filter((route) => route.path.startsWith("/api/") && !route.definition);
    if (undescribed.length > 0) {
      throw new Error(
        `API routes without a route declaration: ${undescribed.map((route) => route.route).join(", ")}`,
      );
    }
  }
}
