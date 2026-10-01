import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { InternalRoute, SetupCodeRoute, SetupSessionRoute } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { COOKIES, clearCookie, readCookie, setCookie } from "../http/cookies.js";
import { ZodPipe } from "../http/zod.pipe.js";

const SETUP_COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;
const codeSchema = z.object({ code: z.string().trim().min(1).max(64) }).strict();
const identifier = z.string().regex(/^[a-z][a-zA-Z]{0,63}$/);

function requestInfo(request: FastifyRequest) {
  return { protocol: request.protocol, host: request.host };
}

/** The setup assistant (ADR 0021). After setup, every route answers as if it did not exist. */
@Controller("api/v1/setup")
@InternalRoute()
export class SetupController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #setup() {
    return servicesOf(this.context).setup;
  }

  @Get()
  @SetupCodeRoute()
  async state(@Req() request: FastifyRequest) {
    const token = readCookie(request, COOKIES.setup);
    return { completed: false, session: token ? await this.#setup.validSession(token) : false };
  }

  @Post("session")
  @SetupCodeRoute()
  @HttpCode(204)
  async startSession(
    @Body(new ZodPipe(codeSchema)) body: z.output<typeof codeSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const token = await this.#setup.exchangeCode(body.code, request.ip);
    setCookie(reply, COOKIES.setup, token, SETUP_COOKIE_MAX_AGE_SECONDS);
  }

  @Get("steps")
  @SetupSessionRoute()
  async steps(@Req() request: FastifyRequest) {
    return this.#setup.status(requestInfo(request));
  }

  @Post("steps/:step/:action")
  @SetupSessionRoute()
  @HttpCode(200)
  async runAction(
    @Param("step", new ZodPipe(identifier)) step: string,
    @Param("action", new ZodPipe(identifier)) action: string,
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
  @HttpCode(204)
  async complete(@Res({ passthrough: true }) reply: FastifyReply) {
    await this.#setup.finish();
    clearCookie(reply, COOKIES.setup);
  }
}
