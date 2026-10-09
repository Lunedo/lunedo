import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, Req } from "@nestjs/common";
import { isValidSpaceKey, normalizeSpaceKey, type SpaceWithRole } from "@pagehall/server";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { nameCursor, pageQuery, pageRequest, pageSchema, toApiPage } from "../http/pagination.js";
import { notFound } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import { uuid } from "../http/schemas.js";
import {
  exampleImpact,
  examplePermission,
  exampleSpace,
  impactSchema,
  permissionChangeSchema,
  permissionSchema,
  spaceSchema,
  spaceWithRoleSchema,
  visibilitySchema,
} from "./schemas.js";

const TAG = "Spaces";
const space = { type: "space", param: "spaceId" } as const;
const spaceParams = z.object({ spaceId: uuid("ID of the space.") }).strict();
const permissionParams = spaceParams.extend({ permissionId: uuid("ID of the permission.") });
const keyParams = z
  .object({ key: z.string().max(20).describe("Key of a space, or a key it had before.") })
  .strict();
const keyCheckParams = spaceParams.extend({ key: z.string().max(20).describe("Key to check.") });

const listQuery = z
  .object({
    ...pageQuery,
    q: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe("Only spaces whose name, key or description contain this text."),
    archived: z
      .enum(["true", "false"])
      .optional()
      .describe(
        "`true` lists only archived spaces. Without it, only spaces that are not archived are listed.",
      ),
    organizationId: uuid("Only spaces of this organization.").optional(),
    oneOnOne: z
      .enum(["true", "false"])
      .optional()
      .describe("`true` lists only the caller's one-on-ones. Without it, one-on-ones are left out."),
  })
  .strict();

const updateSchema = z
  .object({
    name: z.string().max(100).optional().describe("New name, 1 to 100 characters."),
    description: z.string().max(1000).optional().describe("New description, up to 1000 characters."),
    discoverable: z
      .boolean()
      .optional()
      .describe(
        "Whether members of the organization can find the space and ask for access. Not for personal spaces.",
      ),
  })
  .strict()
  .describe("Fields to change.");

const keySchema = z
  .object({ key: z.string().max(20).describe("New key, 2 to 10 letters or digits.") })
  .strict()
  .describe("The new key. The old key keeps leading to the space until another space takes it.");

const visibilityBodySchema = z.object({ visibility: visibilitySchema }).strict().describe("The visibility.");

const availabilitySchema = z
  .object({
    key: z.string().describe("The key in its stored form, in capitals."),
    valid: z.boolean().describe("Whether the key has 2 to 10 letters or digits."),
    available: z.boolean().describe("Whether no other space uses the key."),
  })
  .describe("Whether a key can be used.");

const resolvedSchema = z
  .object({
    space: spaceWithRoleSchema,
    redirected: z.boolean().describe("Whether the key is an earlier key of the space."),
  })
  .describe("The space a key leads to.");

@Controller("api/v1")
export class SpacesController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("spaces")
  @Permission("instance.content.view")
  @ApiRoute({
    summary: "List spaces",
    description:
      "Lists the spaces the caller can read, ordered by name. Archived spaces are listed only when asked for. API tokens see the spaces their scopes reach.",
    tags: [TAG],
    query: listQuery,
    response: {
      description: "Readable spaces.",
      schema: pageSchema(spaceSchema, "Spaces, ordered by name."),
      example: { items: [exampleSpace], nextCursor: null },
    },
  })
  async list(@Req() request: FastifyRequest, @Query() query: z.output<typeof listQuery>) {
    return toApiPage(
      await this.#services.spaces.list(actorOf(request), {
        organizationId: query.organizationId,
        archived: query.archived === "true",
        oneOnOne: query.oneOnOne === "true",
        page: pageRequest(query, nameCursor),
      }),
    );
  }

  @Get("spaces/:spaceId")
  @Permission("space.view", space)
  @ApiRoute({
    summary: "Get a space",
    description: "Returns the space with the caller's role in it.",
    tags: [TAG],
    params: spaceParams,
    response: {
      description: "The space.",
      schema: spaceWithRoleSchema,
      example: { ...exampleSpace, role: "editor" },
    },
  })
  async get(@Param("spaceId") spaceId: string, @Req() request: FastifyRequest): Promise<SpaceWithRole> {
    const found = await this.#services.spaces.withRole(actorOf(request), spaceId);
    if (!found) throw notFound();
    return found;
  }

  @Get("space-keys/:key")
  @Permission("instance.content.view")
  @ApiRoute({
    summary: "Find a space by key",
    description:
      "Returns the space that uses the key, or that used it before a key change. Spaces the caller cannot read are not found.",
    tags: [TAG],
    params: keyParams,
    response: {
      description: "The space.",
      schema: resolvedSchema,
      example: { space: { ...exampleSpace, role: "reader" }, redirected: false },
    },
  })
  async resolve(@Param("key") key: string, @Req() request: FastifyRequest) {
    const actor = actorOf(request);
    const resolved = await this.#services.spaces.resolveKey(key);
    if (!resolved) throw notFound();
    const allowed = await this.#services.authorization.authorize(actor, "space.view", {
      type: "space",
      id: resolved.space.id,
    });
    if (!allowed) throw notFound();
    const withRole = await this.#services.spaces.withRole(actor, resolved.space.id);
    if (!withRole) throw notFound();
    return { space: withRole, redirected: resolved.redirected };
  }

  @Patch("spaces/:spaceId")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Change a space",
    description: "Renames a space or changes its description. Both changes are audited.",
    tags: [TAG],
    params: spaceParams,
    body: updateSchema,
    bodyExample: { description: "Runbooks, how-tos and contacts of the IT team" },
    response: { description: "The changed space.", schema: spaceSchema, example: exampleSpace },
    errors: ["invalidSpaceName", "invalidSpaceDescription"],
  })
  async update(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof updateSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.spaces.update(actorOf(request), spaceId, body);
  }

  @Get("spaces/:spaceId/keys/:key")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Check a new key for a space",
    description: "Tells whether a key is valid and free, before changing the key of the space.",
    tags: [TAG],
    params: keyCheckParams,
    response: {
      description: "Whether the key can be used.",
      schema: availabilitySchema,
      example: { key: "IT", valid: true, available: true },
    },
  })
  async checkKey(@Param("spaceId") spaceId: string, @Param("key") key: string) {
    const normalized = normalizeSpaceKey(key);
    const space = await this.#services.spaces.require(spaceId);
    const valid = isValidSpaceKey(normalized);
    return {
      key: normalized,
      valid,
      available:
        valid && (space.key === normalized || (await this.#services.spaces.keyAvailable(normalized))),
    };
  }

  @Put("spaces/:spaceId/key")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Change the key of a space",
    description:
      "Changes the key that appears in addresses. Addresses with the old key keep leading to the space until another space takes that key. The change is audited.",
    tags: [TAG],
    params: spaceParams,
    body: keySchema,
    bodyExample: { key: "IT" },
    response: {
      description: "The changed space.",
      schema: spaceSchema,
      example: { ...exampleSpace, key: "IT" },
    },
    errors: ["invalidSpaceKey", "keyTaken"],
  })
  async changeKey(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof keySchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.spaces.changeKey(actorOf(request), spaceId, body.key);
  }

  @Post("spaces/:spaceId/visibility/preview")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Preview a visibility change",
    description: "Shows who would gain or lose read access if the visibility changed. Nothing is changed.",
    tags: [TAG],
    status: 200,
    params: spaceParams,
    body: visibilityBodySchema,
    bodyExample: { visibility: "organization" },
    response: { description: "The change in access.", schema: impactSchema, example: exampleImpact },
  })
  async previewVisibility(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof visibilityBodySchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.spaces.visibilityImpact(actorOf(request), spaceId, body.visibility);
  }

  @Put("spaces/:spaceId/visibility")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Change the visibility of a space",
    description:
      "Changes who can read the space besides its holders. Preview the change first and confirm it with the people it affects in view. The change is audited.",
    tags: [TAG],
    params: spaceParams,
    body: visibilityBodySchema,
    bodyExample: { visibility: "organization" },
    response: { description: "The changed space.", schema: spaceSchema, example: exampleSpace },
    errors: ["personalSpaceVisibility"],
  })
  async changeVisibility(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof visibilityBodySchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.spaces.changeVisibility(actorOf(request), spaceId, body.visibility);
  }

  @Get("spaces/:spaceId/permissions")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "List the permissions of a space",
    description:
      "Lists every holder with a role in the space: all internal users, all members, groups, then accounts.",
    tags: [TAG],
    params: spaceParams,
    response: {
      description: "The permissions.",
      schema: z.array(permissionSchema).describe("Permissions of the space."),
      example: [examplePermission],
    },
  })
  async permissions(@Param("spaceId") spaceId: string) {
    return this.#services.spacePermissions.list(spaceId);
  }

  @Post("spaces/:spaceId/permissions/preview")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Preview a permission change",
    description: "Shows who would gain, lose or change access. Nothing is changed.",
    tags: [TAG],
    status: 200,
    params: spaceParams,
    body: permissionChangeSchema,
    bodyExample: {
      action: "grant",
      principalKind: "account",
      principalId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20",
      role: "reader",
    },
    response: { description: "The change in access.", schema: impactSchema, example: exampleImpact },
    errors: ["invalidHolder", "alreadyGranted", "permissionNotFound"],
  })
  async preview(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof permissionChangeSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.spacePermissions.preview(actorOf(request), spaceId, body);
  }

  @Post("spaces/:spaceId/permissions")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Change the permissions of a space",
    description:
      "Gives a holder a role, changes a role or removes one. A space always keeps at least one space admin, and nobody extends their own permissions. Every change is audited.",
    tags: [TAG],
    status: 200,
    params: spaceParams,
    body: permissionChangeSchema,
    bodyExample: {
      action: "grant",
      principalKind: "account",
      principalId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20",
      role: "reader",
    },
    response: {
      description: "The permissions after the change.",
      schema: z.array(permissionSchema).describe("Permissions of the space."),
      example: [examplePermission],
    },
    errors: ["invalidHolder", "alreadyGranted", "permissionNotFound", "lastSpaceAdmin", "selfExtension"],
  })
  async change(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof permissionChangeSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.spacePermissions.apply(actorOf(request), spaceId, body);
  }

  @Delete("spaces/:spaceId/permissions/:permissionId")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Remove a permission",
    description: "Takes the role away from the holder. The last space admin cannot be removed.",
    tags: [TAG],
    params: permissionParams,
    errors: ["permissionNotFound", "lastSpaceAdmin"],
  })
  async remove(
    @Param("spaceId") spaceId: string,
    @Param("permissionId") permissionId: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.spacePermissions.apply(actorOf(request), spaceId, {
      action: "remove",
      permissionId,
    });
  }
}
