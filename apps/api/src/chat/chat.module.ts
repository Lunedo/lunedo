import { Module } from "@nestjs/common";
import { ChatChannelsController } from "./chat-channels.controller.js";

@Module({ controllers: [ChatChannelsController] })
export class ChatModule {}
