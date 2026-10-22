import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { InternalRoute, Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { nameCursor, pageRequest, pageSchema, toApiPage } from "../http/pagination.js";
import { notFound, ProblemException } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import {
  directoryKeySchema,
  groupPreviewQuery,
  groupSearchQuery,
  mappingRuleBodySchema,
  mappingRuleSchema,
  providerGroupMatchSchema,
  providerIdParams,
  ruleOrderSchema,
  ruleParams,
  rulePreviewSchema,
  runParams,
  syncRequestedSchema,
  syncRunDetailsSchema,
  syncRunSchema,
  syncRunsQuery,
} from "./schemas.js";

const TAG = "Identity providers";
const RULE_ERRORS = [
  "roleNotFound",
  "roleNotAssignable",
  "groupNameTaken",
  "providerGroupNotFound",
  "providerUnavailable",
  "forbidden",
] as const;

@Controller("api/v1/instance/identity-providers/:providerId")
@InternalRoute()
export class ProviderGroupsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Put("directory-key")
  @Permission("instance.signIn.manage", { type: "instance" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "Store the Google service account key",
    description:
      "Lunedo reads accounts and groups from the Google directory with this key, read-only and in the name of the administrator set in the provider's directory settings.",
    tags: [TAG],
    params: providerIdParams,
    body: directoryKeySchema,
    errors: ["invalidServiceAccountKey", "invalidProviderConfiguration", "reauthenticationRequired"],
  })
  async setDirectoryKey(
    @Param("providerId") providerId: string,
    @Body() body: z.output<typeof directoryKeySchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.identityProviders.setDirectoryKey(actorOf(request), providerId, body.key);
  }

  @Delete("directory-key")
  @Permission("instance.signIn.manage", { type: "instance" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "Remove the Google service account key",
    tags: [TAG],
    params: providerIdParams,
    errors: ["reauthenticationRequired"],
  })
  async removeDirectoryKey(@Param("providerId") providerId: string, @Req() request: FastifyRequest) {
    await this.#services.identityProviders.removeDirectoryKey(actorOf(request), providerId);
  }

  @Get("mapping-rules")
  @Permission("instance.signIn.view")
  @ApiRoute({
    summary: "List the mapping rules of a provider",
    tags: [TAG],
    params: providerIdParams,
    response: { description: "The rules, in order.", schema: z.array(mappingRuleSchema) },
  })
  async listRules(@Param("providerId") providerId: string) {
    return this.#services.mappingRules.list(providerId);
  }

  @Post("mapping-rules")
  @Permission("instance.signIn.manage")
  @ApiRoute({
    summary: "Create a mapping rule",
    description:
      "A rule is a grant: nobody creates a rule that grants more than they may grant themselves. Members of the group gain the access at their next sign-in or synchronization; accounts already in the group gain it at once.",
    tags: [TAG],
    status: 201,
    params: providerIdParams,
    body: mappingRuleBodySchema,
    response: { description: "The rule.", schema: mappingRuleSchema },
    errors: [...RULE_ERRORS],
  })
  async createRule(
    @Param("providerId") providerId: string,
    @Body() body: z.output<typeof mappingRuleBodySchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.mappingRules.create(actorOf(request), providerId, body);
  }

  @Put("mapping-rules/:ruleId")
  @Permission("instance.signIn.manage")
  @ApiRoute({
    summary: "Change a mapping rule",
    description: "Access the old rule granted and the new one does not is removed.",
    tags: [TAG],
    params: ruleParams,
    body: mappingRuleBodySchema,
    response: { description: "The rule.", schema: mappingRuleSchema },
    errors: [...RULE_ERRORS],
  })
  async updateRule(
    @Param("providerId") providerId: string,
    @Param("ruleId") ruleId: string,
    @Body() body: z.output<typeof mappingRuleBodySchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.mappingRules.update(actorOf(request), providerId, ruleId, body);
  }

  @Delete("mapping-rules/:ruleId")
  @Permission("instance.signIn.manage")
  @ApiRoute({
    summary: "Remove a mapping rule",
    description: "Access the rule granted is removed unless another rule or a manual grant keeps it.",
    tags: [TAG],
    params: ruleParams,
    errors: ["forbidden"],
  })
  async removeRule(
    @Param("providerId") providerId: string,
    @Param("ruleId") ruleId: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.mappingRules.remove(actorOf(request), providerId, ruleId);
  }

  @Put("mapping-rule-order")
  @Permission("instance.signIn.manage")
  @ApiRoute({
    summary: "Reorder the mapping rules",
    description: "When several rules name a home organization, the first matching rule decides.",
    tags: [TAG],
    params: providerIdParams,
    body: ruleOrderSchema,
    response: { description: "The rules, in the new order.", schema: z.array(mappingRuleSchema) },
    errors: ["forbidden"],
  })
  async reorderRules(
    @Param("providerId") providerId: string,
    @Body() body: z.output<typeof ruleOrderSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.mappingRules.reorder(actorOf(request), providerId, body.ruleIds);
  }

  @Get("groups")
  @Permission("instance.signIn.manage")
  @ApiRoute({
    summary: "Search the groups of a provider",
    description:
      "Searches the provider's directory when Lunedo can read it, otherwise the groups Lunedo has seen at sign-in.",
    tags: [TAG],
    params: providerIdParams,
    query: groupSearchQuery,
    response: { description: "Matching groups.", schema: z.array(providerGroupMatchSchema) },
    errors: ["providerUnavailable"],
  })
  async searchGroups(
    @Param("providerId") providerId: string,
    @Query() query: z.output<typeof groupSearchQuery>,
  ) {
    return this.#services.mappingRules.searchGroups(providerId, query.q);
  }

  @Get("group-preview")
  @Permission("instance.signIn.manage")
  @ApiRoute({
    summary: "Show who gains access through a group",
    tags: [TAG],
    params: providerIdParams,
    query: groupPreviewQuery,
    response: { description: "Who gains access.", schema: rulePreviewSchema },
  })
  async previewGroup(
    @Param("providerId") providerId: string,
    @Query() query: z.output<typeof groupPreviewQuery>,
  ) {
    return this.#services.mappingRules.preview(providerId, query.group);
  }

  @Post("sync")
  @Permission("instance.signIn.manage")
  @ApiRoute({
    summary: "Synchronize a provider now",
    tags: [TAG],
    status: 202,
    params: providerIdParams,
    response: { description: "The requested synchronization.", schema: syncRequestedSchema },
    errors: ["syncUnavailable"],
  })
  async sync(@Param("providerId") providerId: string, @Req() request: FastifyRequest) {
    return this.#services.providerSync.request(actorOf(request), providerId);
  }

  @Get("sync-runs")
  @Permission("instance.signIn.view")
  @ApiRoute({
    summary: "List the sync log of a provider",
    tags: [TAG],
    params: providerIdParams,
    query: syncRunsQuery,
    response: { description: "Runs, newest first.", schema: pageSchema(syncRunSchema, "Runs.") },
  })
  async runs(@Param("providerId") providerId: string, @Query() query: z.output<typeof syncRunsQuery>) {
    return toApiPage(
      await this.#services.providerSync.runs(providerId, query.filter, pageRequest(query, nameCursor)),
    );
  }

  @Post("sync-runs/:runId/cancel")
  @Permission("instance.signIn.manage")
  @ApiRoute({
    summary: "Cancel a running synchronization",
    description:
      "The run stops before the next account and is recorded as cancelled. Changes made so far stay.",
    tags: [TAG],
    status: 204,
    params: runParams,
    errors: ["syncNotRunning"],
  })
  async cancelRun(
    @Param("providerId") providerId: string,
    @Param("runId") runId: string,
    @Req() request: FastifyRequest,
  ) {
    if (!(await this.#services.providerSync.cancel(actorOf(request), providerId, runId))) {
      throw new ProblemException("syncNotRunning", "The run has finished already");
    }
  }

  @Post("sync-runs/:runId/confirm")
  @Permission("instance.signIn.manage")
  @ApiRoute({
    summary: "Confirm the deactivations a run held back",
    description:
      "A run stops and deactivates nobody when it would deactivate more than the configured share of the provider's accounts, or when the directory returns none of them. Confirming starts a new run that may deactivate up to as many accounts as the held run would have. Each held run can be confirmed once.",
    tags: [TAG],
    status: 202,
    params: runParams,
    response: { description: "The requested synchronization.", schema: syncRequestedSchema },
    errors: ["syncNotHeld"],
  })
  async confirmRun(
    @Param("providerId") providerId: string,
    @Param("runId") runId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.providerSync.confirm(actorOf(request), providerId, runId);
  }

  @Get("sync-runs/:runId")
  @Permission("instance.signIn.view")
  @ApiRoute({
    summary: "Get a run of the sync log",
    tags: [TAG],
    params: runParams,
    response: { description: "The run with its changes and warnings.", schema: syncRunDetailsSchema },
  })
  async run(@Param("providerId") providerId: string, @Param("runId") runId: string) {
    const run = await this.#services.providerSync.runDetails(providerId, runId);
    if (!run) throw notFound();
    return run;
  }
}
