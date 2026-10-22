import {
  ANNOUNCEMENT_LINK_LABEL_MAX_LENGTH,
  ANNOUNCEMENT_TEXT_MAX_LENGTH,
  ANNOUNCEMENT_URL_MAX_LENGTH,
  type AnnouncementInput,
  announcementSeverities,
} from "@lunedo/server";
import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { notFound } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import { inputTimestamp, organizationIdParams, timestamp, uuid } from "../http/schemas.js";

const TAG = "Announcements";
const organization = { type: "organization", param: "organizationId" } as const;

const severitySchema = z
  .enum(announcementSeverities)
  .describe(
    "`information` can be dismissed by each person until the announcement changes; `warning` stays until its end.",
  );

const linkSchema = z
  .object({
    url: z.string().max(ANNOUNCEMENT_URL_MAX_LENGTH).describe("Address starting with https:// or http://."),
    label: z.string().max(ANNOUNCEMENT_LINK_LABEL_MAX_LENGTH).describe("Text of the link."),
  })
  .describe("A link shown after the text.");

const announcementBase = {
  id: uuid("ID of the announcement. It stays the same when the announcement is changed."),
  scope: z.enum(["instance", "organization"]).describe("Who set it."),
  organizationId: uuid("The organization, or null for the instance.").nullable(),
  version: uuid("Changes with every change of the announcement."),
  severity: severitySchema,
  text: z.string().describe("The text."),
  link: linkSchema.nullable().describe("The link, or null."),
  startsAt: timestamp("When it starts to show."),
  endsAt: timestamp("When it stops showing."),
};

const managedSchema = z
  .object({
    ...announcementBase,
    updatedAt: timestamp("When it was last changed."),
    updatedBy: z
      .object({
        id: uuid("ID of the person."),
        name: z.string().nullable().describe("Name, or null when the caller may not see the person."),
      })
      .nullable()
      .describe("Who changed it last."),
  })
  .describe("An announcement banner.");

const currentSchema = z
  .object({ announcement: managedSchema.nullable().describe("The announcement, or null when none is set.") })
  .describe("The current announcement.");

const shownSchema = z
  .array(
    z
      .object({
        ...announcementBase,
        dismissed: z.boolean().describe("Whether the caller dismissed this version."),
      })
      .describe("An announcement."),
  )
  .describe(
    "Announcements of the instance and of the caller's organizations that have started and not ended. The instance announcement comes first.",
  );

const setSchema = z
  .object({
    severity: severitySchema,
    text: z
      .string()
      .max(ANNOUNCEMENT_TEXT_MAX_LENGTH)
      .describe(`Up to ${ANNOUNCEMENT_TEXT_MAX_LENGTH} characters.`),
    link: linkSchema.strict().nullable().default(null).describe("A link shown after the text, or null."),
    startsAt: inputTimestamp("When it starts to show, or null for now.").nullable().default(null),
    endsAt: inputTimestamp("When it stops showing. Needs to be in the future and after the start."),
  })
  .strict()
  .describe(
    "The announcement. It replaces the current one; everyone sees it again, also people who dismissed it.",
  );

const dismissParams = z.object({ announcementId: uuid("ID of the announcement.") }).strict();
const dismissSchema = z
  .object({ version: uuid("The version that was shown.") })
  .strict()
  .describe("The version to dismiss.");

const example = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a40",
  scope: "organization" as const,
  organizationId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a01",
  version: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a41",
  severity: "information" as const,
  text: "New: search in attachments. PDF, Word and Excel files are now searchable.",
  link: { url: "https://wiki.example.org/spaces/ENG/blog", label: "Read the post" },
  startsAt: "2026-10-14T08:00:00.000Z",
  endsAt: "2026-10-21T08:00:00.000Z",
};
const exampleManaged = {
  ...example,
  updatedAt: "2026-10-14T07:55:00.000Z",
  updatedBy: { id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20", name: "Anna Weber" },
};
const exampleBody = {
  severity: "information",
  text: example.text,
  link: example.link,
  startsAt: null,
  endsAt: example.endsAt,
};

function input(body: z.output<typeof setSchema>): AnnouncementInput {
  return {
    severity: body.severity,
    text: body.text,
    link: body.link,
    startsAt: body.startsAt,
    endsAt: body.endsAt,
  };
}

@Controller("api/v1")
export class AnnouncementsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("announcements")
  @Permission("instance.content.view", { type: "instance" }, { sessionOnly: true })
  @ApiRoute({
    summary: "List the announcements shown to you",
    description:
      "Returns the announcements of the instance and of the caller's organizations that have started and not ended. Scheduled announcements appear once they start; administrators see them in the announcement settings. Hide dismissed information.",
    tags: [TAG],
    response: {
      description: "The announcements.",
      schema: shownSchema,
      example: [{ ...example, dismissed: false }],
    },
  })
  async shown(@Req() request: FastifyRequest) {
    return this.#services.announcements.shown(actorOf(request));
  }

  @Post("announcements/:announcementId/dismiss")
  @Permission("instance.content.view", { type: "instance" }, { sessionOnly: true })
  @ApiRoute({
    summary: "Dismiss an announcement",
    description:
      "Hides an information announcement for you until it changes. Warnings cannot be dismissed; they disappear at their end.",
    tags: [TAG],
    status: 204,
    params: dismissParams,
    body: dismissSchema,
    bodyExample: { version: example.version },
    errors: ["notFound", "announcementNotDismissible", "announcementChanged"],
  })
  async dismiss(
    @Param("announcementId") announcementId: string,
    @Body() body: z.output<typeof dismissSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#services.announcements.dismiss(actorOf(request), announcementId, body.version);
  }

  @Get("instance/announcement")
  @Permission("instance.settings.view")
  @ApiRoute({
    summary: "Get the instance announcement",
    description: "Returns the banner of the instance as set, also when it has ended or starts later.",
    tags: [TAG],
    response: {
      description: "The announcement.",
      schema: currentSchema,
      example: { announcement: exampleManaged },
    },
  })
  async instance(@Req() request: FastifyRequest) {
    return { announcement: await this.#services.announcements.get(actorOf(request), null) };
  }

  @Put("instance/announcement")
  @Permission("instance.settings.manage")
  @ApiRoute({
    summary: "Set the instance announcement",
    description:
      "Shows a banner on every screen of signed-in people, above an organization's banner. Open sessions show the change at once.",
    tags: [TAG],
    body: setSchema,
    bodyExample: exampleBody,
    response: { description: "The announcement.", schema: managedSchema, example: exampleManaged },
    errors: ["invalidAnnouncement"],
  })
  async setInstance(@Body() body: z.output<typeof setSchema>, @Req() request: FastifyRequest) {
    return this.#services.announcements.set(actorOf(request), null, input(body));
  }

  @Delete("instance/announcement")
  @Permission("instance.settings.manage")
  @ApiRoute({
    summary: "Remove the instance announcement",
    description: "Removes the banner of the instance for everyone at once.",
    tags: [TAG],
    status: 204,
    errors: ["notFound"],
  })
  async removeInstance(@Req() request: FastifyRequest) {
    if (!(await this.#services.announcements.remove(actorOf(request), null))) throw notFound();
  }

  @Get("organizations/:organizationId/announcement")
  @Permission("organization.settings.view", organization)
  @ApiRoute({
    summary: "Get the organization announcement",
    description: "Returns the banner of the organization as set, also when it has ended or starts later.",
    tags: [TAG],
    params: organizationIdParams,
    response: {
      description: "The announcement.",
      schema: currentSchema,
      example: { announcement: exampleManaged },
    },
  })
  async organization(@Param("organizationId") organizationId: string, @Req() request: FastifyRequest) {
    return { announcement: await this.#services.announcements.get(actorOf(request), organizationId) };
  }

  @Put("organizations/:organizationId/announcement")
  @Permission("organization.settings.manage", organization)
  @ApiRoute({
    summary: "Set the organization announcement",
    description:
      "Shows a banner on every screen of the organization's members, below the instance banner. Open sessions show the change at once.",
    tags: [TAG],
    params: organizationIdParams,
    body: setSchema,
    bodyExample: exampleBody,
    response: { description: "The announcement.", schema: managedSchema, example: exampleManaged },
    errors: ["invalidAnnouncement"],
  })
  async setOrganization(
    @Param("organizationId") organizationId: string,
    @Body() body: z.output<typeof setSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.announcements.set(actorOf(request), organizationId, input(body));
  }

  @Delete("organizations/:organizationId/announcement")
  @Permission("organization.settings.manage", organization)
  @ApiRoute({
    summary: "Remove the organization announcement",
    description: "Removes the banner of the organization for all its members at once.",
    tags: [TAG],
    status: 204,
    params: organizationIdParams,
    errors: ["notFound"],
  })
  async removeOrganization(@Param("organizationId") organizationId: string, @Req() request: FastifyRequest) {
    if (!(await this.#services.announcements.remove(actorOf(request), organizationId))) throw notFound();
  }
}
