import type { StorageStatus } from "@lunedo/server";
import { Body, Controller, Get, Inject, Post, Put, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { actorOf } from "../http/request.js";
import {
  exampleStorageStatus,
  storageConfigurationSchema,
  storageStatusSchema,
  storageTestResultSchema,
} from "./schemas.js";

const TAG = "Storage";

function present(status: StorageStatus) {
  return { ...status, checkedAt: status.checkedAt?.toISOString() ?? null };
}

@Controller("api/v1")
export class StorageController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("instance/storage")
  @Permission("instance.settings.view")
  @ApiRoute({
    summary: "Get the usage of the file store",
    description:
      "Shows the usage of the file store, the active warning level and the settings of the warnings. For a local volume the usage is read from the volume; for S3 storage it is the running total of the files Lunedo stores, measured against the limit if one is set.",
    tags: [TAG],
    response: {
      description: "Usage and settings.",
      schema: storageStatusSchema,
      example: exampleStorageStatus,
    },
  })
  async status() {
    return present(await this.#services.storage.status());
  }

  @Put("instance/storage")
  @Permission("instance.settings.manage")
  @ApiRoute({
    summary: "Change the storage warnings",
    description:
      "Changes the three levels, the S3 limit, the reminder interval and the operations contacts. The levels must stay in ascending order. The Teams webhook address is stored encrypted and never returned. Changing the operations contacts is audited.",
    tags: [TAG],
    body: storageConfigurationSchema,
    bodyExample: { thresholds: { warning: 75, largeWrites: 88, critical: 94 }, reminder: "weekly" },
    response: {
      description: "Usage and settings.",
      schema: storageStatusSchema,
      example: exampleStorageStatus,
    },
    errors: ["invalidInput", "invalidStorageSettings"],
  })
  async configure(@Body() body: z.output<typeof storageConfigurationSchema>, @Req() request: FastifyRequest) {
    return present(await this.#services.storage.configure(actorOf(request), body));
  }

  @Post("instance/storage/test")
  @Permission("instance.settings.manage")
  @ApiRoute({
    summary: "Send a test message to the operations contacts",
    description:
      "Sends a short test message to the operations e-mail addresses and the Teams webhook, so that you can check that warnings arrive.",
    tags: [TAG],
    response: {
      description: "What was sent.",
      schema: storageTestResultSchema,
      example: { addresses: 1, teams: { delivered: true, reason: null, status: null } },
    },
  })
  async test() {
    const result = await this.#services.storage.sendTest();
    return {
      addresses: result.addresses,
      teams: result.teams
        ? result.teams.delivered
          ? { delivered: true, reason: null, status: null }
          : { delivered: false, reason: result.teams.failure.reason, status: result.teams.failure.status }
        : null,
    };
  }
}
