import { Module } from "@nestjs/common";
import { ExportsController } from "./exports.controller.js";
import { RenderingController } from "./rendering.controller.js";

@Module({ controllers: [ExportsController, RenderingController] })
export class ExportsModule {}
