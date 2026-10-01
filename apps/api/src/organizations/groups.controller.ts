import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import { accountPrincipal, groupDescriptionSchema, groupNameSchema } from "@pagehall/server";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { InternalRoute, Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { sessionOf } from "../http/request.js";
import { ZodPipe } from "../http/zod.pipe.js";

const group = { type: "group", param: "groupId" } as const;
const id = z.uuid();
const updateSchema = z
  .object({ name: groupNameSchema.optional(), description: groupDescriptionSchema.optional() })
  .strict();
const memberSchema = z
  .object({
    accountId: z.uuid(),
    expiresAt: z.iso
      .datetime()
      .transform((value) => new Date(value))
      .nullable()
      .optional(),
  })
  .strict();
const managerSchema = z.object({ accountId: z.uuid() }).strict();

function notFound(): NotFoundException {
  return new NotFoundException({ statusCode: 404, code: "notFound", message: "Not found" });
}

@Controller("api/v1/groups")
@InternalRoute()
export class GroupsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  #actor(request: FastifyRequest) {
    return accountPrincipal(sessionOf(request).accountId);
  }

  @Get(":groupId")
  @Permission("group.view", group)
  async get(@Param("groupId", new ZodPipe(id)) groupId: string) {
    const found = await this.#services.groups.get(groupId);
    if (!found) throw notFound();
    return found;
  }

  @Patch(":groupId")
  @Permission("group.manage", group)
  async update(
    @Param("groupId", new ZodPipe(id)) groupId: string,
    @Body(new ZodPipe(updateSchema)) body: z.output<typeof updateSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.groups.update(this.#actor(request), groupId, body);
  }

  @Delete(":groupId")
  @Permission("group.delete", group)
  @HttpCode(204)
  async delete(@Param("groupId", new ZodPipe(id)) groupId: string, @Req() request: FastifyRequest) {
    await this.#services.groups.delete(this.#actor(request), groupId);
  }

  @Post(":groupId/members")
  @Permission("group.manage", group)
  @HttpCode(204)
  async addMember(
    @Param("groupId", new ZodPipe(id)) groupId: string,
    @Body(new ZodPipe(memberSchema)) body: z.output<typeof memberSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.groups.addMember(
      this.#actor(request),
      groupId,
      body.accountId,
      body.expiresAt ?? null,
    );
  }

  @Delete(":groupId/members/:accountId")
  @Permission("group.manage", group)
  @HttpCode(204)
  async removeMember(
    @Param("groupId", new ZodPipe(id)) groupId: string,
    @Param("accountId", new ZodPipe(id)) accountId: string,
    @Req() request: FastifyRequest,
  ) {
    if (!(await this.#services.groups.removeMember(this.#actor(request), groupId, accountId)))
      throw notFound();
  }

  @Post(":groupId/managers")
  @Permission("group.manage", group)
  @HttpCode(204)
  async addManager(
    @Param("groupId", new ZodPipe(id)) groupId: string,
    @Body(new ZodPipe(managerSchema)) body: z.output<typeof managerSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.groups.addManager(this.#actor(request), groupId, body.accountId);
  }

  @Delete(":groupId/managers/:accountId")
  @Permission("group.manage", group)
  @HttpCode(204)
  async removeManager(
    @Param("groupId", new ZodPipe(id)) groupId: string,
    @Param("accountId", new ZodPipe(id)) accountId: string,
    @Req() request: FastifyRequest,
  ) {
    if (!(await this.#services.groups.removeManager(this.#actor(request), groupId, accountId)))
      throw notFound();
  }
}
