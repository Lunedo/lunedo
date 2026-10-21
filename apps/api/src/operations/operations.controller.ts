import { Controller, Get, Inject } from "@nestjs/common";
import type { OperationsStatus } from "@pagehall/server";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { exampleOperationsStatus, operationsStatusSchema } from "./schemas.js";

const TAG = "Operations";

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
}
