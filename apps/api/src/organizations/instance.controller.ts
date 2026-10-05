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
import {
  accentColorSetting,
  instanceNameSetting,
  languageSetting,
  organizationSettingsChain,
  passwordMinLengthSetting,
  roleNameSchema,
  supportedLanguages,
} from "@pagehall/server";
import {
  accentColors,
  accountNameSchema,
  emailSchema,
  idSchema,
  type MailMethod,
  mailMethods,
  smtpConfigurationSchema,
  smtpInputSchema,
  smtpTestInputSchema,
  smtpTestResultSchema,
} from "@pagehall/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { InternalRoute, Permission, PublicRoute } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import {
  accountDetailSchema,
  administeredAccountSchema,
  administeredOrganizationSchema,
  exampleAdministeredAccount,
  exampleAdministeredOrganization,
} from "../http/administration-schemas.js";
import { ApiRoute } from "../http/api-route.js";
import {
  idCursor,
  nameCursor,
  pageQuerySchema,
  pageRequest,
  pageSchema,
  paginate,
  searchQuerySchema,
  toApiPage,
} from "../http/pagination.js";
import { notFound } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import {
  customRoleSchema,
  exampleAccount,
  exampleSetting,
  instanceAreasSchema,
  optionalExpiry,
  roleAssignmentSchema,
  settingSchema,
  timestamp,
  uuid,
} from "../http/schemas.js";
import { definitionFor, listSettings, settingUpdateSchema, updateSetting } from "../http/settings.js";

const TAG = "Instance";

const instanceInfoSchema = z.object({
  name: z.string(),
  setupComplete: z.boolean(),
  language: z.enum(supportedLanguages),
  accentColor: z.enum(accentColors),
  passwordMinLength: z.number().int(),
  selfRegistration: z.boolean(),
  organization: z
    .object({
      id: idSchema,
      name: z.string(),
      logoRef: z.string().nullable(),
      accentColor: z.enum(accentColors),
    })
    .nullable(),
});

const breakGlassEntrySchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  organizationName: z.string(),
  accountId: idSchema,
  accountName: z.string(),
  reason: z.string(),
  startedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
});

const customRoleBody = z
  .object({
    name: roleNameSchema.describe("Name of the role, 1 to 100 characters, unique at the instance level."),
    areas: instanceAreasSchema,
  })
  .strict()
  .describe("A new instance role. Nobody can define a role with more than they hold themselves.");

const customRoleUpdateBody = z
  .object({
    name: roleNameSchema.optional().describe("New name of the role."),
    areas: instanceAreasSchema.optional().describe("New access levels. Replaces all areas."),
  })
  .strict()
  .describe("Fields to change.");

const roleParams = z.object({ roleId: uuid("ID of the instance role.") }).strict();
const assignmentParams = z.object({ assignmentId: uuid("ID of the role assignment.") }).strict();
const settingParams = z.object({ key: z.string().max(200).describe("Key of the setting.") }).strict();

const assignmentBody = z
  .object({
    role: z
      .union([
        z
          .object({
            builtIn: z
              .enum(["administrator", "securityAuditor"])
              .describe("Key of the built-in instance role."),
          })
          .strict()
          .describe("A built-in role."),
        z
          .object({ customRoleId: uuid("ID of an instance role.") })
          .strict()
          .describe("A custom role."),
      ])
      .describe("The role to give."),
    principal: z
      .discriminatedUnion("kind", [
        z
          .object({ kind: z.literal("account").describe("One account."), id: uuid("ID of the account.") })
          .strict()
          .describe("An internal account."),
        z
          .object({ kind: z.literal("instanceUsers").describe("Every internal user.") })
          .strict()
          .describe("All internal users."),
      ])
      .describe(
        "Who receives the role. All internal users are refused with `roleNeedsAccountOrGroup`: instance roles go to individual accounts only.",
      ),
    expiresAt: optionalExpiry("When the assignment ends."),
  })
  .strict()
  .describe("An instance role assignment.");

const batchAssignmentBody = z
  .object({
    role: assignmentBody.shape.role,
    principals: z
      .array(
        z
          .object({ kind: z.literal("account").describe("One account."), id: uuid("ID of the account.") })
          .strict()
          .describe("An internal account."),
      )
      .min(1)
      .max(50)
      .describe("Accounts that receive the role, 1 to 50."),
    expiresAt: optionalExpiry("When the assignments end."),
  })
  .strict()
  .describe("One instance role for several accounts. Either all assignments are made or none.");

const ownershipSchema = z
  .object({ accountId: uuid("Account that becomes the instance owner.") })
  .strict()
  .describe("The new owner.");

const exampleInstanceRole = {
  id: "01929b1f-6fd3-7a07-a8d4-cfb1b29ce3f4",
  scope: "instance",
  organizationId: null,
  name: "Operators",
  areas: { operations: "manage", auditLog: "view" },
};

const exampleInstanceAssignment = {
  id: "01929b1f-80e4-7b18-b9e5-d0c2c3adf405",
  scope: "instance",
  organizationId: null,
  role: "securityAuditor",
  builtInRole: "securityAuditor",
  customRoleId: null,
  principalKind: "account",
  principalId: exampleAccount.id,
  expiresAt: null,
};

function settingPermission(key: string): string {
  if (key.startsWith("auth.")) return "instance.signIn.manage";
  if (key.startsWith("audit.")) return "instance.audit.manage";
  if (key.startsWith("organizations.")) return "instance.organizations.manage";
  return "instance.settings.manage";
}

const byName = (item: { name: string; id: string }) => [item.name.toLowerCase(), item.id];

const graphMailInputSchema = z
  .object({
    tenantId: z.string().describe("Directory (tenant) ID of the app registration."),
    clientId: z.string().describe("Application (client) ID of the app registration."),
    sender: z.string().describe("The mailbox Pagehall sends from. The app may send only as this mailbox."),
    senderName: z
      .string()
      .nullable()
      .optional()
      .describe("Name shown as sender, or null for the mailbox name."),
    authority: z
      .string()
      .optional()
      .describe("Sign-in authority of the Microsoft cloud; the global cloud by default."),
    graphUrl: z.string().optional().describe("Microsoft Graph endpoint of that cloud."),
  })
  .strict()
  .describe("Settings for sending e-mail through Microsoft Graph.");

const graphMailSchema = z
  .object({
    tenantId: z.string().describe("Directory (tenant) ID."),
    clientId: z.string().describe("Application (client) ID."),
    sender: z.string().describe("Sender mailbox."),
    senderName: z.string().nullable().describe("Name shown as sender, or null."),
    authority: z.string().describe("Sign-in authority."),
    graphUrl: z.string().describe("Microsoft Graph endpoint."),
  })
  .describe("Settings for sending e-mail through Microsoft Graph.");

const mailCredentialSchema = z
  .object({
    id: uuid("ID of the credential."),
    kind: z.enum(["clientSecret", "certificate"]).describe("Client secret or certificate."),
    keyId: z.string().nullable().describe("Thumbprint of the certificate, or null."),
    expiresAt: timestamp("When it expires, or null.").nullable(),
    createdAt: timestamp("When it was added."),
  })
  .describe("A credential of the app registration.");

const addedMailCredentialSchema = mailCredentialSchema
  .extend({ certificate: z.string().nullable().describe("The public certificate in PEM format, or null.") })
  .describe("The added credential.");

const mailCredentialInputSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("clientSecret").describe("A client secret from the app registration."),
        secret: z.string().min(1).max(4096).describe("The secret value."),
        expiresAt: z.iso.datetime().nullable().describe("When the secret expires, as shown in Entra ID."),
      })
      .strict(),
    z
      .object({
        kind: z.literal("certificate").describe("A certificate Pagehall creates."),
        validDays: z.number().int().min(30).max(1095).describe("How long the certificate is valid, in days."),
      })
      .strict(),
  ])
  .describe("A credential to add.");

const graphMailTestSchema = z
  .object({
    to: emailSchema.describe("Recipient of the test e-mail."),
    language: z.enum(supportedLanguages).default("en").describe("Language of the test e-mail."),
    configuration: graphMailInputSchema.optional(),
  })
  .strict()
  .describe("A test e-mail through Microsoft Graph.");

const mailSettingsSchema = z
  .object({
    smtp: smtpConfigurationSchema.nullable(),
    passwordSet: z.boolean(),
    method: z.enum(mailMethods).describe("How e-mail is sent."),
    graph: graphMailSchema.nullable(),
    graphCredentials: z
      .array(mailCredentialSchema)
      .describe("Credentials of the app registration, newest first."),
  })
  .describe("The e-mail settings.");

const accountListQuerySchema = searchQuerySchema
  .extend({
    withoutOrganization: z
      .enum(["true", "false"])
      .optional()
      .describe("With true, only accounts without any current membership in an organization."),
    state: z
      .enum(["active", "deactivated", "anonymized", "placeholder"])
      .optional()
      .describe("Only accounts in this lifecycle state."),
  })
  .strict();

const placeholderSchema = z
  .object({
    name: accountNameSchema.describe("Name of the person, as content will show it."),
    email: emailSchema.describe(
      "E-mail address of the person. A verified sign-in with this address turns the placeholder into the account.",
    ),
  })
  .strict()
  .describe("A person who has no account yet.");

const mergeSchema = z
  .object({ accountId: uuid("ID of the account that takes over the placeholder.") })
  .strict()
  .describe("The account to merge the placeholder into.");

const mergedSchema = z
  .object({
    memberships: z.number().int().describe("Memberships the placeholder had."),
    groups: z.number().int().describe("Group memberships the placeholder had."),
    roles: z.number().int().describe("Role assignments the placeholder had."),
  })
  .describe("What moved from the placeholder to the account.");

const anonymizeSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe(
        "Why the account is anonymized, 1 to 500 characters. Kept in the audit log; do not name the person.",
      ),
    confirmation: z.string().max(200).describe("The current name of the account, typed to confirm."),
  })
  .strict()
  .describe("Confirmation of the anonymization.");

const anonymizedSchema = z
  .object({
    endedSessions: z.number().int().describe("Sessions that ended."),
    removedIdentities: z.number().int().describe("Linked identities that were removed."),
    endedMemberships: z.number().int().describe("Memberships that ended."),
  })
  .describe("What the anonymization removed.");

@Controller("api/v1/instance")
export class InstanceController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("info")
  @PublicRoute()
  @InternalRoute()
  @ApiRoute({
    summary: "Get public instance information",
    tags: [TAG],
    response: { description: "What the sign-in and setup pages show.", schema: instanceInfoSchema },
  })
  async info() {
    const { settings } = this.#settingsServices();
    const services = this.#services;
    const setupComplete = await services.setup.isComplete();
    const first = setupComplete ? await services.organizations.list({ limit: 2 }) : { items: [] };
    const only = first.items.length === 1 ? first.items[0] : undefined;
    return {
      name: await settings.get(instanceNameSetting, {}),
      setupComplete,
      language: await settings.get(languageSetting, {}),
      accentColor: await settings.get(accentColorSetting, {}),
      passwordMinLength: await settings.get(passwordMinLengthSetting, {}),
      selfRegistration: setupComplete ? await services.invitations.selfRegistrationOpen() : false,
      organization: only
        ? {
            id: only.id,
            name: only.name,
            logoRef: only.logoRef,
            accentColor: await settings.get(accentColorSetting, organizationSettingsChain(only.id)),
          }
        : null,
    };
  }

  @Get("break-glass")
  @Permission("instance.organizations.view")
  @InternalRoute()
  @ApiRoute({
    summary: "List recent break-glass access",
    tags: [TAG],
    query: pageQuerySchema,
    response: {
      description: "Break-glass access of the last 90 days, newest first.",
      schema: pageSchema(breakGlassEntrySchema, "Break-glass access, newest first."),
    },
  })
  async breakGlass(@Query() query: z.output<typeof pageQuerySchema>) {
    const entries = await this.#services.breakGlass.recent(90);
    return paginate(entries, (entry) => [-entry.startedAt.getTime(), entry.id], query);
  }

  @Get("mail")
  @Permission("instance.settings.view")
  @InternalRoute()
  @ApiRoute({
    summary: "Get the e-mail settings",
    tags: [TAG],
    response: {
      description: "The sending method, the SMTP and Microsoft Graph settings, without passwords or secrets.",
      schema: mailSettingsSchema,
    },
  })
  async mail() {
    const mail = this.#services.mail;
    return {
      smtp: await mail.smtpConfiguration(),
      passwordSet: await mail.hasSmtpPassword(),
      method: await mail.method(),
      graph: await mail.graphConfiguration(),
      graphCredentials: await mail.graphCredentials(),
    };
  }

  @Put("mail/method")
  @Permission("instance.settings.manage", { type: "instance" }, { recentAuthentication: true })
  @InternalRoute()
  @ApiRoute({
    summary: "Choose how e-mail is sent",
    tags: [TAG],
    body: z.object({ method: z.enum(mailMethods).describe("SMTP or Microsoft Graph.") }).strict(),
    errors: ["mailNotReady", "reauthenticationRequired"],
  })
  async setMailMethod(@Body() body: { method: MailMethod }, @Req() request: FastifyRequest) {
    await this.#services.mail.setMethod(actorOf(request), body.method);
  }

  @Put("mail/graph")
  @Permission("instance.settings.manage", { type: "instance" }, { recentAuthentication: true })
  @InternalRoute()
  @ApiRoute({
    summary: "Configure e-mail through Microsoft Graph",
    tags: [TAG],
    body: graphMailInputSchema,
    errors: ["invalidMailConfiguration", "reauthenticationRequired"],
  })
  async configureGraphMail(@Body() body: unknown, @Req() request: FastifyRequest) {
    await this.#services.mail.configureGraph(actorOf(request), body);
  }

  @Post("mail/graph/credentials")
  @Permission("instance.settings.manage", { type: "instance" }, { recentAuthentication: true })
  @InternalRoute()
  @ApiRoute({
    summary: "Add a credential for e-mail through Microsoft Graph",
    tags: [TAG],
    status: 201,
    body: mailCredentialInputSchema,
    response: {
      description: "The credential, with the certificate to upload to the app registration.",
      schema: addedMailCredentialSchema,
    },
    errors: ["expiryInPast", "invalidInput", "reauthenticationRequired"],
  })
  async addGraphMailCredential(
    @Body() body: z.output<typeof mailCredentialInputSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.mail.addGraphCredential(
      actorOf(request),
      body.kind === "clientSecret"
        ? {
            kind: "clientSecret",
            secret: body.secret,
            expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
          }
        : body,
    );
  }

  @Delete("mail/graph/credentials/:credentialId")
  @Permission("instance.settings.manage", { type: "instance" }, { recentAuthentication: true })
  @InternalRoute()
  @ApiRoute({
    summary: "Remove a credential for e-mail through Microsoft Graph",
    tags: [TAG],
    params: z.object({ credentialId: uuid("ID of the credential.") }).strict(),
    errors: ["lastCredential", "notFound", "reauthenticationRequired"],
  })
  async removeGraphMailCredential(
    @Param("credentialId") credentialId: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.mail.removeGraphCredential(actorOf(request), credentialId);
  }

  @Get("mail/graph/credentials/:credentialId/certificate")
  @Permission("instance.settings.view")
  @InternalRoute()
  @ApiRoute({
    summary: "Download the certificate of a Microsoft Graph credential",
    tags: [TAG],
    params: z.object({ credentialId: uuid("ID of the credential.") }).strict(),
    raw: {
      contentTypes: ["application/x-pem-file"],
      description: "The public certificate in PEM format.",
      example: "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n",
    },
    errors: ["notFound"],
  })
  async graphMailCertificate(
    @Param("credentialId") credentialId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const pem = await this.#services.mail.graphCertificate(credentialId);
    reply
      .type("application/x-pem-file")
      .header("content-disposition", 'attachment; filename="pagehall-mail.pem"');
    return pem;
  }

  @Post("mail/graph/test")
  @Permission("instance.settings.manage", { type: "instance" }, { recentAuthentication: true })
  @InternalRoute()
  @ApiRoute({
    summary: "Send a test e-mail through Microsoft Graph",
    description:
      "Sends with the given settings, or the stored ones without them, and the stored credentials. Errors name what failed: a mailbox outside the scope of the app, a missing permission, an unknown mailbox or an expired or wrong credential.",
    tags: [TAG],
    status: 200,
    body: graphMailTestSchema,
    response: { description: "Whether Microsoft Graph accepted the e-mail.", schema: smtpTestResultSchema },
    errors: ["invalidMailConfiguration"],
  })
  async testGraphMail(@Body() body: z.output<typeof graphMailTestSchema>, @Req() request: FastifyRequest) {
    return this.#services.mail.sendGraphTest(actorOf(request), body.to, body.language, body.configuration);
  }

  @Put("mail")
  @Permission("instance.settings.manage", { type: "instance" }, { recentAuthentication: true })
  @InternalRoute()
  @ApiRoute({
    summary: "Configure the mail server",
    tags: [TAG],
    body: smtpInputSchema,
    errors: ["invalidSmtpConfiguration"],
  })
  async configureMail(@Body() body: z.output<typeof smtpInputSchema>) {
    const { password, ...configuration } = body;
    await this.#services.mail.configureSmtp(configuration, password);
  }

  @Post("mail/test")
  @Permission("instance.settings.manage", { type: "instance" }, { recentAuthentication: true })
  @InternalRoute()
  @ApiRoute({
    summary: "Send a test mail",
    tags: [TAG],
    status: 200,
    body: smtpTestInputSchema,
    response: { description: "Whether the mail server accepted the mail.", schema: smtpTestResultSchema },
    errors: ["invalidSmtpConfiguration"],
  })
  async testMail(@Body() body: z.output<typeof smtpTestInputSchema>) {
    const { to, language, password, ...configuration } = body;
    return this.#services.mail.sendTest(to, language, { configuration, password });
  }

  @Get("organizations")
  @Permission("instance.organizations.view")
  @ApiRoute({
    summary: "List all organizations",
    description:
      "Lists every organization of the instance with its owners, number of members and domains. `q` searches name and short name.",
    tags: [TAG],
    query: searchQuerySchema,
    response: {
      description: "Organizations of the instance.",
      schema: pageSchema(administeredOrganizationSchema, "Organizations, ordered by name."),
      example: { items: [exampleAdministeredOrganization], nextCursor: null },
    },
  })
  async organizations(@Query() query: z.output<typeof searchQuerySchema>) {
    const page = await this.#services.organizations.list(pageRequest(query, nameCursor));
    const overview = await this.#services.overview.describeOrganizations(page.items.map((item) => item.id));
    return toApiPage({
      ...page,
      items: page.items.map((item) => ({
        ...item,
        ...(overview.get(item.id) ?? { owners: [], memberCount: 0, domains: [] }),
      })),
    });
  }

  @Get("accounts")
  @Permission("instance.accounts.view")
  @ApiRoute({
    summary: "List all accounts",
    description:
      "Lists every account of the instance, including service accounts, with instance roles, second-factor state and last sign-in. `q` searches name and e-mail address.",
    tags: [TAG],
    query: accountListQuerySchema,
    response: {
      description: "Accounts of the instance.",
      schema: pageSchema(administeredAccountSchema, "Accounts, ordered by name."),
      example: { items: [exampleAdministeredAccount], nextCursor: null },
    },
  })
  async accounts(@Query() query: z.output<typeof accountListQuerySchema>) {
    return toApiPage(
      await this.#services.overview.listAccounts(pageRequest(query, nameCursor), {
        withoutOrganization: query.withoutOrganization === "true",
        ...(query.state ? { state: query.state } : {}),
      }),
    );
  }

  @Post("accounts/placeholders")
  @Permission("instance.accounts.manage")
  @ApiRoute({
    summary: "Create a placeholder",
    description:
      "Creates an account for a person who has not signed in yet, for example the author of imported content. When the person signs in through a provider with this e-mail address and the provider verifies it, the placeholder becomes their account; otherwise an administrator merges it.",
    tags: [TAG],
    status: 201,
    body: placeholderSchema,
    bodyExample: { name: "Erika Example", email: "erika@example.com" },
    response: {
      description: "The placeholder.",
      schema: z
        .object({
          id: uuid("ID of the placeholder."),
          name: z.string().describe("Name."),
          email: z.string().describe("E-mail address."),
        })
        .describe("A placeholder."),
      example: {
        id: "01929b1f-0a6d-7a51-827e-6f5a4b3c8d9f",
        name: "Erika Example",
        email: "erika@example.com",
      },
    },
    errors: ["emailInUse"],
  })
  async createPlaceholder(@Body() body: z.output<typeof placeholderSchema>, @Req() request: FastifyRequest) {
    return this.#services.accountLifecycle.createPlaceholder(actorOf(request), body);
  }

  @Post("accounts/:accountId/merge")
  @Permission("instance.accounts.manage", { type: "instance" }, { recentAuthentication: true })
  @ApiRoute({
    summary: "Merge a placeholder into an account",
    description:
      "Moves the memberships, group memberships and organization roles of the placeholder to the account. The placeholder keeps its ID and points to the account. Nobody can merge a placeholder into their own account. Needs a recent confirmation of identity.",
    tags: [TAG],
    status: 200,
    params: z.object({ accountId: uuid("ID of the placeholder.") }).strict(),
    body: mergeSchema,
    bodyExample: { accountId: "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c" },
    response: {
      description: "What moved.",
      schema: mergedSchema,
      example: { memberships: 1, groups: 2, roles: 0 },
    },
    errors: ["notPlaceholder", "notFound", "reauthenticationRequired"],
  })
  async mergePlaceholder(
    @Param("accountId") placeholderId: string,
    @Body() body: z.output<typeof mergeSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.accountLifecycle.mergePlaceholder(actorOf(request), placeholderId, body.accountId);
  }

  @Post("accounts/:accountId/anonymize")
  @Permission(
    "instance.accounts.manage",
    { type: "instance" },
    { recentAuthentication: true, sessionOnly: true },
  )
  @ApiRoute({
    summary: "Anonymize an account",
    description:
      "Removes the name, e-mail address, sign-in names and profile of the account for good, and deletes its identities, sessions, tokens, passkeys, second factors and personal settings. Its memberships end. The account stays as a former user with its ID; content keeps this pseudonym, and the audit log can no longer show its personal data. Copies of the audit log exported or streamed before are outside Pagehall. Needs a signed-in session with a recent confirmation of identity.",
    tags: [TAG],
    status: 200,
    params: z.object({ accountId: uuid("ID of the account.") }).strict(),
    body: anonymizeSchema,
    bodyExample: { reason: "Erasure request of 1 October 2026", confirmation: "Erika Example" },
    response: {
      description: "What was removed.",
      schema: anonymizedSchema,
      example: { endedSessions: 1, removedIdentities: 1, endedMemberships: 2 },
    },
    errors: [
      "confirmationMismatch",
      "anonymizeSelf",
      "instanceOwner",
      "lastOwner",
      "notFound",
      "reauthenticationRequired",
    ],
  })
  async anonymize(
    @Param("accountId") accountId: string,
    @Body() body: z.output<typeof anonymizeSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.accountLifecycle.anonymize(actorOf(request), accountId, body);
  }

  @Post("accounts/:accountId/organization")
  @Permission("instance.accounts.manage")
  @ApiRoute({
    summary: "Assign an organization to an account without one",
    description:
      "Makes the organization the home organization of the account and adds the account as a member. Only for accounts that have no organization yet.",
    tags: [TAG],
    status: 204,
    params: z.object({ accountId: uuid("ID of the account.") }).strict(),
    body: z
      .object({ organizationId: uuid("ID of the organization the account belongs to from now on.") })
      .strict()
      .describe("The organization to assign."),
    bodyExample: { organizationId: "01929b1f-0a6d-7a51-827e-6f5a4b3c8d9e" },
    errors: ["notFound", "accountHasOrganization", "guestMembership"],
  })
  async assignOrganization(
    @Param("accountId") accountId: string,
    @Body() body: { organizationId: string },
    @Req() request: FastifyRequest,
  ) {
    await this.#services.administration.assignOrganization(actorOf(request), accountId, body.organizationId);
  }

  @Get("accounts/:accountId")
  @Permission("instance.accounts.view")
  @InternalRoute()
  @ApiRoute({
    summary: "Show an account",
    description:
      "Shows an account with its memberships and roles per organization, active sessions, tokens and second factors.",
    tags: [TAG],
    params: z.object({ accountId: uuid("ID of the account.") }).strict(),
    response: { description: "The account.", schema: accountDetailSchema },
    errors: ["notFound"],
  })
  async account(@Param("accountId") accountId: string) {
    const detail = await this.#services.overview.accountDetail(accountId);
    if (!detail) throw notFound();
    return detail;
  }

  @Get("roles")
  @Permission("instance.roles.view")
  @ApiRoute({
    summary: "List instance roles",
    description: "Lists the custom roles at the instance level. Built-in roles are not listed.",
    tags: [TAG],
    query: pageQuerySchema,
    response: {
      description: "Custom instance roles.",
      schema: pageSchema(customRoleSchema, "Roles, ordered by name."),
      example: { items: [exampleInstanceRole], nextCursor: null },
    },
  })
  async roles(@Query() query: z.output<typeof pageQuerySchema>) {
    return paginate(await this.#services.roles.listCustom("instance", null), byName, query);
  }

  @Post("roles")
  @Permission("instance.roles.manage")
  @ApiRoute({
    summary: "Create an instance role",
    description: "Defines an instance role from areas and access levels.",
    tags: [TAG],
    status: 201,
    body: customRoleBody,
    bodyExample: { name: "Operators", areas: { operations: "manage" } },
    response: { description: "The new role.", schema: customRoleSchema, example: exampleInstanceRole },
    errors: ["roleNameTaken"],
  })
  async createRole(@Body() body: z.output<typeof customRoleBody>, @Req() request: FastifyRequest) {
    return this.#services.roles.createCustom(actorOf(request), "instance", null, body);
  }

  @Patch("roles/:roleId")
  @Permission("instance.roles.manage")
  @ApiRoute({
    summary: "Change an instance role",
    description: "Renames an instance role or changes its areas.",
    tags: [TAG],
    params: roleParams,
    body: customRoleUpdateBody,
    bodyExample: { areas: { operations: "view" } },
    response: { description: "The changed role.", schema: customRoleSchema, example: exampleInstanceRole },
    errors: ["roleNotFound", "roleNameTaken"],
  })
  async updateRole(
    @Param("roleId") roleId: string,
    @Body() body: z.output<typeof customRoleUpdateBody>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.roles.updateCustom(actorOf(request), "instance", null, roleId, body);
  }

  @Delete("roles/:roleId")
  @Permission("instance.roles.manage")
  @ApiRoute({
    summary: "Delete an instance role",
    description: "Deletes the role and all its assignments.",
    tags: [TAG],
    params: roleParams,
    errors: ["roleNotFound"],
  })
  async deleteRole(@Param("roleId") roleId: string, @Req() request: FastifyRequest) {
    await this.#services.roles.deleteCustom(actorOf(request), "instance", null, roleId);
  }

  @Get("role-assignments")
  @Permission("instance.roles.view")
  @ApiRoute({
    summary: "List instance role assignments",
    description: "Lists who holds which instance role.",
    tags: [TAG],
    query: pageQuerySchema,
    response: {
      description: "Instance role assignments.",
      schema: pageSchema(roleAssignmentSchema, "Assignments, ordered by ID."),
      example: { items: [exampleInstanceAssignment], nextCursor: null },
    },
  })
  async assignments(@Query() query: z.output<typeof pageQuerySchema>) {
    return toApiPage(
      await this.#services.roles.listAssignments("instance", null, pageRequest(query, idCursor)),
    );
  }

  @Post("role-assignments")
  @Permission("instance.roles.manage")
  @ApiRoute({
    summary: "Assign an instance role",
    description:
      "Gives an instance role to an internal account. Instance roles go to individual accounts only.",
    tags: [TAG],
    status: 201,
    body: assignmentBody,
    bodyExample: {
      role: { builtIn: "securityAuditor" },
      principal: { kind: "account", id: exampleAccount.id },
    },
    response: {
      description: "The new assignment.",
      schema: roleAssignmentSchema,
      example: exampleInstanceAssignment,
    },
    errors: [
      "alreadyAssigned",
      "invalidPrincipal",
      "roleNeedsAccountOrGroup",
      "roleNotAssignable",
      "roleNotFound",
      "expiryInPast",
    ],
  })
  async assign(@Body() body: z.output<typeof assignmentBody>, @Req() request: FastifyRequest) {
    return this.#services.roles.assign(actorOf(request), {
      scope: "instance",
      organizationId: null,
      role: body.role,
      principal: { kind: body.principal.kind, id: "id" in body.principal ? body.principal.id : null },
      expiresAt: body.expiresAt ?? null,
    });
  }

  @Post("role-assignments/batch")
  @Permission("instance.roles.manage")
  @InternalRoute()
  @ApiRoute({
    summary: "Assign an instance role to several accounts",
    description:
      "Gives one instance role to several accounts at once. Either all assignments are made or none.",
    tags: [TAG],
    status: 201,
    body: batchAssignmentBody,
    response: {
      description: "The new assignments.",
      schema: z.object({ items: z.array(roleAssignmentSchema).describe("The new assignments.") }),
    },
    errors: ["alreadyAssigned", "invalidPrincipal", "roleNotAssignable", "roleNotFound", "expiryInPast"],
  })
  async assignMany(@Body() body: z.output<typeof batchAssignmentBody>, @Req() request: FastifyRequest) {
    const items = await this.#services.roles.assignMany(actorOf(request), {
      scope: "instance",
      organizationId: null,
      role: body.role,
      principals: body.principals,
      expiresAt: body.expiresAt ?? null,
    });
    return { items };
  }

  @Delete("role-assignments/:assignmentId")
  @Permission("instance.roles.manage")
  @ApiRoute({
    summary: "Remove an instance role assignment",
    description: "Takes an instance role away. The permissions end at once.",
    tags: [TAG],
    params: assignmentParams,
  })
  async unassign(@Param("assignmentId") assignmentId: string, @Req() request: FastifyRequest) {
    if (!(await this.#services.roles.unassign(actorOf(request), "instance", null, assignmentId))) {
      throw notFound();
    }
  }

  @Post("ownership")
  @Permission("instance.ownership.transfer", { type: "instance" }, { recentAuthentication: true })
  @InternalRoute()
  @ApiRoute({
    summary: "Transfer instance ownership",
    tags: [TAG],
    body: ownershipSchema,
    errors: ["instanceOwner"],
  })
  async transferOwnership(@Body() body: z.output<typeof ownershipSchema>, @Req() request: FastifyRequest) {
    await this.#services.memberships.transferOwnership(actorOf(request), body.accountId);
  }

  @Get("settings")
  @Permission("instance.settings.view")
  @ApiRoute({
    summary: "List instance settings",
    description: "Lists the settings at the instance level with their effective values.",
    tags: [TAG],
    query: pageQuerySchema,
    response: {
      description: "Instance settings.",
      schema: pageSchema(settingSchema, "Settings, ordered by key."),
      example: { items: [exampleSetting], nextCursor: null },
    },
  })
  async settings(@Query() query: z.output<typeof pageQuerySchema>) {
    const { settings, settingsRegistry } = this.#settingsServices();
    const listed = await listSettings(settings, settingsRegistry, "instance", {});
    return paginate(listed, (setting) => [setting.key], query);
  }

  @Put("settings/:key")
  @Permission([
    "instance.settings.manage",
    "instance.signIn.manage",
    "instance.audit.manage",
    "instance.organizations.manage",
  ])
  @ApiRoute({
    summary: "Change an instance setting",
    description:
      "Sets, clears or locks an instance setting. Each setting needs the manage level of its area: sign-in, audit log, organizations or settings.",
    tags: [TAG],
    params: settingParams,
    body: settingUpdateSchema,
    bodyExample: { value: 30, locked: true },
    errors: ["invalidSetting", "settingManagedElsewhere"],
  })
  async updateSetting(
    @Param("key") key: string,
    @Body() body: z.output<typeof settingUpdateSchema>,
    @Req() request: FastifyRequest,
  ) {
    const { settings, settingsRegistry } = this.#settingsServices();
    const definition = definitionFor(settingsRegistry, key, "instance");
    await this.#services.authorization.require(actorOf(request), settingPermission(key), {
      type: "instance",
    });
    await updateSetting(settings, definition, "instance", {}, body);
  }

  #settingsServices() {
    const { settings, settingsRegistry } = this.context;
    if (!settings || !settingsRegistry) throw new Error("The settings are not available");
    return { settings, settingsRegistry };
  }
}
