import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import {
  defaultSpacePermissionsSchema,
  isValidSpaceKey,
  normalizeSpaceKey,
  SpaceError,
} from "@pagehall/server";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { nameCursor, pageQuerySchema, pageRequest, pageSchema, toApiPage } from "../http/pagination.js";
import { notFound } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import { organizationIdParams, uuid } from "../http/schemas.js";
import {
  createSpaceSchema,
  exampleSpace,
  holderKindSchema,
  roleSchema,
  spaceGrantSchema,
  spaceSchema,
  visibilitySchema,
} from "./schemas.js";

const TAG = "Spaces";
const organization = { type: "organization", param: "organizationId" } as const;
const keyParams = organizationIdParams.extend({ key: z.string().max(20).describe("Key to check.") });
const appointParams = organizationIdParams.extend({ spaceId: uuid("ID of the space.") });

const suggestionQuery = z
  .object({ name: z.string().trim().min(1).max(100).describe("Name of the new space.") })
  .strict();

const keyAnswerSchema = z
  .object({
    key: z.string().describe("The key in its stored form, in capitals."),
    valid: z.boolean().describe("Whether the key has 2 to 10 letters or digits."),
    available: z.boolean().describe("Whether no other space uses the key."),
  })
  .describe("A key for a new space.");

const defaultsSchema = z
  .object({
    visibility: visibilitySchema,
    grants: z
      .array(
        z
          .object({
            principalKind: holderKindSchema,
            principalId: uuid("ID of the account or group, or null.").nullable(),
            role: roleSchema,
            name: z
              .string()
              .nullable()
              .describe("Name of the account or group, or null for the other holders."),
          })
          .describe("A default role with the holder's name."),
      )
      .describe("Roles a new space gets unless the creator changes them."),
  })
  .describe("Default permissions for new spaces of the organization.");

const defaultsBodySchema = z
  .object({
    visibility: visibilitySchema,
    grants: z
      .array(spaceGrantSchema)
      .max(50)
      .describe("Roles a new space gets unless the creator changes them."),
  })
  .strict()
  .describe("Default permissions for new spaces.");

const appointSchema = z
  .object({ accountId: uuid("Person of the organization who becomes space admin.") })
  .strict()
  .describe("The new space admin.");

@Controller("api/v1/organizations")
export class OrganizationSpacesController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  async #defaults(organizationId: string) {
    const defaults = await this.#services.spaces.defaultPermissions(organizationId);
    const ids = defaults.grants.map((grant) => grant.principalId).filter((id): id is string => id !== null);
    const names = await this.#services.people.names(ids);
    const groups = await Promise.all(
      defaults.grants
        .filter((grant) => grant.principalKind === "group" && grant.principalId)
        .map(async (grant) => [
          grant.principalId,
          (await this.#services.groups.get(grant.principalId ?? ""))?.name,
        ]),
    );
    const groupNames = new Map(groups as [string, string | undefined][]);
    return {
      visibility: defaults.visibility,
      grants: defaults.grants.map((grant) => ({
        ...grant,
        name: grant.principalId
          ? (names.get(grant.principalId) ?? groupNames.get(grant.principalId) ?? null)
          : null,
      })),
    };
  }

  @Get(":organizationId/space-defaults")
  @Permission(["organization.spaces.create", "organization.settings.view"], organization)
  @ApiRoute({
    summary: "Get the default permissions for new spaces",
    description:
      "Returns the visibility and roles a new space of the organization gets unless its creator changes them.",
    tags: [TAG],
    params: organizationIdParams,
    response: {
      description: "The default permissions.",
      schema: defaultsSchema,
      example: {
        visibility: "organization",
        grants: [{ principalKind: "organizationMembers", principalId: null, role: "editor", name: null }],
      },
    },
  })
  async defaults(@Param("organizationId") organizationId: string) {
    return this.#defaults(organizationId);
  }

  @Put(":organizationId/space-defaults")
  @Permission("organization.settings.manage", organization)
  @ApiRoute({
    summary: "Change the default permissions for new spaces",
    description:
      "Sets the visibility and roles new spaces get. Existing spaces do not change. The change is audited as a settings change.",
    tags: [TAG],
    params: organizationIdParams,
    body: defaultsBodySchema,
    bodyExample: {
      visibility: "organization",
      grants: [{ principalKind: "organizationMembers", principalId: null, role: "reader" }],
    },
    response: {
      description: "The default permissions.",
      schema: defaultsSchema,
      example: {
        visibility: "organization",
        grants: [{ principalKind: "organizationMembers", principalId: null, role: "reader", name: null }],
      },
    },
    errors: ["invalidHolder"],
  })
  async setDefaults(
    @Param("organizationId") organizationId: string,
    @Body() body: z.output<typeof defaultsBodySchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.spaces.setDefaultPermissions(
      actorOf(request),
      organizationId,
      defaultSpacePermissionsSchema.parse(body),
      this.#services.spacePermissions.holders,
    );
    return this.#defaults(organizationId);
  }

  @Get(":organizationId/space-key-suggestion")
  @Permission("organization.spaces.create", organization)
  @ApiRoute({
    summary: "Suggest a key for a new space",
    description: "Suggests a free key derived from the name of the new space.",
    tags: [TAG],
    params: organizationIdParams,
    query: suggestionQuery,
    response: {
      description: "The suggested key.",
      schema: keyAnswerSchema,
      example: { key: "ITO", valid: true, available: true },
    },
  })
  async suggestKey(@Query() query: z.output<typeof suggestionQuery>) {
    return { key: await this.#services.spaces.suggestKey(query.name), valid: true, available: true };
  }

  @Get(":organizationId/space-keys/:key")
  @Permission("organization.spaces.create", organization)
  @ApiRoute({
    summary: "Check a key for a new space",
    description: "Tells whether a key is valid and free.",
    tags: [TAG],
    params: keyParams,
    response: {
      description: "Whether the key can be used.",
      schema: keyAnswerSchema,
      example: { key: "ITOPS", valid: true, available: false },
    },
  })
  async checkKey(@Param("key") key: string) {
    const normalized = normalizeSpaceKey(key);
    const valid = isValidSpaceKey(normalized);
    return {
      key: normalized,
      valid,
      available: valid && (await this.#services.spaces.keyAvailable(normalized)),
    };
  }

  @Post(":organizationId/spaces")
  @Permission("organization.spaces.create", organization)
  @ApiRoute({
    summary: "Create a space",
    description:
      "Creates a space with an overview page. The creator becomes space admin; the given holders get their roles. Members can create spaces when the organization allows it; guests and collaborators cannot.",
    tags: [TAG],
    params: organizationIdParams,
    body: createSpaceSchema,
    bodyExample: {
      name: "IT Operations",
      key: "ITOPS",
      description: "Runbooks and how-tos of the IT team",
      visibility: "organization",
      grants: [{ principalKind: "organizationMembers", principalId: null, role: "editor" }],
    },
    status: 201,
    response: { description: "The new space.", schema: spaceSchema, example: exampleSpace },
    errors: ["invalidSpaceName", "invalidSpaceKey", "invalidSpaceDescription", "keyTaken", "invalidHolder"],
  })
  async create(
    @Param("organizationId") organizationId: string,
    @Body() body: z.output<typeof createSpaceSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.spaces.create(
      actorOf(request),
      organizationId,
      body,
      this.#services.spacePermissions.holders,
    );
  }

  @Get(":organizationId/spaces-without-administrator")
  @Permission("organization.spaces.view", organization)
  @ApiRoute({
    summary: "List spaces without a space admin",
    description:
      "Lists spaces of the organization in which no active account holds the space admin role, for example after the last space admin was deactivated.",
    tags: [TAG],
    params: organizationIdParams,
    query: pageQuerySchema,
    response: {
      description: "Spaces without a space admin.",
      schema: pageSchema(spaceSchema, "Spaces, ordered by name."),
      example: { items: [exampleSpace], nextCursor: null },
    },
  })
  async withoutAdministrator(
    @Param("organizationId") organizationId: string,
    @Query() query: z.output<typeof pageQuerySchema>,
  ) {
    return toApiPage(
      await this.#services.spaces.withoutAdministrator(organizationId, pageRequest(query, nameCursor)),
    );
  }

  @Post(":organizationId/spaces/:spaceId/administrator")
  @Permission("organization.spaces.manage", organization)
  @ApiRoute({
    summary: "Appoint a space admin",
    description:
      "Makes a person of the organization space admin of a space that has none. Administrators cannot appoint themselves. The appointment is audited.",
    tags: [TAG],
    params: appointParams,
    body: appointSchema,
    bodyExample: { accountId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20" },
    errors: ["spaceHasAdministrator", "invalidHolder", "selfAppointment"],
  })
  async appoint(
    @Param("organizationId") organizationId: string,
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof appointSchema>,
    @Req() request: FastifyRequest,
  ) {
    const space = await this.#services.spaces.get(spaceId);
    if (!space || space.organizationId !== organizationId)
      throw new SpaceError("spaceNotFound", "The space does not exist");
    await this.#services.spaces.appointAdministrator(actorOf(request), spaceId, body.accountId);
  }
}
