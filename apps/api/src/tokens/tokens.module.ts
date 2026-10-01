import { Module } from "@nestjs/common";
import { ServiceAccountsController } from "./service-accounts.controller.js";
import { TokensController } from "./tokens.controller.js";

@Module({ controllers: [ServiceAccountsController, TokensController] })
export class TokensModule {}
