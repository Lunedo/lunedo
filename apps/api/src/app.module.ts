import { type DynamicModule, Global, Module } from "@nestjs/common";
import type { Logger } from "@pagehall/shared/node";
import { API_CONFIG, type ApiConfig } from "./config.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthModule } from "./health/health.module.js";
import { APP_LOGGER } from "./logger.js";

@Global()
@Module({})
export class AppModule {
  static forRoot(config: ApiConfig, logger: Logger): DynamicModule {
    return {
      module: AppModule,
      imports: [DatabaseModule, HealthModule],
      providers: [
        { provide: API_CONFIG, useValue: config },
        { provide: APP_LOGGER, useValue: logger },
      ],
      exports: [API_CONFIG, APP_LOGGER],
    };
  }
}
