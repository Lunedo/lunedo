import { Controller, Get, Inject, Param } from "@nestjs/common";
import { defaultEmbedServices } from "@pagehall/server";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { uuid } from "../http/schemas.js";

const TAG = "Embeds";
const organization = { type: "organization", param: "organizationId" } as const;
const organizationParams = z.object({ organizationId: uuid("ID of the organization.") }).strict();

export const embedRuleSchema = z
  .object({
    pattern: z
      .string()
      .describe(
        "Address pattern of a share link, an `https` address with placeholders such as `{video}` for one part of the address and `{*}` for any number of path segments.",
      ),
    embed: z
      .string()
      .describe(
        "Embed address built from the placeholders of the pattern; `{url}` stands for the whole link, encoded.",
      ),
  })
  .describe("How share links of a service become embed addresses.");

export const embedServiceSchema = z
  .object({
    id: z.string().describe("ID of the service, such as `youtube`."),
    name: z.string().describe("Name of the service."),
    rules: z.array(embedRuleSchema).describe("Rules, tried in order."),
  })
  .describe("A service whose content pages can embed.");

const servicesSchema = z
  .object({
    services: z
      .array(embedServiceSchema)
      .describe("Services pages of the organization can embed, in the order they are tried."),
    available: z
      .array(embedServiceSchema)
      .describe(
        "All services of the instance allowlist. The organization can narrow its list to some of them.",
      ),
    narrowed: z.boolean().describe("Whether the organization narrowed the instance allowlist."),
  })
  .describe("Services whose content pages of the organization can embed.");

@Controller("api/v1")
export class EmbedsController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #services() {
    return servicesOf(this.context);
  }

  @Get("organizations/:organizationId/embed-services")
  @Permission("organization.view", organization)
  @ApiRoute({
    summary: "List the services pages can embed",
    description:
      "Returns the external services whose content pages of the organization can embed: the instance allowlist, narrowed by the organization. Links to other addresses are shown as links.",
    tags: [TAG],
    params: organizationParams,
    response: {
      description: "The allowed services.",
      schema: servicesSchema,
      example: {
        services: defaultEmbedServices.slice(0, 1),
        available: defaultEmbedServices.slice(0, 2),
        narrowed: true,
      },
    },
  })
  async list(@Param("organizationId") organizationId: string) {
    return this.#services.embeds.overview(organizationId);
  }
}
