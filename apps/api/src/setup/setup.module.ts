import { Module } from "@nestjs/common";
import { SetupController } from "./setup.controller.js";

@Module({ controllers: [SetupController] })
export class SetupModule {}
