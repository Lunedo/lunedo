import { Module } from "@nestjs/common";
import { AccountsController } from "./accounts.controller.js";
import { GroupsController } from "./groups.controller.js";
import { InstanceController } from "./instance.controller.js";
import { OrganizationsController } from "./organizations.controller.js";

@Module({ controllers: [OrganizationsController, GroupsController, InstanceController, AccountsController] })
export class OrganizationsModule {}
