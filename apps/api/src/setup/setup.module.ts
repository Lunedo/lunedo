import { Module } from "@nestjs/common";
import { SetupRestoreController } from "./restore.controller.js";
import { SetupController } from "./setup.controller.js";

@Module({ controllers: [SetupController, SetupRestoreController] })
export class SetupModule {}
