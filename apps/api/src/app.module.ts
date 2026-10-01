import { type DynamicModule, Global, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, DiscoveryModule } from "@nestjs/core";
import { RouteAccessGuard } from "./access/route-access.guard.js";
import { RouteAccessVerifier } from "./access/route-access.verifier.js";
import { AuthModule } from "./auth/auth.module.js";
import { API_CONTEXT, type ApiContext } from "./context.js";
import { HealthModule } from "./health/health.module.js";
import { ErrorFilter } from "./http/error.filter.js";
import { MetricsController } from "./metrics/metrics.controller.js";
import { SetupModule } from "./setup/setup.module.js";

@Global()
@Module({})
export class AppModule {
  static forRoot(context: ApiContext): DynamicModule {
    return {
      module: AppModule,
      imports: [DiscoveryModule, HealthModule, ...(context.services ? [AuthModule, SetupModule] : [])],
      controllers: [MetricsController],
      providers: [
        { provide: API_CONTEXT, useValue: context },
        { provide: APP_GUARD, useClass: RouteAccessGuard },
        { provide: APP_FILTER, useClass: ErrorFilter },
        RouteAccessVerifier,
      ],
      exports: [API_CONTEXT],
    };
  }
}
