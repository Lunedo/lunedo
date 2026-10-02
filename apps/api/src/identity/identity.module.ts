import { Module } from "@nestjs/common";
import { IdentityProvidersController } from "./identity-providers.controller.js";
import { ProviderAuthController } from "./provider-auth.controller.js";

@Module({ controllers: [IdentityProvidersController, ProviderAuthController] })
export class IdentityModule {}
