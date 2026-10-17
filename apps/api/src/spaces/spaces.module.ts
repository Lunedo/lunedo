import { Module } from "@nestjs/common";
import { DiagramsController } from "../diagrams/diagrams.controller.js";
import { MeetingsController } from "../meetings/meetings.controller.js";
import { OneOnOnesController } from "../meetings/one-on-ones.controller.js";
import { WhiteboardsController } from "../whiteboards/whiteboards.controller.js";
import { ConfidentialSpacesController } from "./confidential-spaces.controller.js";
import { ItemsController } from "./items.controller.js";
import { OrganizationSpacesController } from "./organization-spaces.controller.js";
import { OwnershipController } from "./ownership.controller.js";
import { PersonalSpacesController } from "./personal-spaces.controller.js";
import { ShortcutsController } from "./shortcuts.controller.js";
import { SpacesController } from "./spaces.controller.js";
import { TemplatesController } from "./templates.controller.js";
import { TrashController } from "./trash.controller.js";
import { VersionsController } from "./versions.controller.js";

@Module({
  controllers: [
    SpacesController,
    OrganizationSpacesController,
    ConfidentialSpacesController,
    ItemsController,
    OwnershipController,
    ShortcutsController,
    PersonalSpacesController,
    VersionsController,
    WhiteboardsController,
    DiagramsController,
    TrashController,
    TemplatesController,
    MeetingsController,
    OneOnOnesController,
  ],
})
export class SpacesModule {}
