import { type DynamicModule, Global, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, DiscoveryModule } from "@nestjs/core";
import { RouteAccessGuard } from "./access/route-access.guard.js";
import { RouteAccessVerifier } from "./access/route-access.verifier.js";
import { AuditModule } from "./audit/audit.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { API_CONTEXT, type ApiContext } from "./context.js";
import { DocsModule } from "./docs/docs.module.js";
import { HealthModule } from "./health/health.module.js";
import { ApiRouteInterceptor } from "./http/api-route.interceptor.js";
import { ErrorFilter } from "./http/error.filter.js";
import { MetricsController } from "./metrics/metrics.controller.js";
import { NotificationsModule } from "./notifications/notifications.module.js";
import { OrganizationsModule } from "./organizations/organizations.module.js";
import { SetupModule } from "./setup/setup.module.js";
import { TokensModule } from "./tokens/tokens.module.js";

@Global()
@Module({})
export class AppModule {
  static forRoot(context: ApiContext): DynamicModule {
    return {
      module: AppModule,
      imports: [
        DiscoveryModule,
        HealthModule,
        ...(context.services
          ? [
              AuthModule,
              SetupModule,
              OrganizationsModule,
              TokensModule,
              AuditModule,
              NotificationsModule,
              DocsModule,
            ]
          : []),
      ],
      controllers: [MetricsController],
      providers: [
        { provide: API_CONTEXT, useValue: context },
        { provide: APP_GUARD, useClass: RouteAccessGuard },
        { provide: APP_FILTER, useClass: ErrorFilter },
        { provide: APP_INTERCEPTOR, useClass: ApiRouteInterceptor },
        RouteAccessVerifier,
      ],
      exports: [API_CONTEXT],
    };
  }
}
