import { Controller, Get, Header, Inject, Res } from "@nestjs/common";
import { type HealthReport, runHealthChecks } from "@pagehall/shared";
import { type DatabasePool, type Logger, pingDatabase } from "@pagehall/shared/node";
import type { FastifyReply } from "fastify";
import { DATABASE_POOL } from "../database/database.module.js";
import { APP_LOGGER } from "../logger.js";

@Controller("health")
export class HealthController {
  constructor(
    @Inject(DATABASE_POOL) private readonly pool: DatabasePool,
    @Inject(APP_LOGGER) private readonly logger: Logger,
  ) {}

  @Get("live")
  @Header("Cache-Control", "no-store")
  live(): HealthReport {
    return { status: "ok", checks: {} };
  }

  @Get("ready")
  @Header("Cache-Control", "no-store")
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<HealthReport> {
    const report = await runHealthChecks(
      { database: () => pingDatabase(this.pool) },
      { onFailure: (check, error) => this.logger.warn({ check, err: error }, "Health check failed") },
    );
    reply.status(report.status === "ok" ? 200 : 503);
    return report;
  }
}
