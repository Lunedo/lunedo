import { Module } from "@nestjs/common";
import { ItemsController } from "./items.controller.js";
import { OrganizationSpacesController } from "./organization-spaces.controller.js";
import { PersonalSpacesController } from "./personal-spaces.controller.js";
import { SpacesController } from "./spaces.controller.js";
import { TemplatesController } from "./templates.controller.js";
import { TrashController } from "./trash.controller.js";
import { VersionsController } from "./versions.controller.js";

@Module({
  controllers: [
    SpacesController,
    OrganizationSpacesController,
    ItemsController,
    PersonalSpacesController,
    VersionsController,
    TrashController,
    TemplatesController,
  ],
})
export class SpacesModule {}
