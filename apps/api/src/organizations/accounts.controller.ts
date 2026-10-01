import { Body, Controller, Inject, Param, Post, Req } from "@nestjs/common";
import { accountNameSchema, linkTokenSchema, passwordSchema, signInEmailSchema } from "@pagehall/shared";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { InternalRoute, Permission, PublicRoute } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { actorOf } from "../http/request.js";

const acceptSchema = z
  .object({
    token: linkTokenSchema,
    name: accountNameSchema.optional(),
    password: passwordSchema.optional(),
  })
  .strict();
const registrationSchema = z.object({ email: signInEmailSchema }).strict();
const completeSchema = z
  .object({
    token: linkTokenSchema,
    name: accountNameSchema,
    password: passwordSchema,
  })
  .strict();
const joinedSchema = z.object({ accountId: z.uuid(), organizationId: z.uuid() });

@Controller("api/v1")
@InternalRoute()
export class AccountsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Post("accounts/:accountId/deactivate")
  @Permission("account.deactivate", { type: "account", param: "accountId" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "Deactivate an account",
    tags: ["Accounts"],
    status: 200,
    params: z.object({ accountId: z.uuid() }).strict(),
    response: { description: "Sessions that ended.", schema: z.object({ endedSessions: z.number().int() }) },
    errors: ["deactivateSelf", "instanceOwner", "lastOwner"],
  })
  async deactivate(@Param("accountId") accountId: string, @Req() request: FastifyRequest) {
    const endedSessions = await this.#services.memberships.deactivate(actorOf(request), accountId);
    return { endedSessions };
  }

  @Post("invitations/accept")
  @PublicRoute()
  @ApiRoute({
    summary: "Accept an invitation",
    tags: ["Accounts"],
    status: 200,
    body: acceptSchema,
    response: {
      description: "The joined organization.",
      schema: joinedSchema.extend({ accountCreated: z.boolean() }),
    },
    errors: ["invalidToken", "invalidInvitation", "accountDetailsRequired", "passwordPolicy", "rateLimited"],
  })
  async accept(@Body() body: z.output<typeof acceptSchema>, @Req() request: FastifyRequest) {
    const { token, ...details } = body;
    return this.#services.invitations.accept(token, details, request.ip);
  }

  @Post("registrations")
  @PublicRoute()
  @ApiRoute({
    summary: "Request a registration",
    tags: ["Accounts"],
    status: 202,
    body: registrationSchema,
    errors: ["rateLimited"],
  })
  async register(@Body() body: z.output<typeof registrationSchema>, @Req() request: FastifyRequest) {
    await this.#services.invitations.requestRegistration(body.email, request.ip);
  }

  @Post("registrations/complete")
  @PublicRoute()
  @ApiRoute({
    summary: "Complete a registration",
    tags: ["Accounts"],
    status: 200,
    body: completeSchema,
    response: { description: "The new account and its organization.", schema: joinedSchema },
    errors: ["invalidToken", "passwordPolicy", "emailInUse", "rateLimited"],
  })
  async complete(@Body() body: z.output<typeof completeSchema>, @Req() request: FastifyRequest) {
    const { token, ...details } = body;
    return this.#services.invitations.completeRegistration(token, details, request.ip);
  }
}
