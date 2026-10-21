import { Module } from "@nestjs/common";
import { BackupsController } from "./backups.controller.js";

@Module({ controllers: [BackupsController] })
export class BackupsModule {}
