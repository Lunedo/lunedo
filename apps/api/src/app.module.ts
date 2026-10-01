import { type DynamicModule, Global, Module } from "@nestjs/common";
import { APP_GUARD, DiscoveryModule } from "@nestjs/core";
import { RouteAccessGuard } from "./access/route-access.guard.js";
import { RouteAccessVerifier } from "./access/route-access.verifier.js";
import { API_CONTEXT, type ApiContext } from "./context.js";
import { HealthModule } from "./health/health.module.js";
import { MetricsController } from "./metrics/metrics.controller.js";

@Global()
@Module({})
export class AppModule {
  static forRoot(context: ApiContext): DynamicModule {
    return {
      module: AppModule,
      imports: [DiscoveryModule, HealthModule],
      controllers: [MetricsController],
      providers: [
        { provide: API_CONTEXT, useValue: context },
        { provide: APP_GUARD, useClass: RouteAccessGuard },
        RouteAccessVerifier,
      ],
      exports: [API_CONTEXT],
    };
  }
}
