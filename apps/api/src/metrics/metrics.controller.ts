import { Controller, Get, Header, Inject, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { MetricsTokenRoute } from "../access/route-access.js";
import { API_CONTEXT, type ApiContext } from "../context.js";

@Controller("metrics")
export class MetricsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  @Get()
  @MetricsTokenRoute()
  @Header("Cache-Control", "no-store")
  async metrics(@Res({ passthrough: true }) reply: FastifyReply): Promise<string> {
    reply.type(this.context.metrics.contentType());
    return this.context.metrics.render();
  }
}
