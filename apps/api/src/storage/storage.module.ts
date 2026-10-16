import { Module } from "@nestjs/common";
import { StorageController } from "./storage.controller.js";

@Module({ controllers: [StorageController] })
export class StorageModule {}
