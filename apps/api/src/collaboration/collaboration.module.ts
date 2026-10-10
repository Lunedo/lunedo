import { Module } from "@nestjs/common";
import { BlogController } from "./blog.controller.js";
import { CommentsController } from "./comments.controller.js";
import { HomeController } from "./home.controller.js";
import { ReportsController } from "./reports.controller.js";
import { TasksController } from "./tasks.controller.js";

@Module({
  controllers: [CommentsController, TasksController, ReportsController, BlogController, HomeController],
})
export class CollaborationModule {}
