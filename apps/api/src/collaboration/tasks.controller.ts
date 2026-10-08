import { Body, Controller, Get, Inject, Param, Put, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { decodeCursor, encodeCursor } from "../http/pagination.js";
import { actorOf } from "../http/request.js";
import { uuid } from "../http/schemas.js";
import {
  exampleTask,
  setTaskStatusSchema,
  taskListSchema,
  taskQuerySchema,
  taskStatusSchema,
} from "./schemas.js";

const TAG = "Tasks";
const taskParams = z.object({ taskId: uuid("ID of the task.") }).strict();
const pageParams = z.object({ pageId: uuid("ID of the page or blog post.") }).strict();
const taskCursor = z.tuple([z.string().max(20), z.string().max(40)]);
const exampleStatus = {
  id: exampleTask.id,
  done: true,
  changedAt: "2026-10-07T09:00:00.000Z",
  changedBy: { id: exampleTask.assignee.id, name: exampleTask.assignee.name },
};

@Controller("api/v1")
export class TasksController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("tasks")
  @Permission("instance.content.view")
  @ApiRoute({
    summary: "List tasks",
    description:
      "Lists tasks of published content the caller can read, across all spaces, with counts. With `assignee=me` this is the caller's list of tasks; the task report block uses the same filters. Overdue relates to today in the caller's time zone.",
    tags: [TAG],
    query: taskQuerySchema,
    response: {
      description: "The tasks.",
      schema: taskListSchema,
      example: { items: [exampleTask], counts: { open: 1, done: 0, overdue: 0 }, nextCursor: null },
    },
  })
  async list(@Query() query: z.output<typeof taskQuerySchema>, @Req() request: FastifyRequest) {
    const after = decodeCursor(query.cursor, taskCursor);
    const result = await this.#services.tasks.list(actorOf(request), {
      assignee: query.assignee,
      spaceId: query.spaceId,
      status: query.status,
      due: query.due,
      after: after ?? undefined,
      limit: query.limit,
    });
    return {
      items: result.items,
      counts: result.counts,
      nextCursor: result.next ? encodeCursor(result.next) : null,
    };
  }

  @Get("pages/:pageId/tasks")
  @Permission("item.view", { type: "item", param: "pageId" })
  @ApiRoute({
    summary: "Get the status of the tasks on a page",
    description:
      "Returns the status of every task on the page. The status is kept apart from the content, so the draft and the published version show the same status. Readers get the tasks of the published content, editors also those of the draft.",
    tags: [TAG],
    params: pageParams,
    response: {
      description: "Status per task.",
      schema: z.array(taskStatusSchema).describe("Statuses in the order of the page."),
      example: [exampleStatus],
    },
  })
  async statuses(@Param("pageId") pageId: string, @Req() request: FastifyRequest) {
    return this.#services.tasks.statuses(actorOf(request), pageId);
  }

  @Put("tasks/:taskId/status")
  @Permission("task.update", { type: "task", param: "taskId" })
  @ApiRoute({
    summary: "Check or uncheck a task",
    description:
      "Sets a task to done or open without changing the content, so it needs no publication. Editors of the page and the assignee of a published task may do this. Every change records who made it and when.",
    tags: [TAG],
    params: taskParams,
    body: setTaskStatusSchema,
    bodyExample: { done: true },
    response: { description: "The new status.", schema: taskStatusSchema, example: exampleStatus },
  })
  async setStatus(
    @Param("taskId") taskId: string,
    @Body() body: z.output<typeof setTaskStatusSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.tasks.setStatus(actorOf(request), taskId, body.done);
  }

  @Put("pages/:pageId/tasks/:taskId/status")
  @Permission("item.edit", { type: "item", param: "pageId" })
  @ApiRoute({
    summary: "Set the status of a task on a page",
    description:
      "Sets a task of the page to done or open, for editors of the page. A task ID that does not exist yet is created for this page with the given status, so a task can be checked before its content is stored, for example right after pasting a done task. Every change records who made it and when.",
    tags: [TAG],
    params: pageParams.extend({ taskId: uuid("ID of the task.") }).strict(),
    body: setTaskStatusSchema,
    bodyExample: { done: true },
    response: { description: "The new status.", schema: taskStatusSchema, example: exampleStatus },
  })
  async setStatusOnPage(
    @Param("pageId") pageId: string,
    @Param("taskId") taskId: string,
    @Body() body: z.output<typeof setTaskStatusSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.tasks.setStatusOnPage(actorOf(request), pageId, taskId, body.done);
  }
}
