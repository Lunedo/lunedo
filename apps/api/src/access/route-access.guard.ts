import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  type AccountServices,
  accountPrincipal,
  currentRequestContext,
  isAuthorizedMetricsRequest,
  type Principal,
  type Resource,
  SetupNotFoundError,
} from "@pagehall/server";
import type { FastifyReply, FastifyRequest } from "fastify";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { COOKIES, readCookie } from "../http/cookies.js";
import { ROUTE_ACCESS, type RouteAccess } from "./route-access.js";

function denied(status: 401 | 403, code: string, message: string): HttpException {
  const body = { statusCode: status, code, message };
  return status === 401 ? new UnauthorizedException(body) : new ForbiddenException(body);
}

@Injectable()
export class RouteAccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(API_CONTEXT) private readonly context: ApiContext,
  ) {}

  async canActivate(execution: ExecutionContext): Promise<boolean> {
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
    const request = execution.switchToHttp().getRequest<FastifyRequest>();
    switch (access.kind) {
      case "public":
        return true;
      case "metricsToken": {
        if (isAuthorizedMetricsRequest(request.headers.authorization, this.context.metricsToken.reveal())) {
          return true;
        }
        execution.switchToHttp().getResponse<FastifyReply>().header("www-authenticate", "Bearer");
        throw new UnauthorizedException();
      }
      case "session":
        return this.#session(request, this.#services(), access);
      case "permission":
        return this.#permission(request, this.#services(), access);
      case "setupCode": {
        if (await this.#services().setup.isComplete()) throw new SetupNotFoundError();
        return true;
      }
      case "setupSession": {
        const services = this.#services();
        if (await services.setup.isComplete()) throw new SetupNotFoundError();
        const token = readCookie(request, COOKIES.setup);
        if (!token || !(await services.setup.validSession(token))) {
          if (await services.setup.isComplete()) throw new SetupNotFoundError();
          throw denied(401, "setupSessionRequired", "Enter the setup code first");
        }
        return true;
      }
    }
  }

  #services(): AccountServices {
    if (!this.context.services) throw new ForbiddenException();
    return this.context.services;
  }

  async #permission(
    request: FastifyRequest,
    services: AccountServices,
    access: Extract<RouteAccess, { kind: "permission" }>,
  ): Promise<boolean> {
    await this.#session(request, services, {
      kind: "session",
      secondFactorSetup: false,
      recentAuthentication: access.recentAuthentication,
    });
    const session = request.pagehallSession;
    if (!session) throw denied(401, "notSignedIn", "Sign in first");
    const principal = accountPrincipal(session.accountId);
    const params = (request.params ?? {}) as Record<string, string | undefined>;
    const resource: Resource =
      "param" in access.resource
        ? { type: access.resource.type, id: params[access.resource.param] ?? "" }
        : { type: access.resource.type };
    const decision = await services.authorization.decide(principal, access.action, resource);
    if (decision.allowed) return true;
    if (resource.type !== "instance" && (await this.#hidden(services, principal, resource))) {
      throw new NotFoundException({ statusCode: 404, code: "notFound", message: "Not found" });
    }
    throw new ForbiddenException({
      statusCode: 403,
      code: "forbidden",
      message: "Not allowed",
      denials: decision.denials,
    });
  }

  async #hidden(services: AccountServices, principal: Principal, resource: Resource): Promise<boolean> {
    if (resource.type === "organization") {
      return !(await services.authorization.authorize(principal, "organization.view", resource));
    }
    if (resource.type === "group") {
      const group = resource.id ? await services.groups.get(resource.id).catch(() => null) : null;
      if (!group) return true;
      return !(await services.authorization.authorize(principal, "organization.view", {
        type: "organization",
        id: group.organizationId,
      }));
    }
    if (resource.type === "account") return false;
    return true;
  }

  async #session(
    request: FastifyRequest,
    services: AccountServices,
    access: Extract<RouteAccess, { kind: "session" }>,
  ): Promise<boolean> {
    const token = readCookie(request, COOKIES.session);
    const session = token ? await services.sessions.resolve(token) : null;
    if (!session) throw denied(401, "notSignedIn", "Sign in first");
    request.pagehallSession = session;
    const context = currentRequestContext();
    if (context) context.actor = accountPrincipal(session.accountId);
    if (session.kind === "secondFactorSetup" && !access.secondFactorSetup) {
      throw denied(403, "secondFactorSetupRequired", "Set up a second factor first");
    }
    if (access.recentAuthentication && !(await services.sessions.isRecentlyAuthenticated(session))) {
      throw denied(403, "reauthenticationRequired", "Confirm your identity first");
    }
    return true;
  }
}
