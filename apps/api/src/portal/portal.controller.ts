import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Req } from "@nestjs/common";
import {
  brandColors,
  brandValues,
  FEEDBACK_RETENTION_MAX,
  type HelpCandidate,
  LOGO_MAX_BYTES,
  PORTAL_PATH_MAX,
  type PortalConfig,
  type PortalDomain,
  TOP_BAR_THRESHOLD_MAX,
} from "@pagehall/server";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { ownOrigin } from "../http/csrf.js";
import { instanceUrlOf } from "../http/instance-url.js";
import { notFound } from "../http/problems.js";
import { actorOf } from "../http/request.js";
import { timestamp, uuid } from "../http/schemas.js";

const TAG = "Knowledge bases";
const INSTANCE_TAG = "Instance";
const space = { type: "space", param: "spaceId" } as const;
const organization = { type: "organization", param: "organizationId" } as const;
const spaceParams = z.object({ spaceId: uuid("ID of the knowledge base.") }).strict();
const organizationParams = z.object({ organizationId: uuid("ID of the organization.") }).strict();
const domainParams = z.object({ domain: z.string().max(253).describe("The domain name.") }).strict();

const hex = z.string().max(7).describe("A color as a hex value such as `#0B6F78`.");

const brandSchema = z
  .object({
    color: z.enum(brandColors).describe("A color of the fixed palette, or `custom` for own values."),
    light: hex.nullable().describe("Own color for light mode, or null for a palette color."),
    dark: hex.nullable().describe("Own color for dark mode, or null for a palette color."),
  })
  .strict()
  .describe("The brand color of the portal.");

const portalSchema = z
  .object({
    spaceId: uuid("ID of the knowledge base."),
    path: z.string().describe("Path under `/help/` on the instance."),
    domain: z.string().nullable().describe("Own domain of the portal, or null."),
    url: z.string().describe("Address of the portal's start page."),
    brand: brandSchema,
    colors: z
      .object({ light: z.string().describe("Light mode."), dark: z.string().describe("Dark mode.") })
      .describe("The brand colors the portal uses."),
    welcomeHeading: z.string().describe("Heading of the start page; empty for the default heading."),
    welcomeText: z.string().describe("Short text below the heading; may be empty."),
    topBarThreshold: z
      .number()
      .int()
      .describe("From this number of categories on, the top bar shows a single topics menu."),
    poweredBy: z.boolean().describe("Whether the footer says that the portal is provided with Pagehall."),
    feedbackRetentionMonths: z
      .number()
      .int()
      .describe("Months after which readers' notes on articles are deleted."),
    logoRef: z.string().nullable().describe("Reference of the uploaded logo, or null."),
  })
  .describe("Address and appearance of a knowledge base portal.");

const examplePortal = {
  spaceId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a20",
  path: "help",
  domain: null,
  url: "https://wiki.example.org/help/help/",
  brand: { color: "petrol" as const, light: null, dark: null },
  colors: { light: "#0B6F78", dark: "#5DB9C2" },
  welcomeHeading: "",
  welcomeText: "",
  topBarThreshold: 10,
  poweredBy: true,
  feedbackRetentionMonths: 12,
  logoRef: null,
};

const addressSchema = z
  .object({
    path: z.string().max(PORTAL_PATH_MAX).describe("Lowercase letters, digits and single hyphens."),
    domain: z
      .string()
      .max(253)
      .nullable()
      .describe("A domain the instance administrators allowed for the organization, or null."),
  })
  .strict()
  .describe("The new address.");

const appearanceSchema = z
  .object({
    brand: brandSchema.optional(),
    confirmProposal: z
      .boolean()
      .optional()
      .describe("Saves the proposed shades when the own color does not reach the contrast WCAG AA asks for."),
    welcomeHeading: z.string().max(120).optional().describe("Heading of the start page."),
    welcomeText: z.string().max(400).optional().describe("Short text below the heading."),
    topBarThreshold: z
      .number()
      .int()
      .min(1)
      .max(TOP_BAR_THRESHOLD_MAX)
      .optional()
      .describe("See the portal."),
    poweredBy: z.boolean().optional().describe("Shows “Provided with Pagehall” in the footer."),
    feedbackRetentionMonths: z
      .number()
      .int()
      .min(1)
      .max(FEEDBACK_RETENTION_MAX)
      .optional()
      .describe("Months after which readers' notes are deleted."),
  })
  .strict()
  .describe("Fields to change. Fields that are left out stay as they are.");

const logoBody = z
  .object({
    contentType: z.enum(["image/png", "image/jpeg", "image/webp"]).describe("Type of the image."),
    data: z
      .base64()
      .max(Math.ceil(LOGO_MAX_BYTES / 3) * 4)
      .describe("The image, Base64-encoded."),
  })
  .strict()
  .describe("A logo image.");

const domainSchema = z
  .object({
    domain: z.string().describe("The domain name."),
    organizationId: uuid("ID of the organization that may use the domain."),
    organizationName: z.string().describe("Name of the organization."),
    spaceId: uuid("ID of the knowledge base that uses the domain.").nullable(),
    spaceName: z.string().nullable().describe("Name of the knowledge base that uses the domain."),
    createdAt: timestamp("When the domain was allowed."),
  })
  .describe("A domain allowed for knowledge base portals.");

const exampleDomain = {
  domain: "help.example.org",
  organizationId: "01929b1e-7c3a-7d2e-9f4b-3c2d1e0f5a30",
  organizationName: "Example",
  spaceId: null,
  spaceName: null,
  createdAt: "2026-10-19T08:00:00.000Z",
};

const allowDomainSchema = z
  .object({
    domain: z.string().max(253).describe("Domain name without https:// and without a path."),
    organizationId: uuid("ID of the organization that may use it."),
  })
  .strict()
  .describe("A domain to allow.");

const helpCandidateSchema = z
  .object({
    spaceId: uuid("ID of the knowledge base."),
    name: z.string().describe("Name of the knowledge base."),
    url: z.string().describe("Address of its portal."),
  })
  .describe("A knowledge base the help icon can open.");

const helpSchema = z
  .object({
    current: helpCandidateSchema
      .nullable()
      .describe("The chosen knowledge base, or null for the Pagehall documentation."),
    candidates: z.array(helpCandidateSchema).describe("Knowledge bases everyone signed in may read."),
  })
  .describe("Where the help icon of the app leads.");

const helpBodySchema = z
  .object({ spaceId: uuid("ID of the knowledge base.").nullable() })
  .strict()
  .describe("The knowledge base, or null for the Pagehall documentation.");

export function portalUrl(instanceUrl: string, config: { path: string; domain: string | null }): string {
  return config.domain ? `https://${config.domain}/` : `${instanceUrl}/help/${config.path}/`;
}

@Controller("api/v1")
export class PortalController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  async #instanceUrl(request: FastifyRequest): Promise<string> {
    return (await instanceUrlOf(this.context)) || ownOrigin(request);
  }

  async #portal(request: FastifyRequest, config: PortalConfig | null) {
    if (!config) throw notFound();
    return {
      spaceId: config.spaceId,
      path: config.path,
      domain: config.domain,
      url: portalUrl(await this.#instanceUrl(request), config),
      brand: config.brand,
      colors: brandValues(config.brand),
      welcomeHeading: config.welcomeHeading,
      welcomeText: config.welcomeText,
      topBarThreshold: config.topBarThreshold,
      poweredBy: config.poweredBy,
      feedbackRetentionMonths: config.feedbackRetentionMonths,
      logoRef: config.logoRef,
    };
  }

  @Get("spaces/:spaceId/knowledge-base/portal")
  @Permission("space.view", space)
  @ApiRoute({
    summary: "Get the portal of a knowledge base",
    description: "Returns the address and the appearance of the portal readers use.",
    tags: [TAG],
    params: spaceParams,
    response: { description: "The portal.", schema: portalSchema, example: examplePortal },
    errors: ["notFound"],
  })
  async portal(@Param("spaceId") spaceId: string, @Req() request: FastifyRequest) {
    return this.#portal(request, await this.#services.portals.config(spaceId));
  }

  @Put("spaces/:spaceId/knowledge-base/portal/address")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Change the address of a portal",
    description:
      "Sets the path under `/help/` and the own domain. Old paths keep redirecting until another knowledge base takes them. The change is recorded in the audit log.",
    tags: [TAG],
    params: spaceParams,
    body: addressSchema,
    bodyExample: { path: "help", domain: "help.example.org" },
    response: { description: "The portal after the change.", schema: portalSchema, example: examplePortal },
    errors: [
      "invalidPortalPath",
      "portalPathTaken",
      "invalidPortalDomain",
      "portalDomainNotAllowed",
      "portalDomainTaken",
    ],
  })
  async setAddress(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof addressSchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#portal(request, await this.#services.portals.setAddress(actorOf(request), spaceId, body));
  }

  @Put("spaces/:spaceId/knowledge-base/portal/appearance")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Change the appearance of a portal",
    description:
      "Changes the brand color, the start page and the footer. An own color must reach the contrast WCAG AA asks for in light and dark mode; otherwise the answer `brandContrast` contains the nearest passing shades, which `confirmProposal` saves.",
    tags: [TAG],
    params: spaceParams,
    body: appearanceSchema,
    bodyExample: { brand: { color: "custom", light: "#1F4E99", dark: "#8AA8E6" } },
    response: { description: "The portal after the change.", schema: portalSchema, example: examplePortal },
    errors: [
      "brandContrast",
      "invalidBrandColor",
      "invalidWelcome",
      "invalidTopBarThreshold",
      "invalidRetention",
    ],
  })
  async setAppearance(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof appearanceSchema>,
    @Req() request: FastifyRequest,
  ) {
    const { brand, ...rest } = body;
    const input = {
      ...Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined)),
      ...(brand ? { brand } : {}),
    };
    const updated = await this.#services.portals.updateAppearance(spaceId, input);
    if (body.feedbackRetentionMonths !== undefined)
      await this.#services.portalStatistics.retentionChanged(spaceId);
    return this.#portal(request, updated);
  }

  @Put("spaces/:spaceId/knowledge-base/portal/logo")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Upload the logo of a portal",
    description:
      "Sets the logo in the top bar and on the sign-in page of the portal. PNG, JPEG or WebP, at most 256 KiB.",
    tags: [TAG],
    params: spaceParams,
    body: logoBody,
    bodyExample: { contentType: "image/png", data: "iVBORw0KGgo=" },
    response: { description: "The portal after the change.", schema: portalSchema, example: examplePortal },
    errors: ["invalidLogo"],
  })
  async uploadLogo(
    @Param("spaceId") spaceId: string,
    @Body() body: z.output<typeof logoBody>,
    @Req() request: FastifyRequest,
  ) {
    const updated = await this.#services.portals.setLogo(spaceId, {
      contentType: body.contentType,
      data: Buffer.from(body.data, "base64"),
    });
    return this.#portal(request, updated);
  }

  @Delete("spaces/:spaceId/knowledge-base/portal/logo")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "Remove the logo of a portal",
    description: "The portal shows the organization's logo again, or the first letter of its name.",
    tags: [TAG],
    params: spaceParams,
    response: { description: "The portal after the change.", schema: portalSchema, example: examplePortal },
  })
  async removeLogo(@Param("spaceId") spaceId: string, @Req() request: FastifyRequest) {
    return this.#portal(request, await this.#services.portals.removeLogo(spaceId));
  }

  @Get("spaces/:spaceId/knowledge-base/portal/domains")
  @Permission("space.manage", space)
  @ApiRoute({
    summary: "List the domains a portal can use",
    description:
      "Domains the instance administrators allowed for the organization of the knowledge base that are free or used by this knowledge base. Domains of other knowledge bases are left out.",
    tags: [TAG],
    params: spaceParams,
    response: { description: "The domains.", schema: z.array(domainSchema), example: [exampleDomain] },
    errors: ["notFound"],
  })
  async spaceDomains(@Param("spaceId") spaceId: string): Promise<PortalDomain[]> {
    const config = await this.#services.portals.config(spaceId);
    if (!config) throw notFound();
    const domains = await this.#services.portals.domains(config.organizationId);
    return domains.filter((entry) => entry.spaceId === null || entry.spaceId === spaceId);
  }

  @Get("instance/portal-domains")
  @Permission("instance.settings.manage")
  @ApiRoute({
    summary: "List the domains allowed for portals",
    description:
      "Domains organizations may use for their knowledge base portals, and which portal uses each.",
    tags: [INSTANCE_TAG],
    response: { description: "The domains.", schema: z.array(domainSchema), example: [exampleDomain] },
  })
  async domains(): Promise<PortalDomain[]> {
    return this.#services.portals.domains();
  }

  @Post("instance/portal-domains")
  @Permission("instance.settings.manage")
  @ApiRoute({
    summary: "Allow a domain for portals",
    description:
      "Lets one organization use the domain for one of its knowledge base portals. The reverse proxy must send the domain to Pagehall and hold its certificate. The change is recorded in the audit log.",
    tags: [INSTANCE_TAG],
    status: 201,
    body: allowDomainSchema,
    bodyExample: { domain: "help.example.org", organizationId: exampleDomain.organizationId },
    response: { description: "The allowed domain.", schema: domainSchema, example: exampleDomain },
    errors: ["invalidPortalDomain", "portalDomainExists", "organizationNotFound"],
  })
  async allowDomain(@Body() body: z.output<typeof allowDomainSchema>, @Req() request: FastifyRequest) {
    return this.#services.portals.allowDomain(actorOf(request), body);
  }

  @Delete("instance/portal-domains/:domain")
  @Permission("instance.settings.manage")
  @ApiRoute({
    summary: "Remove a domain for portals",
    description:
      "A knowledge base that used the domain keeps its path on the instance. Readers on the domain are signed out there. The change is recorded in the audit log.",
    tags: [INSTANCE_TAG],
    params: domainParams,
    errors: ["portalDomainNotFound"],
  })
  async removeDomain(@Param("domain") domain: string, @Req() request: FastifyRequest) {
    await this.#services.portals.removeDomain(actorOf(request), domain);
  }

  async #help(request: FastifyRequest, organizationId: string, current: HelpCandidate | null) {
    const instanceUrl = await this.#instanceUrl(request);
    const describe = (candidate: HelpCandidate) => ({
      spaceId: candidate.spaceId,
      name: candidate.name,
      url: portalUrl(instanceUrl, candidate),
    });
    return {
      current: current ? describe(current) : null,
      candidates: (await this.#services.portals.helpCandidates(organizationId)).map(describe),
    };
  }

  @Get("organizations/:organizationId/help")
  @Permission("organization.view", organization)
  @ApiRoute({
    summary: "Where the help icon leads",
    description:
      "The knowledge base the help icon of the app opens, and the knowledge bases that can be chosen.",
    tags: [TAG],
    params: organizationParams,
    response: {
      description: "The help target.",
      schema: helpSchema,
      example: { current: null, candidates: [] },
    },
  })
  async help(@Param("organizationId") organizationId: string, @Req() request: FastifyRequest) {
    return this.#help(request, organizationId, await this.#services.portals.helpTarget(organizationId));
  }

  @Put("organizations/:organizationId/help")
  @Permission("organization.settings.manage", organization)
  @ApiRoute({
    summary: "Choose where the help icon leads",
    description:
      "Points the help icon of the app to a knowledge base of the organization that everyone signed in may read, or back to the Pagehall documentation with null.",
    tags: [TAG],
    params: organizationParams,
    body: helpBodySchema,
    bodyExample: { spaceId: null },
    response: {
      description: "The help target.",
      schema: helpSchema,
      example: { current: null, candidates: [] },
    },
    errors: ["invalidHelpKnowledgeBase"],
  })
  async setHelp(
    @Param("organizationId") organizationId: string,
    @Body() body: z.output<typeof helpBodySchema>,
    @Req() request: FastifyRequest,
  ) {
    return this.#help(
      request,
      organizationId,
      await this.#services.portals.setHelpTarget(organizationId, body.spaceId),
    );
  }
}
