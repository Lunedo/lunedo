import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { TlsAskController } from "./tls-ask.controller.js";

@Module({ controllers: [HealthController, TlsAskController] })
export class HealthModule {}
