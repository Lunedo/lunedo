import {
  accountPrincipal,
  type FactorAdded,
  PICTURE_MAX_BYTES,
  type RegistrationResponseJSON,
} from "@lunedo/server";
import { accountNameSchema, idSchema, jobTitleSchema } from "@lunedo/shared";
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { InternalRoute, SessionRoute } from "../access/route-access.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { COOKIES, clearCookie } from "../http/cookies.js";
import { pageQuerySchema, pageSchema, paginate } from "../http/pagination.js";
import { notFound } from "../http/problems.js";
import { sessionOf } from "../http/request.js";
import { jobTitleField, pictureRefField, settingSchema } from "../http/schemas.js";
import { definitionFor, listSettings, updateSetting } from "../http/settings.js";
import { servicesOf, setSessionCookie } from "./auth.controller.js";
import {
  accountSessionSchema,
  creationOptionsSchema,
  endedSchema,
  idParams,
  newEmailSchema,
  newPasswordSchema,
  passkeyAddedSchema,
  passkeyRegistrationSchema,
  recoveryCodesSchema,
  securityOverviewSchema,
  totpConfirmationSchema,
  totpSetupSchema,
} from "./schemas.js";

const preferenceParams = z.object({ key: z.string().max(200) }).strict();
const preferenceUpdateSchema = z.union([
  z.object({ value: z.json() }).strict(),
  z.object({ clear: z.literal(true) }).strict(),
]);
const permissionsQuery = z.object({ organizationId: idSchema.optional() }).strict();
const levelSchema = z.enum(["view", "manage"]);

const withheldRoleSchema = z
  .object({
    assignmentId: idSchema.describe("ID of the role assignment."),
    scope: z.enum(["instance", "organization"]).describe("Where the role applies."),
    organizationId: idSchema.nullable().describe("The organization of the role, or null."),
    organizationName: z.string().nullable().describe("Name of the organization, or null."),
    builtInRole: z.string().nullable().describe("Key of the built-in role, or null for a custom role."),
    roleName: z.string().nullable().describe("Name of the custom role, or null."),
    providerName: z.string().describe("The identity provider whose groups could not be read."),
    groupsReadAt: z.iso.datetime().nullable().describe("When the groups were last read, or null."),
  })
  .describe("A role that is paused because the groups of the account could not be read.");

const profileSchema = z
  .object({
    name: z.string().describe("Display name."),
    jobTitle: jobTitleField,
    pictureRef: pictureRefField,
    nameProvider: z
      .string()
      .nullable()
      .describe(
        "Name of the identity provider the display name comes from, or null when the person sets it. The name cannot be changed here while a provider sets it.",
      ),
  })
  .describe("The own profile.");

const exampleProfile = {
  name: "Ada Lovelace",
  jobTitle: "Head of Engineering",
  pictureRef: "5f2b8c1d9a0e4b7c",
  nameProvider: null,
};

const profileUpdateSchema = z
  .object({
    name: accountNameSchema.optional().describe("New display name, 1 to 200 characters."),
    jobTitle: jobTitleSchema
      .nullable()
      .optional()
      .describe("New job title, at most 100 characters. An empty text or null removes it."),
  })
  .strict()
  .describe("Fields to change. Fields that are left out stay as they are.");

const pictureBody = z
  .object({
    contentType: z.enum(["image/png", "image/jpeg", "image/webp"]).describe("Type of the image."),
    data: z
      .base64()
      .max(Math.ceil(PICTURE_MAX_BYTES / 3) * 4)
      .describe("The image, Base64-encoded."),
  })
  .strict()
  .describe("A profile picture.");

const permissionsSchema = z.object({
  instance: z.array(z.string()),
  organization: z.array(z.string()),
  grantableAreas: z
    .object({
      instance: z
        .record(z.string(), levelSchema)
        .describe("Areas and levels the account may grant on the instance."),
      organization: z
        .record(z.string(), levelSchema)
        .describe("Areas and levels the account may grant in the organization, if asked for."),
    })
    .describe("What the account may pass on in roles; nobody grants more than they hold permanently."),
});

@Controller("api/v1/account")
@InternalRoute()
export class AccountController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  async #factorAdded(reply: FastifyReply, added: FactorAdded) {
    if (added.token) await setSessionCookie(this.context, reply, added.token);
    return { recoveryCodes: added.recoveryCodes };
  }

  @Get("preferences")
  @SessionRoute({ portalAccounts: true, secondFactorSetup: true })
  @ApiRoute({
    summary: "List own preferences",
    tags: ["Account"],
    response: { description: "Settings that apply to the account.", schema: z.array(settingSchema) },
  })
  async preferences(@Req() request: FastifyRequest) {
    const { settings, settingsRegistry } = this.#settingsServices();
    return listSettings(settings, settingsRegistry, "user", await this.#chain(request));
  }

  @Put("preferences/:key")
  @SessionRoute({ portalAccounts: true, secondFactorSetup: true })
  @ApiRoute({
    summary: "Change an own preference",
    tags: ["Account"],
    params: preferenceParams,
    body: preferenceUpdateSchema,
    errors: ["invalidSetting", "settingLocked"],
  })
  async updatePreference(
    @Param("key") key: string,
    @Body() body: z.output<typeof preferenceUpdateSchema>,
    @Req() request: FastifyRequest,
  ) {
    const { settings, settingsRegistry } = this.#settingsServices();
    const definition = definitionFor(settingsRegistry, key, "user");
    await updateSetting(settings, definition, "user", await this.#chain(request), body);
  }

  @Get("profile")
  @SessionRoute()
  @ApiRoute({
    summary: "Get the own profile",
    tags: ["Account"],
    response: { description: "The profile.", schema: profileSchema, example: exampleProfile },
  })
  async profile(@Req() request: FastifyRequest) {
    return this.#services.profiles.get(sessionOf(request).accountId);
  }

  @Patch("profile")
  @SessionRoute()
  @ApiRoute({
    summary: "Change the own profile",
    description:
      "Changes the display name or the job title. The display name stays as it is while an identity provider sets it.",
    tags: ["Account"],
    body: profileUpdateSchema,
    bodyExample: { jobTitle: "Head of Engineering" },
    response: { description: "The changed profile.", schema: profileSchema, example: exampleProfile },
    errors: ["nameFromProvider"],
  })
  async updateProfile(@Body() body: z.output<typeof profileUpdateSchema>, @Req() request: FastifyRequest) {
    return this.#services.profiles.update(sessionOf(request).accountId, body);
  }

  @Put("profile/picture")
  @SessionRoute()
  @ApiRoute({
    summary: "Upload a profile picture",
    description: "Sets the picture shown next to the own name. PNG, JPEG or WebP, at most 256 KiB.",
    tags: ["Account"],
    body: pictureBody,
    bodyExample: { contentType: "image/png", data: "iVBORw0KGgo=" },
    response: {
      description: "The profile with its new picture.",
      schema: profileSchema,
      example: exampleProfile,
    },
    errors: ["invalidPicture", "storageFull"],
  })
  async uploadPicture(@Body() body: z.output<typeof pictureBody>, @Req() request: FastifyRequest) {
    return this.#services.profiles.setPicture(sessionOf(request).accountId, {
      contentType: body.contentType,
      data: Buffer.from(body.data, "base64"),
    });
  }

  @Delete("profile/picture")
  @SessionRoute()
  @ApiRoute({
    summary: "Remove the profile picture",
    description: "Removes the picture. Others see the initials again.",
    tags: ["Account"],
    response: {
      description: "The profile without a picture.",
      schema: profileSchema,
      example: { ...exampleProfile, pictureRef: null },
    },
  })
  async removePicture(@Req() request: FastifyRequest) {
    return this.#services.profiles.removePicture(sessionOf(request).accountId);
  }

  @Get("withheld-roles")
  @SessionRoute({ secondFactorSetup: true })
  @ApiRoute({
    summary: "List own paused roles",
    description:
      "Administrative roles granted by mapping rules are paused while the groups of the account could not be read from its identity provider for longer than twice the provider's sync interval. They return at the next successful read.",
    tags: ["Account"],
    response: { description: "The paused roles.", schema: z.array(withheldRoleSchema) },
  })
  async withheldRoles(@Req() request: FastifyRequest) {
    return this.#services.administration.withheldRoles(sessionOf(request).accountId);
  }

  @Get("permissions")
  @SessionRoute({ secondFactorSetup: true })
  @ApiRoute({
    summary: "List own permissions",
    tags: ["Account"],
    query: permissionsQuery,
    response: {
      description: "Allowed actions on the instance and, if asked for, on one organization.",
      schema: permissionsSchema,
    },
  })
  async permissions(@Req() request: FastifyRequest, @Query() query: z.output<typeof permissionsQuery>) {
    const authorization = this.#services.authorization;
    const principal = accountPrincipal(sessionOf(request).accountId);
    const allowed = async (type: "instance" | "organization", id?: string) => {
      const actions = authorization.registry.actions().filter((action) => action.resourceType.type === type);
      const decisions = await Promise.all(
        actions.map((action) => authorization.explain(principal, action.name, id ? { type, id } : { type })),
      );
      return decisions.filter((decision) => decision.allowed).map((decision) => decision.action);
    };
    return {
      instance: await allowed("instance"),
      organization: query.organizationId ? await allowed("organization", query.organizationId) : [],
      grantableAreas: {
        instance: await authorization.grantableAreas(principal, "instance", null),
        organization: query.organizationId
          ? await authorization.grantableAreas(principal, "organization", query.organizationId)
          : {},
      },
    };
  }

  #settingsServices() {
    const { settings, settingsRegistry } = this.context;
    if (!settings || !settingsRegistry) throw new Error("The settings are not available");
    return { settings, settingsRegistry };
  }

  #chain(request: FastifyRequest) {
    return this.#services.accounts.settingsChain(sessionOf(request).accountId);
  }

  @Get("security")
  @SessionRoute({ portalAccounts: true, secondFactorSetup: true })
  @ApiRoute({
    summary: "Get the security overview",
    tags: ["Account"],
    response: { description: "Second factors of the account.", schema: securityOverviewSchema },
  })
  async security(@Req() request: FastifyRequest) {
    return this.#services.security.overview(sessionOf(request).accountId);
  }

  @Post("password")
  @SessionRoute({ portalAccounts: true, recentAuthentication: true })
  @ApiRoute({
    summary: "Change the password",
    tags: ["Account"],
    body: newPasswordSchema,
    errors: ["passwordPolicy"],
  })
  async changePassword(
    @Body() body: z.output<typeof newPasswordSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const { token } = await this.#services.security.changePassword(sessionOf(request), body.password);
    await setSessionCookie(this.context, reply, token);
  }

  @Post("email")
  @SessionRoute({ portalAccounts: true, recentAuthentication: true })
  @ApiRoute({
    summary: "Change the e-mail address",
    tags: ["Account"],
    status: 202,
    body: newEmailSchema,
    errors: ["emailInUse", "sameEmail", "rateLimited"],
  })
  async changeEmail(@Body() body: z.output<typeof newEmailSchema>, @Req() request: FastifyRequest) {
    await this.#services.security.requestEmailChange(sessionOf(request), body.email);
  }

  @Post("totp")
  @SessionRoute({ portalAccounts: true, secondFactorSetup: true, recentAuthentication: true })
  @ApiRoute({
    summary: "Start authenticator setup",
    tags: ["Account"],
    status: 200,
    response: { description: "Secret and URI for the app.", schema: totpSetupSchema },
    errors: ["secondFactorExists"],
  })
  async beginTotp(@Req() request: FastifyRequest) {
    return this.#services.security.beginTotp(sessionOf(request));
  }

  @Post("totp/confirm")
  @SessionRoute({ portalAccounts: true, secondFactorSetup: true, recentAuthentication: true })
  @ApiRoute({
    summary: "Confirm authenticator setup",
    tags: ["Account"],
    status: 200,
    body: totpConfirmationSchema,
    response: { description: "New recovery codes, if any.", schema: recoveryCodesSchema },
    errors: ["invalidSecondFactor"],
  })
  async confirmTotp(
    @Body() body: z.output<typeof totpConfirmationSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.#factorAdded(reply, await this.#services.security.confirmTotp(sessionOf(request), body.code));
  }

  @Delete("totp")
  @SessionRoute({ portalAccounts: true, recentAuthentication: true })
  @ApiRoute({ summary: "Remove the authenticator app", tags: ["Account"], errors: ["lastSecondFactor"] })
  async removeTotp(@Req() request: FastifyRequest) {
    if (!(await this.#services.security.removeTotp(sessionOf(request)))) throw notFound();
  }

  @Post("passkeys/registration-options")
  @SessionRoute({ portalAccounts: true, secondFactorSetup: true, recentAuthentication: true })
  @ApiRoute({
    summary: "Start passkey registration",
    tags: ["Account"],
    status: 200,
    response: { description: "Options for the browser.", schema: creationOptionsSchema },
    errors: ["instanceUrlMissing"],
  })
  async passkeyRegistrationOptions(@Req() request: FastifyRequest) {
    return this.#services.security.passkeyRegistrationOptions(sessionOf(request));
  }

  @Post("passkeys")
  @SessionRoute({ portalAccounts: true, secondFactorSetup: true, recentAuthentication: true })
  @ApiRoute({
    summary: "Register a passkey",
    tags: ["Account"],
    status: 201,
    body: passkeyRegistrationSchema,
    response: { description: "The passkey and new recovery codes, if any.", schema: passkeyAddedSchema },
    errors: ["challengeExpired", "invalidSecondFactor"],
  })
  async registerPasskey(
    @Body() body: z.output<typeof passkeyRegistrationSchema>,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const added = await this.#services.security.registerPasskey(
      sessionOf(request),
      body.response as RegistrationResponseJSON,
      body.name,
    );
    return { passkey: added.passkey, ...(await this.#factorAdded(reply, added)) };
  }

  @Delete("passkeys/:id")
  @SessionRoute({ portalAccounts: true, recentAuthentication: true })
  @ApiRoute({
    summary: "Remove a passkey",
    tags: ["Account"],
    params: idParams,
    errors: ["lastSecondFactor"],
  })
  async removePasskey(@Param("id") id: string, @Req() request: FastifyRequest) {
    if (!(await this.#services.security.removePasskey(sessionOf(request), id))) throw notFound();
  }

  @Post("recovery-codes")
  @SessionRoute({ portalAccounts: true, recentAuthentication: true })
  @ApiRoute({
    summary: "Generate recovery codes",
    tags: ["Account"],
    status: 200,
    response: { description: "The new codes.", schema: recoveryCodesSchema },
  })
  async generateRecoveryCodes(@Req() request: FastifyRequest) {
    return { recoveryCodes: await this.#services.security.generateRecoveryCodes(sessionOf(request)) };
  }

  @Get("sessions")
  @SessionRoute({ portalAccounts: true })
  @ApiRoute({
    summary: "List sessions",
    tags: ["Account"],
    query: pageQuerySchema,
    response: {
      description: "Sessions of the account.",
      schema: pageSchema(accountSessionSchema, "Sessions, newest first."),
    },
  })
  async sessions(@Req() request: FastifyRequest, @Query() query: z.output<typeof pageQuerySchema>) {
    const current = sessionOf(request);
    const sessions = await this.#services.sessions.list(current.accountId);
    const items = sessions.map((session) => ({
      id: session.id,
      current: session.id === current.id,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      clientIp: session.clientIp,
      browser: session.browser,
      operatingSystem: session.operatingSystem,
      methods: session.methods,
    }));
    return paginate(items, (item) => [-item.lastUsedAt.getTime(), item.id], query);
  }

  @Delete("sessions/:id")
  @SessionRoute({ portalAccounts: true })
  @ApiRoute({ summary: "End a session", tags: ["Account"], params: idParams })
  async endSession(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const current = sessionOf(request);
    if (!(await this.#services.sessions.end(current.accountId, id, "endedByAccount"))) throw notFound();
    if (id === current.id) clearCookie(reply, COOKIES.session);
  }

  @Post("sessions/end-others")
  @SessionRoute({ portalAccounts: true })
  @ApiRoute({
    summary: "End all other sessions",
    tags: ["Account"],
    status: 200,
    response: { description: "Number of ended sessions.", schema: endedSchema },
  })
  async endOtherSessions(@Req() request: FastifyRequest) {
    const current = sessionOf(request);
    return { ended: await this.#services.sessions.endOthers(current.accountId, current.id) };
  }
}
