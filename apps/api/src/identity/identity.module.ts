import { Module } from "@nestjs/common";
import { IdentityProvidersController } from "./identity-providers.controller.js";
import { ProviderAuthController } from "./provider-auth.controller.js";
import { ProviderGroupsController } from "./provider-groups.controller.js";
import { ScimController } from "./scim.controller.js";

@Module({
  controllers: [
    IdentityProvidersController,
    ProviderAuthController,
    ProviderGroupsController,
    ScimController,
  ],
})
export class IdentityModule {}
