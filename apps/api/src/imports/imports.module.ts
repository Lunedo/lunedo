import { Module } from "@nestjs/common";
import { ImportsController } from "./imports.controller.js";

@Module({ controllers: [ImportsController] })
export class ImportsModule {}
