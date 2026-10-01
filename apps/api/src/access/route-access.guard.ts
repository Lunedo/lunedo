import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { isAuthorizedMetricsRequest } from "@pagehall/server";
import type { FastifyReply, FastifyRequest } from "fastify";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ROUTE_ACCESS, type RouteAccess } from "./route-access.js";

@Injectable()
export class RouteAccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(API_CONTEXT) private readonly context: ApiContext,
  ) {}

  canActivate(execution: ExecutionContext): boolean {
    const access = this.reflector.getAllAndOverride<RouteAccess | undefined>(ROUTE_ACCESS, [
      execution.getHandler(),
      execution.getClass(),
    ]);
    if (!access) {
      this.context.logger.error(
        { handler: `${execution.getClass().name}.${execution.getHandler().name}` },
        "Route has no access declaration",
      );
      throw new ForbiddenException();
    }
    switch (access.kind) {
      case "public":
        return true;
      case "metricsToken": {
        const request = execution.switchToHttp().getRequest<FastifyRequest>();
        if (isAuthorizedMetricsRequest(request.headers.authorization, this.context.metricsToken.reveal())) {
          return true;
        }
        execution.switchToHttp().getResponse<FastifyReply>().header("www-authenticate", "Bearer");
        throw new UnauthorizedException();
      }
    }
  }
}
