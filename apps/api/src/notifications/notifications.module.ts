import { Module } from "@nestjs/common";
import { NotificationsController } from "./notifications.controller.js";
import { PushController } from "./push.controller.js";
import { AccountWatchesController, WatchesController } from "./watches.controller.js";

@Module({
  controllers: [NotificationsController, WatchesController, AccountWatchesController, PushController],
})
export class NotificationsModule {}
