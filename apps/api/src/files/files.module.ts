import { Module } from "@nestjs/common";
import { AttachmentsController } from "./attachments.controller.js";

@Module({ controllers: [AttachmentsController] })
export class FilesModule {}
