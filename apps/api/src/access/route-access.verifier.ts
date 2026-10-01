import { Inject, Injectable, type OnApplicationBootstrap, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import { DiscoveryService, MetadataScanner, Reflector } from "@nestjs/core";
import { ROUTE_ACCESS, type RouteAccess } from "./route-access.js";

export interface RegisteredRoute {
  /** e.g. `GET /health/ready (HealthController.ready)` */
  route: string;
  access: RouteAccess | undefined;
}

function joinPath(...parts: unknown[]): string {
  const segments = parts
    .flatMap((part) => (Array.isArray(part) ? part : [part]))
    .filter((part): part is string => typeof part === "string")
    .flatMap((part) => part.split("/"))
    .filter(Boolean);
  return `/${segments.join("/")}`;
}

/** All routes of the controllers registered in the application, with their access declaration. */
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
      routes.push({
        route: `${method} ${joinPath(controllerPath, path)} (${metatype.name}.${name})`,
        access: reflector.getAllAndOverride<RouteAccess | undefined>(ROUTE_ACCESS, [handler, metatype]),
      });
    }
  }
  return routes;
}

/**
 * Refuses to start the API when a route has no access declaration. The global guard
 * rejects such routes as well; this check makes the mistake visible before deployment.
 */
@Injectable()
export class RouteAccessVerifier implements OnApplicationBootstrap {
  constructor(
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(MetadataScanner) private readonly scanner: MetadataScanner,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  onApplicationBootstrap(): void {
    const undeclared = registeredRoutes(this.discovery, this.scanner, this.reflector).filter(
      (route) => route.access === undefined,
    );
    if (undeclared.length > 0) {
      throw new Error(
        `Routes without an access declaration: ${undeclared.map((route) => route.route).join(", ")}`,
      );
    }
  }
}
