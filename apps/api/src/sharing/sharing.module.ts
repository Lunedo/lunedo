import { Module } from "@nestjs/common";
import { ShareLinksController } from "./links.controller.js";
import { PageAccessController } from "./page-access.controller.js";
import { AccessRequestsController } from "./requests.controller.js";

@Module({ controllers: [PageAccessController, ShareLinksController, AccessRequestsController] })
export class SharingModule {}
