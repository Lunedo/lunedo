import { Module } from "@nestjs/common";
import { AccountController } from "./account.controller.js";
import { AuthController } from "./auth.controller.js";

@Module({ controllers: [AuthController, AccountController] })
export class AuthModule {}
