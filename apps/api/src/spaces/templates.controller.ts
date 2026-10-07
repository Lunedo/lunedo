import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import {
  MAX_CHOICE_OPTIONS,
  MAX_TEMPLATE_FIELDS,
  organizationSettingsChain,
  type ScopeChain,
  TEMPLATE_DESCRIPTION_MAX_LENGTH,
  TEMPLATE_NAME_MAX_LENGTH,
  TEMPLATE_TITLE_MAX_LENGTH,
  type TemplateScope,
  templateCategories,
  templateFieldTypes,
} from "@pagehall/server";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { notFound, type ProblemCode } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import { timestamp, uuid } from "../http/schemas.js";
import { definitionFor, listSettings, settingUpdateSchema, updateSetting } from "../http/settings.js";
import { documentSchema, exampleDocument } from "./schemas.js";

const TAG = "Templates";
const SETTINGS = "Settings";
const space = { type: "space", param: "spaceId" } as const;
const organization = { type: "organization", param: "organizationId" } as const;
const instance = { type: "instance" } as const;
const spaceParams = z.object({ spaceId: uuid("ID of the space.") }).strict();
const spaceTemplateParams = spaceParams.extend({ templateId: uuid("ID of the template.") });
const organizationParams = z.object({ organizationId: uuid("ID of the organization.") }).strict();
const organizationTemplateParams = organizationParams.extend({ templateId: uuid("ID of the template.") });
const templateParams = z.object({ templateId: uuid("ID of the template.") }).strict();
const spaceSettingParams = spaceParams.extend({ key: z.string().max(100).describe("Key of the setting.") });

const SPACE_SETTING_KEYS = new Set([
  "pages.defaultMode",
  "pages.liveVersionIdleMinutes",
  "trash.firstStageDays",
  "trash.secondStageDays",
]);

const categorySchema = z
  .enum(templateCategories)
  .describe(
    "Category in the gallery: meetings, decisions, projects, engineering, operations, knowledge or teams.",
  );

const fieldSchema = z
  .object({
    key: z
      .string()
      .max(40)
      .describe("Key of the field, used as `{key}` in the title and by template field nodes in the content."),
    label: z.string().max(100).describe("Label shown when the page is created."),
    type: z
      .enum(templateFieldTypes)
      .describe(
        "`text`, `date` (filled with today by default), `person` (inserted as a mention) or `choice`.",
      ),
    required: z.boolean().describe("Whether a value is required."),
    options: z
      .array(z.string().max(100))
      .max(MAX_CHOICE_OPTIONS)
      .optional()
      .describe("Options of a choice field."),
  })
  .strict()
  .describe("An input field asked for when a page is created from the template.");

const templateSchema = z
  .object({
    id: z.string().describe("ID of the template. Built-in templates have IDs starting with `builtin:`."),
    level: z
      .enum(["builtIn", "instance", "organization", "space"])
      .describe(
        "Where the template comes from: built in, or from the instance, the organization or the space.",
      ),
    organizationId: uuid("Organization of an organization template, or null.").nullable(),
    spaceId: uuid("Space of a space template, or null.").nullable(),
    name: z.string().describe("Name."),
    description: z.string().describe("Short description."),
    category: categorySchema,
    title: z.string().describe("Title of new pages; `{key}` inserts the value of an input field."),
    fields: z.array(fieldSchema).describe("Input fields."),
    document: documentSchema,
    updatedAt: timestamp("When the template last changed, or null for built-in templates.").nullable(),
  })
  .describe("A page template.");

const exampleTemplate = {
  id: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a70",
  level: "space",
  organizationId: null,
  spaceId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a10",
  name: "Change request",
  description: "Planned change with risk and rollback",
  category: "operations",
  title: "Change {name}",
  fields: [{ key: "name", label: "Name of the change", type: "text", required: true }],
  document: exampleDocument,
  updatedAt: "2026-10-05T08:00:00.000Z",
};

const templateBodyExample = {
  name: exampleTemplate.name,
  description: exampleTemplate.description,
  category: exampleTemplate.category,
  title: exampleTemplate.title,
  fields: exampleTemplate.fields,
  document: exampleTemplate.document,
};

const templateInputSchema = z
  .object({
    name: z.string().max(TEMPLATE_NAME_MAX_LENGTH).describe("Name, 1 to 100 characters."),
    description: z
      .string()
      .max(TEMPLATE_DESCRIPTION_MAX_LENGTH)
      .default("")
      .describe("Short description, up to 300 characters."),
    category: categorySchema,
    title: z.string().max(TEMPLATE_TITLE_MAX_LENGTH).describe("Title of new pages, 1 to 255 characters."),
    fields: z
      .array(fieldSchema)
      .max(MAX_TEMPLATE_FIELDS)
      .describe(`Up to ${MAX_TEMPLATE_FIELDS} input fields.`),
    document: documentSchema,
  })
  .strict()
  .describe("A template.");

const fromPageSchema = z
  .object({
    pageId: uuid("The page whose current content becomes the template."),
    name: z.string().max(TEMPLATE_NAME_MAX_LENGTH).describe("Name, 1 to 100 characters."),
    description: z.string().max(TEMPLATE_DESCRIPTION_MAX_LENGTH).default("").describe("Short description."),
    category: categorySchema,
  })
  .strict()
  .describe("A page to save as a space template.");

const templates = z.array(templateSchema).describe("Templates.");
const templateErrors: ProblemCode[] = [
  "invalidTemplateName",
  "invalidDescription",
  "invalidTitle",
  "invalidTemplateFields",
  "unknownTemplateField",
  "invalidDocument",
];

const levelQuery = z
  .object({ q: z.string().trim().max(100).default("").describe("Text the name or description contains.") })
  .strict();

@Controller("api/v1")
export class TemplatesController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  async #owned(templateId: string, scope: TemplateScope): Promise<void> {
    const found = await this.#services.templates.scopeOf(templateId);
    if (!found || JSON.stringify(found) !== JSON.stringify(scope)) throw notFound();
  }

  @Get("spaces/:spaceId/template-gallery")
  @Permission("space.edit", space)
  @ApiRoute({
    summary: "List the templates for new pages",
    description:
      "Lists every template the caller can use in the space: the built-in templates in the caller's language, then those of the instance, the organization and the space.",
    tags: [TAG],
    params: spaceParams,
    query: levelQuery,
    response: { description: "Templates.", schema: templates, example: [exampleTemplate] },
  })
  async gallery(
    @Param("spaceId") spaceId: string,
    @Query() query: z.output<typeof levelQuery>,
    @Req() request: FastifyRequest,
  ) {
    const term = query.q.toLowerCase();
    const usable = await this.#services.templates.usable(actorOf(request), spaceId);
    return term
      ? usable.filter((template) => `${template.name} ${template.description}`.toLowerCase().includes(term))
      : usable;
  }

  @Get("spaces/:spaceId/templates")
  @Permission("space.view", space)
  @ApiRoute({
    summary: "List the templates of a space",
    description: "Lists the templates defined in the space itself.",
    tags: [TAG],
    params: spaceParams,
    response: { description: "Templates of the space.", schema: templates, example: [exampleTemplate] },
  })
  async spaceTemplates(@Param("spaceId") spaceId: string) {
    return this.#services.templates.list({ level: "space", spaceId });
  }

  @Post("spaces/:spaceId/templates")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Create a space template",
    description: "Creates a template for the space.",
    tags: [TAG],
    status: 201,
    params: spaceParams,
    body: templateInputSchema,
    bodyExample: templateBodyExample,
    response: { description: "The template.", schema: templateSchema, example: exampleTemplate },
    errors: templateErrors,
  })
  async createSpaceTemplate(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof templateInputSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.templates.create(actorOf(request), { level: "space", spaceId }, body);
  }

  @Post("spaces/:spaceId/templates/from-page")
  @Permission("space.edit", space)
  @ApiRoute({
    summary: "Save a page as a space template",
    description:
      "Creates a space template from the current content of a page of the space, including its draft. Editors can do this; space admins can then add input fields.",
    tags: [TAG],
    status: 201,
    params: spaceParams,
    body: fromPageSchema,
    bodyExample: { pageId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a40", name: "Runbook", category: "operations" },
    response: { description: "The template.", schema: templateSchema, example: exampleTemplate },
    errors: ["invalidTemplateName", "invalidDescription"],
  })
  async saveFromPage(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof fromPageSchema>,
    @Req() request: FastifyRequest,
  ) {
    const actor = actorOf(request);
    await this.#services.authorization.require(actor, "item.edit", { type: "item", id: body.pageId });
    return this.#services.templates.saveFromPage(actor, spaceId, body.pageId, {
      name: body.name,
      description: body.description,
      category: body.category,
    });
  }

  @Put("spaces/:spaceId/templates/:templateId")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Change a space template",
    description: "Changes a template of the space. Pages created from it before stay as they are.",
    tags: [TAG],
    params: spaceTemplateParams,
    body: templateInputSchema,
    bodyExample: templateBodyExample,
    response: { description: "The template.", schema: templateSchema, example: exampleTemplate },
    errors: templateErrors,
  })
  async updateSpaceTemplate(
    @Param("spaceId") spaceId: string,
    @Param("templateId") templateId: string,
    @Body() body: z.output<typeof templateInputSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#owned(templateId, { level: "space", spaceId });
    return this.#services.templates.update(actorOf(request), templateId, body);
  }

  @Delete("spaces/:spaceId/templates/:templateId")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Delete a space template",
    description: "Deletes a template of the space. Pages created from it stay.",
    tags: [TAG],
    params: spaceTemplateParams,
  })
  async deleteSpaceTemplate(
    @Param("spaceId") spaceId: string,
    @Param("templateId") templateId: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#owned(templateId, { level: "space", spaceId });
    await this.#services.templates.delete(actorOf(request), templateId);
  }

  @Get("organizations/:organizationId/templates")
  @Permission("organization.templates.manage", organization)
  @ApiRoute({
    summary: "List the templates of an organization",
    description: "Lists the templates available in all spaces of the organization.",
    tags: [TAG],
    params: organizationParams,
    response: {
      description: "Templates.",
      schema: templates,
      example: [{ ...exampleTemplate, level: "organization" }],
    },
  })
  async organizationTemplates(@Param("organizationId") organizationId: string) {
    return this.#services.templates.list({ level: "organization", organizationId });
  }

  @Post("organizations/:organizationId/templates")
  @Permission("organization.templates.manage", organization)
  @ApiRoute({
    summary: "Create an organization template",
    description: "Creates a template for all spaces of the organization.",
    tags: [TAG],
    status: 201,
    params: organizationParams,
    body: templateInputSchema,
    bodyExample: templateBodyExample,
    response: {
      description: "The template.",
      schema: templateSchema,
      example: { ...exampleTemplate, level: "organization" },
    },
    errors: templateErrors,
  })
  async createOrganizationTemplate(
    @Param("organizationId") organizationId: string,
    @Body() body: z.output<typeof templateInputSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.templates.create(actorOf(request), { level: "organization", organizationId }, body);
  }

  @Put("organizations/:organizationId/templates/:templateId")
  @Permission("organization.templates.manage", organization)
  @ApiRoute({
    summary: "Change an organization template",
    description: "Changes a template of the organization. Pages created from it before stay as they are.",
    tags: [TAG],
    params: organizationTemplateParams,
    body: templateInputSchema,
    bodyExample: templateBodyExample,
    response: {
      description: "The template.",
      schema: templateSchema,
      example: { ...exampleTemplate, level: "organization" },
    },
    errors: templateErrors,
  })
  async updateOrganizationTemplate(
    @Param("organizationId") organizationId: string,
    @Param("templateId") templateId: string,
    @Body() body: z.output<typeof templateInputSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#owned(templateId, { level: "organization", organizationId });
    return this.#services.templates.update(actorOf(request), templateId, body);
  }

  @Delete("organizations/:organizationId/templates/:templateId")
  @Permission("organization.templates.manage", organization)
  @ApiRoute({
    summary: "Delete an organization template",
    description: "Deletes a template of the organization. Pages created from it stay.",
    tags: [TAG],
    params: organizationTemplateParams,
  })
  async deleteOrganizationTemplate(
    @Param("organizationId") organizationId: string,
    @Param("templateId") templateId: string,
    @Req() request: FastifyRequest,
  ) {
    await this.#owned(templateId, { level: "organization", organizationId });
    await this.#services.templates.delete(actorOf(request), templateId);
  }

  @Get("instance/templates")
  @Permission("instance.templates.manage", instance)
  @ApiRoute({
    summary: "List the templates of the instance",
    description:
      "Lists the templates available in all organizations. Built-in templates are not part of this list.",
    tags: [TAG],
    response: {
      description: "Templates.",
      schema: templates,
      example: [{ ...exampleTemplate, level: "instance" }],
    },
  })
  async instanceTemplates() {
    return this.#services.templates.list({ level: "instance" });
  }

  @Post("instance/templates")
  @Permission("instance.templates.manage", instance)
  @ApiRoute({
    summary: "Create an instance template",
    description: "Creates a template for all organizations.",
    tags: [TAG],
    status: 201,
    body: templateInputSchema,
    bodyExample: templateBodyExample,
    response: {
      description: "The template.",
      schema: templateSchema,
      example: { ...exampleTemplate, level: "instance" },
    },
    errors: templateErrors,
  })
  async createInstanceTemplate(
    @Body() body: z.output<typeof templateInputSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#services.templates.create(actorOf(request), { level: "instance" }, body);
  }

  @Put("instance/templates/:templateId")
  @Permission("instance.templates.manage", instance)
  @ApiRoute({
    summary: "Change an instance template",
    description: "Changes a template of the instance. Pages created from it before stay as they are.",
    tags: [TAG],
    params: templateParams,
    body: templateInputSchema,
    bodyExample: templateBodyExample,
    response: {
      description: "The template.",
      schema: templateSchema,
      example: { ...exampleTemplate, level: "instance" },
    },
    errors: templateErrors,
  })
  async updateInstanceTemplate(
    @Param("templateId") templateId: string,
    @Body() body: z.output<typeof templateInputSchema>,
    @Req() request: FastifyRequest,
  ) {
    await this.#owned(templateId, { level: "instance" });
    return this.#services.templates.update(actorOf(request), templateId, body);
  }

  @Delete("instance/templates/:templateId")
  @Permission("instance.templates.manage", instance)
  @ApiRoute({
    summary: "Delete an instance template",
    description: "Deletes a template of the instance. Pages created from it stay.",
    tags: [TAG],
    params: templateParams,
  })
  async deleteInstanceTemplate(@Param("templateId") templateId: string, @Req() request: FastifyRequest) {
    await this.#owned(templateId, { level: "instance" });
    await this.#services.templates.delete(actorOf(request), templateId);
  }

  async #spaceChain(spaceId: string): Promise<ScopeChain> {
    const found = await this.#services.spaces.require(spaceId);
    return {
      ...(found.organizationId ? organizationSettingsChain(found.organizationId) : {}),
      space: spaceId,
    };
  }

  @Get("spaces/:spaceId/settings")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "List the settings of a space",
    description:
      "Lists the settings that can be set for the space: default editing mode of new pages, the idle time after which live pages get a version, and the trash periods. Each shows whether it is inherited or set here.",
    tags: [SETTINGS],
    params: spaceParams,
    response: {
      description: "Settings of the space.",
      schema: z.array(z.json()).describe("Settings, with their effective values and levels."),
      example: [],
    },
  })
  async spaceSettings(@Param("spaceId") spaceId: string) {
    const { settings, settingsRegistry } = this.context;
    if (!settings || !settingsRegistry) throw notFound();
    const listed = await listSettings(settings, settingsRegistry, "space", await this.#spaceChain(spaceId));
    return listed.filter((setting) => SPACE_SETTING_KEYS.has(setting.key));
  }

  @Put("spaces/:spaceId/settings/:key")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Change a setting of a space",
    description:
      "Sets or clears a setting for the space. Trash periods cannot go below the minimum the instance sets; a setting locked above cannot change.",
    tags: [SETTINGS],
    params: spaceSettingParams,
    body: settingUpdateSchema,
    bodyExample: { value: "live" },
    errors: ["invalidSetting", "settingLocked", "settingBelowMinimum"],
  })
  async updateSpaceSetting(
    @Param("spaceId") spaceId: string,
    @Param("key") key: string,
    @Body() body: z.output<typeof settingUpdateSchema>,
  ) {
    const { settings, settingsRegistry } = this.context;
    if (!settings || !settingsRegistry || !SPACE_SETTING_KEYS.has(key)) throw notFound();
    const definition = definitionFor(settingsRegistry, key, "space");
    await updateSetting(settings, definition, "space", await this.#spaceChain(spaceId), body);
  }
}
