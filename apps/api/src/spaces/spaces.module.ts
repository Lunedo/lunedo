import { Module } from "@nestjs/common";
import { ItemsController } from "./items.controller.js";
import { OrganizationSpacesController } from "./organization-spaces.controller.js";
import { PersonalSpacesController } from "./personal-spaces.controller.js";
import { SpacesController } from "./spaces.controller.js";

@Module({
  controllers: [SpacesController, OrganizationSpacesController, ItemsController, PersonalSpacesController],
})
export class SpacesModule {}
