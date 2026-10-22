import { type HealthReport, runHealthChecks } from "@lunedo/shared";
import { Controller, Get, Header, Inject, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { PublicRoute } from "../access/route-access.js";
import { API_CONTEXT, type ApiContext } from "../context.js";

@Controller("health")
export class HealthController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  @Get("live")
  @PublicRoute()
  @Header("Cache-Control", "no-store")
  live(): HealthReport {
    return { status: "ok", checks: {} };
  }

  @Get("ready")
  @PublicRoute()
  @Header("Cache-Control", "no-store")
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<HealthReport> {
    const report = await runHealthChecks(this.context.readiness, {
      onFailure: (check, error) => this.context.logger.warn({ check, err: error }, "Health check failed"),
    });
    reply.status(report.status === "ok" ? 200 : 503);
    return report;
  }
}
