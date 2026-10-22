import {
  ScimError,
  scimErrorBody,
  scimResourceTypes,
  scimSchemaDefinitions,
  scimServiceProviderConfig,
} from "@lunedo/server";
import {
  type ArgumentsHost,
  Body,
  Catch,
  Controller,
  Delete,
  type ExceptionFilter,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseFilters,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { InternalRoute, ScimTokenRoute } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ownOrigin } from "../http/csrf.js";
import { instanceUrlOf } from "../http/instance-url.js";

const SCIM_JSON = "application/scim+json";

export function scimPath(providerId: string): string {
  return `/scim/v2/${providerId}`;
}

@Catch()
export class ScimErrorFilter implements ExceptionFilter {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  catch(error: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    let scim: ScimError;
    if (error instanceof ScimError) scim = error;
    else if ((error as { statusCode?: unknown }).statusCode === 400 || error instanceof SyntaxError) {
      scim = new ScimError(400, "invalidSyntax", "The request body is not valid JSON");
    } else if ((error as { statusCode?: unknown }).statusCode === 415) {
      scim = new ScimError(415, null, "Send the body as application/scim+json or application/json");
    } else {
      this.context.logger.error({ err: error }, "SCIM request failed");
      scim = new ScimError(500, null, "The request failed on the server; try again later");
    }
    if (scim.retryAfterSeconds !== undefined) reply.header("retry-after", String(scim.retryAfterSeconds));
    void reply.status(scim.status).type(SCIM_JSON).send(scimErrorBody(scim));
  }
}

interface ListQuery {
  filter?: string;
  startIndex?: string;
  count?: string;
  excludedAttributes?: string;
}

function numberOf(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed))
    throw new ScimError(400, "invalidValue", "startIndex and count must be numbers");
  return parsed;
}

function withMembers(query: { excludedAttributes?: string }): boolean {
  return !(query.excludedAttributes ?? "")
    .split(",")
    .some((attribute) => attribute.trim().toLowerCase() === "members");
}

@Controller("scim/v2/:providerId")
@InternalRoute()
@ScimTokenRoute()
@UseFilters(ScimErrorFilter)
export class ScimController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #scim() {
    return servicesOf(this.context).scim;
  }

  async #base(request: FastifyRequest, providerId: string): Promise<string> {
    const instance = (await instanceUrlOf(this.context)) || ownOrigin(request);
    return `${instance}${scimPath(providerId)}`;
  }

  #page(query: ListQuery) {
    return {
      filter: query.filter,
      startIndex: numberOf(query.startIndex),
      count: numberOf(query.count),
    };
  }

  @Get("ServiceProviderConfig")
  @Header("content-type", SCIM_JSON)
  async serviceProviderConfig(@Param("providerId") providerId: string, @Req() request: FastifyRequest) {
    await this.#scim.admit(providerId);
    const instance = (await instanceUrlOf(this.context)) || ownOrigin(request);
    return scimServiceProviderConfig(`${instance}/api/docs`);
  }

  @Get("ResourceTypes")
  @Header("content-type", SCIM_JSON)
  async resourceTypes(@Param("providerId") providerId: string, @Req() request: FastifyRequest) {
    await this.#scim.admit(providerId);
    const types = scimResourceTypes(await this.#base(request, providerId));
    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: types.length,
      Resources: types,
    };
  }

  @Get("Schemas")
  @Header("content-type", SCIM_JSON)
  async schemas(@Param("providerId") providerId: string, @Req() request: FastifyRequest) {
    await this.#scim.admit(providerId);
    const schemas = scimSchemaDefinitions(await this.#base(request, providerId));
    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: schemas.length,
      Resources: schemas,
    };
  }

  @Get("Users")
  @Header("content-type", SCIM_JSON)
  async listUsers(
    @Param("providerId") providerId: string,
    @Query() query: ListQuery,
    @Req() request: FastifyRequest,
  ) {
    return this.#scim.listUsers(providerId, await this.#base(request, providerId), this.#page(query));
  }

  @Post("Users")
  @HttpCode(201)
  @Header("content-type", SCIM_JSON)
  async createUser(
    @Param("providerId") providerId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const user = await this.#scim.createUser(providerId, await this.#base(request, providerId), body);
    reply.header("location", user.meta.location);
    return user;
  }

  @Get("Users/:id")
  @Header("content-type", SCIM_JSON)
  async getUser(
    @Param("providerId") providerId: string,
    @Param("id") id: string,
    @Req() request: FastifyRequest,
  ) {
    return this.#scim.getUser(providerId, await this.#base(request, providerId), id);
  }

  @Put("Users/:id")
  @Header("content-type", SCIM_JSON)
  async replaceUser(
    @Param("providerId") providerId: string,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.#scim.replaceUser(providerId, await this.#base(request, providerId), id, body);
  }

  @Patch("Users/:id")
  @Header("content-type", SCIM_JSON)
  async patchUser(
    @Param("providerId") providerId: string,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.#scim.patchUser(providerId, await this.#base(request, providerId), id, body);
  }

  @Delete("Users/:id")
  @HttpCode(204)
  async deleteUser(@Param("providerId") providerId: string, @Param("id") id: string) {
    await this.#scim.deleteUser(providerId, id);
  }

  @Get("Groups")
  @Header("content-type", SCIM_JSON)
  async listGroups(
    @Param("providerId") providerId: string,
    @Query() query: ListQuery,
    @Req() request: FastifyRequest,
  ) {
    return this.#scim.listGroups(
      providerId,
      await this.#base(request, providerId),
      this.#page(query),
      withMembers(query),
    );
  }

  @Post("Groups")
  @HttpCode(201)
  @Header("content-type", SCIM_JSON)
  async createGroup(
    @Param("providerId") providerId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const group = await this.#scim.createGroup(providerId, await this.#base(request, providerId), body);
    reply.header("location", group.meta.location);
    return group;
  }

  @Get("Groups/:id")
  @Header("content-type", SCIM_JSON)
  async getGroup(
    @Param("providerId") providerId: string,
    @Param("id") id: string,
    @Query() query: { excludedAttributes?: string },
    @Req() request: FastifyRequest,
  ) {
    return this.#scim.getGroup(providerId, await this.#base(request, providerId), id, withMembers(query));
  }

  @Put("Groups/:id")
  @Header("content-type", SCIM_JSON)
  async replaceGroup(
    @Param("providerId") providerId: string,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.#scim.replaceGroup(providerId, await this.#base(request, providerId), id, body);
  }

  @Patch("Groups/:id")
  @Header("content-type", SCIM_JSON)
  async patchGroup(
    @Param("providerId") providerId: string,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ) {
    return this.#scim.patchGroup(providerId, await this.#base(request, providerId), id, body);
  }

  @Delete("Groups/:id")
  @HttpCode(204)
  async deleteGroup(@Param("providerId") providerId: string, @Param("id") id: string) {
    await this.#scim.deleteGroup(providerId, id);
  }
}
