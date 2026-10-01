import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  type AccountServices,
  accountPrincipal,
  currentRequestContext,
  isAuthorizedMetricsRequest,
  type Principal,
  publicApiDocumentationSetting,
  type Resource,
  SetupNotFoundError,
  TokenRejectedError,
} from "@pagehall/server";
import type { FastifyReply, FastifyRequest } from "fastify";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { COOKIES, readCookie } from "../http/cookies.js";
import { ProblemException } from "../http/problems.js";
import { bearerToken } from "../http/request.js";
import { ROUTE_ACCESS, type RouteAccess } from "./route-access.js";

type AccountPrincipal = Extract<Principal, { type: "account" }>;

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
      throw new ProblemException("forbidden");
    }
    const request = execution.switchToHttp().getRequest<FastifyRequest>();
    const reply = execution.switchToHttp().getResponse<FastifyReply>();
    switch (access.kind) {
      case "public":
        return true;
      case "metricsToken": {
        if (isAuthorizedMetricsRequest(request.headers.authorization, this.context.metricsToken.reveal())) {
          return true;
        }
        reply.header("www-authenticate", "Bearer");
        throw new ProblemException("notSignedIn");
      }
      case "session":
        await this.#session(request, this.#services(), access);
        return true;
      case "permission":
        return this.#permission(request, reply, this.#services(), access);
      case "apiDocumentation":
        return this.#documentation(request, reply);
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
          throw new ProblemException("setupSessionRequired", "Enter the setup code first");
        }
        return true;
      }
    }
  }

  #services(): AccountServices {
    if (!this.context.services) throw new ProblemException("forbidden");
    return this.context.services;
  }

  #setActor(request: FastifyRequest, principal: AccountPrincipal): void {
    request.pagehallPrincipal = principal;
    const context = currentRequestContext();
    if (context) context.actor = principal;
  }

  async #token(
    request: FastifyRequest,
    reply: FastifyReply,
    services: AccountServices,
    token: string,
  ): Promise<AccountPrincipal> {
    try {
      const authenticated = await services.apiTokens.authenticate(token, request.ip);
      const principal: AccountPrincipal = {
        type: "account",
        id: authenticated.accountId,
        token: authenticated.grant,
      };
      this.#setActor(request, principal);
      return principal;
    } catch (error) {
      if (error instanceof TokenRejectedError)
        reply.header("www-authenticate", 'Bearer error="invalid_token"');
      throw error;
    }
  }

  async #documentation(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
    const settings = this.context.settings;
    if (settings && (await settings.get(publicApiDocumentationSetting, {}))) return true;
    const services = this.#services();
    const token = bearerToken(request);
    if (token !== undefined) {
      await this.#token(request, reply, services, token);
      return true;
    }
    await this.#session(request, services, {
      kind: "session",
      secondFactorSetup: false,
      recentAuthentication: false,
    });
    return true;
  }

  async #permission(
    request: FastifyRequest,
    reply: FastifyReply,
    services: AccountServices,
    access: Extract<RouteAccess, { kind: "permission" }>,
  ): Promise<boolean> {
    const token = bearerToken(request);
    let principal: AccountPrincipal;
    if (token !== undefined) {
      if (access.sessionOnly || access.recentAuthentication) {
        throw new ProblemException("sessionRequired", "API tokens cannot use this endpoint");
      }
      principal = await this.#token(request, reply, services, token);
    } else {
      principal = await this.#session(request, services, {
        kind: "session",
        secondFactorSetup: false,
        recentAuthentication: access.recentAuthentication,
      });
    }
    const params = (request.params ?? {}) as Record<string, string | undefined>;
    const resource: Resource =
      "param" in access.resource
        ? { type: access.resource.type, id: params[access.resource.param] ?? "" }
        : { type: access.resource.type };
    const decision = await services.authorization.decide(principal, access.action, resource);
    if (decision.allowed) return true;
    if (resource.type !== "instance" && (await this.#hidden(services, principal, resource))) {
      throw new ProblemException("notFound");
    }
    throw new ProblemException("forbidden", "Not allowed", { denials: decision.denials });
  }

  async #hidden(services: AccountServices, principal: Principal, resource: Resource): Promise<boolean> {
    if (resource.type === "organization") {
      return !(await services.authorization.authorize(principal, "organization.view", resource));
    }
    const organizationId = await this.#organizationOf(services, resource);
    if (!organizationId) return resource.type !== "account";
    return !(await services.authorization.authorize(principal, "organization.view", {
      type: "organization",
      id: organizationId,
    }));
  }

  async #organizationOf(services: AccountServices, resource: Resource): Promise<string | null> {
    if (!resource.id) return null;
    if (resource.type === "group") {
      const group = await services.groups.get(resource.id).catch(() => null);
      return group?.organizationId ?? null;
    }
    if (resource.type === "serviceAccount") {
      return services.serviceAccounts.organizationOf(resource.id).catch(() => null);
    }
    return null;
  }

  async #session(
    request: FastifyRequest,
    services: AccountServices,
    access: Extract<RouteAccess, { kind: "session" }>,
  ): Promise<AccountPrincipal> {
    if (bearerToken(request) !== undefined) {
      throw new ProblemException("sessionRequired", "API tokens cannot use this endpoint");
    }
    const token = readCookie(request, COOKIES.session);
    const session = token ? await services.sessions.resolve(token) : null;
    if (!session) throw new ProblemException("notSignedIn", "Sign in first");
    request.pagehallSession = session;
    const principal = accountPrincipal(session.accountId);
    this.#setActor(request, principal);
    if (session.kind === "secondFactorSetup" && !access.secondFactorSetup) {
      throw new ProblemException("secondFactorSetupRequired", "Set up a second factor first");
    }
    if (access.recentAuthentication && !(await services.sessions.isRecentlyAuthenticated(session))) {
      throw new ProblemException("reauthenticationRequired", "Confirm your identity first");
    }
    return principal;
  }
}
