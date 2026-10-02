import { Module } from "@nestjs/common";
import { IdentityProvidersController } from "./identity-providers.controller.js";
import { ProviderAuthController } from "./provider-auth.controller.js";
import { ProviderGroupsController } from "./provider-groups.controller.js";

@Module({ controllers: [IdentityProvidersController, ProviderAuthController, ProviderGroupsController] })
export class IdentityModule {}
