import { Module } from "@nestjs/common";
import { ExportsController } from "./exports.controller.js";

@Module({ controllers: [ExportsController] })
export class ExportsModule {}
