import type {
  MaintenanceStatus,
  OperationsStatus,
  RunningChangelog,
  UpdateCheckStatus,
} from "@lunedo/server";
import { Body, Controller, Get, Inject, Post, Put, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import type { z } from "zod";
import { InternalRoute, Permission, PublicRoute } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { actorOf } from "../http/request.js";
import {
  exampleOperationsStatus,
  maintenanceDetailsSchema,
  maintenanceInputSchema,
  maintenanceSchema,
  operationsStatusSchema,
} from "./schemas.js";
import { exampleUpdates, updatesSchema } from "./update-schemas.js";

const TAG = "Operations";

const exampleMaintenance = {
  enabled: true,
  message: "Update to 1.5 until 18:00. Pages can be read, but not changed.",
  blockSignIn: false,
  startedAt: "2026-10-21T16:00:00.000Z",
};

function presentUpdates(status: UpdateCheckStatus, whatsNew: RunningChangelog) {
  return {
    running: status.running,
    runningIsRelease: status.runningIsRelease,
    check: {
      enabled: status.enabled,
      disabledBy: status.disabledBy,
      url: status.url,
      checkedAt: status.checkedAt?.toISOString() ?? null,
      succeeded: status.succeeded,
      failure: status.failure,
    },
    latest: status.latest,
    available: status.available,
    commands: status.commands,
    whatsNew: {
      available: whatsNew.available,
      version: whatsNew.section?.version ?? null,
      date: whatsNew.section?.date ?? null,
      notes: whatsNew.section?.notes ?? null,
    },
  };
}

function presentMaintenance(status: MaintenanceStatus) {
  return {
    enabled: status.enabled,
    message: status.message,
    blockSignIn: status.blockSignIn,
    startedAt: status.startedAt?.toISOString() ?? null,
  };
}

function present(status: OperationsStatus) {
  return {
    ...status,
    checkedAt: status.checkedAt.toISOString(),
    recentErrors: status.recentErrors.map((entry) => ({ ...entry, lastAt: entry.lastAt.toISOString() })),
  };
}

@Controller("api/v1")
export class OperationsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("instance/operations/status")
  @Permission("instance.operations.view")
  @ApiRoute({
    summary: "Get the status of the instance",
    description:
      "Runs the operations checks: version, database, file storage, job queues, collaboration server, backups, search index, recent errors, and the setup checks for TLS, e-mail, encryption, clock and the file directory. Each item says `ok`, `warning` or `error` with a reason code and where it is fixed.",
    tags: [TAG],
    response: {
      description: "The status items.",
      schema: operationsStatusSchema,
      example: exampleOperationsStatus,
    },
  })
  async status() {
    return present(await this.#services.operations.status());
  }

  @Get("maintenance")
  @PublicRoute()
  @InternalRoute()
  @ApiRoute({
    summary: "Get the maintenance mode",
    description:
      "Tells whether the instance is in maintenance mode, with the message of the instance administrators. While it is on, every change through the API is refused with `503` and the problem `maintenanceMode`; reading, search and exports of single pages keep working. Anyone can read this, also without signing in, so that the sign-in page can show the banner.",
    tags: [TAG],
    response: {
      description: "The maintenance mode.",
      schema: maintenanceSchema,
      example: exampleMaintenance,
    },
  })
  async maintenance() {
    return presentMaintenance(await this.#services.maintenance.status());
  }

  @Get("instance/maintenance")
  @Permission("instance.operations.view")
  @ApiRoute({
    summary: "Get the maintenance mode with who changed it",
    description: "Shows the maintenance mode with when and by whom it was last switched or changed.",
    tags: [TAG],
    response: {
      description: "The maintenance mode.",
      schema: maintenanceDetailsSchema,
      example: {
        ...exampleMaintenance,
        changedAt: "2026-10-21T16:00:00.000Z",
        changedBy: { id: "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c", name: "Olivia Owner" },
      },
    },
  })
  async maintenanceDetails(@Req() request: FastifyRequest) {
    return this.#details(request, await this.#services.maintenance.status());
  }

  @Put("instance/maintenance")
  @Permission("instance.operations.manage")
  @ApiRoute({
    summary: "Switch maintenance mode",
    description:
      "Switches maintenance mode on or off, or changes its message and whether signing in is paused. While it is on, the instance is read-only for everyone, also for instance administrators: changes through the API are refused, open editors switch to read-only, and background jobs that change content wait. Backups, safety-net sweeps, mail delivery, SCIM and identity provider synchronization keep running. With `blockSignIn`, only instance administrators can sign in; existing sessions of others are not ended. Every switch and change is recorded in the audit log.",
    tags: [TAG],
    body: maintenanceInputSchema,
    bodyExample: { enabled: true, message: "Update to 1.5 until 18:00.", blockSignIn: false },
    response: {
      description: "The maintenance mode after the change.",
      schema: maintenanceDetailsSchema,
      example: { ...exampleMaintenance, changedAt: "2026-10-21T16:00:00.000Z", changedBy: null },
    },
    errors: ["invalidInput"],
  })
  async setMaintenance(
    @Body() body: z.output<typeof maintenanceInputSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#details(request, await this.#services.maintenance.set(actorOf(request), body));
  }

  @Get("instance/updates")
  @Permission("instance.operations.view")
  @ApiRoute({
    summary: "Get the running version and available updates",
    description:
      "Shows the running version, what is new in it, the result of the last update check, every release after the running version with its notes, breaking changes and manual steps, and the commands to update for the recorded installation method. The commands are built by Lunedo; nothing from the version file is executed or shown as HTML.",
    tags: [TAG],
    response: { description: "Version and updates.", schema: updatesSchema, example: exampleUpdates },
  })
  async updates() {
    const updates = this.#services.updates;
    return presentUpdates(await updates.status(), await updates.whatsNew());
  }

  @Post("instance/updates/check")
  @Permission("instance.operations.manage")
  @ApiRoute({
    summary: "Check for updates now",
    description:
      "Downloads the version file now instead of waiting for the daily check. Does nothing when the update check is off. A failed check is not an error of this request; the result names the reason.",
    tags: [TAG],
    response: {
      description: "Version and updates after the check.",
      schema: updatesSchema,
      example: exampleUpdates,
    },
  })
  async checkForUpdates() {
    const updates = this.#services.updates;
    return presentUpdates(await updates.check(), await updates.whatsNew());
  }

  async #details(request: FastifyRequest, status: MaintenanceStatus) {
    const name = status.changedBy
      ? ((await this.#services.people.visibleNames(actorOf(request), [status.changedBy])).get(
          status.changedBy,
        ) ?? null)
      : null;
    return {
      ...presentMaintenance(status),
      changedAt: status.changedAt?.toISOString() ?? null,
      changedBy: status.changedBy && name !== null ? { id: status.changedBy, name } : null,
    };
  }
}
