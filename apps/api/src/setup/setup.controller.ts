import { Body, Controller, Get, Inject, Param, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { InternalRoute, SetupCodeRoute, SetupSessionRoute } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { COOKIES, clearCookie, readCookie, setCookie } from "../http/cookies.js";

const SETUP_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;
const codeSchema = z.object({ code: z.string().trim().min(1).max(64) }).strict();
const identifier = z.string().regex(/^[a-z][a-zA-Z]{0,63}$/);
const actionParams = z.object({ step: identifier, action: identifier }).strict();
const stepsSchema = z.object({
  steps: z.array(
    z.object({ id: z.string(), required: z.boolean(), completed: z.boolean(), details: z.json() }),
  ),
  ready: z.boolean(),
});

function requestInfo(request: FastifyRequest) {
  return { protocol: request.protocol, host: request.host };
}

@Controller("api/v1/setup")
@InternalRoute()
export class SetupController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #setup() {
    return servicesOf(this.context).setup;
  }

  @Get()
  @SetupCodeRoute()
  @ApiRoute({
    summary: "Get the setup state",
    tags: ["Setup"],
    response: {
      description: "Whether a setup session exists.",
      schema: z.object({ completed: z.boolean(), session: z.boolean() }),
    },
  })
  async state(@Req() request: FastifyRequest) {
    const token = readCookie(request, COOKIES.setup);
    return { completed: false, session: token ? await this.#setup.validSession(token) : false };
  }

  @Post("session")
  @SetupCodeRoute()
  @ApiRoute({
    summary: "Enter the setup code",
    tags: ["Setup"],
    body: codeSchema,
    errors: ["invalidSetupCode", "rateLimited"],
  })
  async startSession(
    @Body() body: z.output<typeof codeSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const token = await this.#setup.exchangeCode(body.code, request.ip, request.headers.origin ?? "");
    setCookie(reply, COOKIES.setup, token, SETUP_COOKIE_MAX_AGE_SECONDS);
  }

  @Get("steps")
  @SetupSessionRoute()
  @ApiRoute({
    summary: "List the setup steps",
    tags: ["Setup"],
    response: { description: "Steps and their state.", schema: stepsSchema },
  })
  async steps(@Req() request: FastifyRequest) {
    return this.#setup.status(requestInfo(request));
  }

  @Post("steps/:step/:action")
  @SetupSessionRoute()
  @ApiRoute({
    summary: "Run a setup action",
    tags: ["Setup"],
    status: 200,
    params: actionParams,
    body: z.json(),
    raw: {
      contentTypes: ["application/json", "text/plain"],
      description: "The result of the action, or a file to download.",
      example: "{}",
    },
    errors: ["unknownSetupAction", "invalidInput", "setupNotReady"],
  })
  async runAction(
    @Param("step") step: string,
    @Param("action") action: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.#setup.runAction(step, action, body ?? {}, requestInfo(request));
    if (result.download) {
      reply
        .header("content-type", result.download.contentType)
        .header("content-disposition", `attachment; filename="${result.download.filename}"`)
        .header("cache-control", "no-store");
      return result.download.content;
    }
    reply.header("cache-control", "no-store");
    return result.body ?? {};
  }

  @Post("complete")
  @SetupSessionRoute()
  @ApiRoute({ summary: "Complete the setup", tags: ["Setup"], errors: ["setupNotReady"] })
  async complete(@Res({ passthrough: true }) reply: FastifyReply) {
    await this.#setup.finish();
    clearCookie(reply, COOKIES.setup);
  }
}
