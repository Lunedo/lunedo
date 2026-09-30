import type { LoggerService } from "@nestjs/common";
import type { Logger } from "@pagehall/shared/node";

/** Routes NestJS framework logs into the structured application logger. */
export class NestLogger implements LoggerService {
  constructor(private readonly logger: Logger) {}

  log(message: unknown, context?: string) {
    this.logger.info({ context }, String(message));
  }

  error(message: unknown, stack?: string, context?: string) {
    this.logger.error({ context, stack }, String(message));
  }

  warn(message: unknown, context?: string) {
    this.logger.warn({ context }, String(message));
  }

  debug(message: unknown, context?: string) {
    this.logger.debug({ context }, String(message));
  }

  verbose(message: unknown, context?: string) {
    this.logger.trace({ context }, String(message));
  }

  fatal(message: unknown, context?: string) {
    this.logger.fatal({ context }, String(message));
  }
}
