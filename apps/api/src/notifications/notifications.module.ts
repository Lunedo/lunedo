import { Module } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller.js";
import { AccountWatchesController, WatchesController } from "./watches.controller.js";

@Module({ controllers: [NotificationsController, WatchesController, AccountWatchesController] })
export class NotificationsModule {}
