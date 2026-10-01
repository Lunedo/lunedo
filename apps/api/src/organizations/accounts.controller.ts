import { Body, Controller, HttpCode, Inject, Param, Post, Req } from "@nestjs/common";
import { accountPrincipal } from "@pagehall/server";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { InternalRoute, Permission, PublicRoute } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { sessionOf } from "../http/request.js";
import { ZodPipe } from "../http/zod.pipe.js";

const acceptSchema = z
  .object({
    token: z.string().max(128),
    name: z.string().trim().min(1).max(200).optional(),
    password: z.string().min(1).max(256).optional(),
  })
  .strict();
const registrationSchema = z.object({ email: z.string().trim().min(1).max(254) }).strict();
const completeSchema = z
  .object({
    token: z.string().max(128),
    name: z.string().trim().min(1).max(200),
    password: z.string().min(1).max(256),
  })
  .strict();

@Controller("api/v1")
@InternalRoute()
export class AccountsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Post("accounts/:accountId/deactivate")
  @Permission("account.deactivate", { type: "account", param: "accountId" }, { recentAuthentication: true })
  @HttpCode(200)
  async deactivate(
    @Param("accountId", new ZodPipe(z.uuid())) accountId: string,
    @Req() request: FastifyRequest,
  ) {
    const endedSessions = await this.#services.memberships.deactivate(
      accountPrincipal(sessionOf(request).accountId),
      accountId,
    );
    return { endedSessions };
  }

  @Post("invitations/accept")
  @PublicRoute()
  @HttpCode(200)
  async accept(
    @Body(new ZodPipe(acceptSchema)) body: z.output<typeof acceptSchema>,
    @Req() request: FastifyRequest,
  ) {
    const { token, ...details } = body;
    return this.#services.invitations.accept(token, details, request.ip);
  }

  @Post("registrations")
  @PublicRoute()
  @HttpCode(202)
  async register(
    @Body(new ZodPipe(registrationSchema)) body: z.output<typeof registrationSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.invitations.requestRegistration(body.email, request.ip);
  }

  @Post("registrations/complete")
  @PublicRoute()
  @HttpCode(200)
  async complete(
    @Body(new ZodPipe(completeSchema)) body: z.output<typeof completeSchema>,
    @Req() request: FastifyRequest,
  ) {
    const { token, ...details } = body;
    return this.#services.invitations.completeRegistration(token, details, request.ip);
  }
}
