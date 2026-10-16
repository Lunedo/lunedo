import { Controller, Get, Inject } from "@nestjs/common";
import type { RenderStatus } from "@pagehall/server";
import { z } from "zod";
import { Permission } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { extensibleEnum, timestamp } from "../http/schemas.js";

const renderingSchema = z
  .object({
    pdf: z
      .object({
        state: extensibleEnum(
          ["notConfigured", "healthy", "unreachable"],
          "`notConfigured` when no render container is set up, `healthy` when it answers, `unreachable` when it does not answer, refuses the token or answers something unexpected.",
        ),
        reason: extensibleEnum(
          ["connection", "token", "response"],
          "Why the container is unreachable: no connection, a token it refuses, or an unexpected answer.",
        ).nullable(),
        url: z
          .string()
          .nullable()
          .describe("Address of the render container, set through PAGEHALL_RENDER_URL."),
        checkedAt: timestamp("When the container was asked.").nullable(),
        version: z.string().nullable().describe("Version of the render container."),
        browser: z.string().nullable().describe("Browser engine of the render container and its version."),
        concurrency: z
          .number()
          .int()
          .nullable()
          .describe("Documents the container renders at the same time."),
        running: z.number().int().nullable().describe("Documents being rendered now."),
        waiting: z.number().int().nullable().describe("Documents waiting now."),
        maxBytes: z
          .number()
          .int()
          .nullable()
          .describe("Largest document with its images the container accepts."),
        timeoutSeconds: z
          .number()
          .int()
          .nullable()
          .describe("Longest time the container spends on one document."),
      })
      .describe("The optional render container that creates PDF files on the server."),
    word: z
      .object({
        available: z
          .boolean()
          .describe("Word documents are created by Pagehall itself and always available."),
      })
      .describe("Word documents."),
  })
  .describe("How pages become PDF and Word files.");

const exampleRendering = {
  pdf: {
    state: "healthy",
    reason: null,
    url: "http://pagehall-render:3000",
    checkedAt: "2026-10-16T09:00:00.000Z",
    version: "1.0.2",
    browser: "Chromium 140.0.7339.80",
    concurrency: 2,
    running: 0,
    waiting: 0,
    maxBytes: 209_715_200,
    timeoutSeconds: 300,
  },
  word: { available: true },
};

function present(status: RenderStatus) {
  const healthy = status.state === "healthy" ? status : null;
  return {
    pdf: {
      state: status.state,
      reason: status.state === "unreachable" ? status.reason : null,
      url: status.state === "notConfigured" ? null : status.url,
      checkedAt: status.state === "notConfigured" ? null : status.checkedAt.toISOString(),
      version: healthy?.version ?? null,
      browser: healthy?.browser ?? null,
      concurrency: healthy?.concurrency ?? null,
      running: healthy?.running ?? null,
      waiting: healthy?.waiting ?? null,
      maxBytes: healthy?.maxBytes ?? null,
      timeoutSeconds: healthy?.timeoutSeconds ?? null,
    },
    word: { available: true },
  };
}

@Controller("api/v1")
export class RenderingController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  @Get("instance/rendering")
  @Permission("instance.settings.view")
  @ApiRoute({
    summary: "Get the state of PDF and Word rendering",
    description:
      "Asks the optional render container for its state and version. Without it, people still create PDF files through the print dialog of their browser; only PDF through the API and PDF of whole spaces in the background need it.",
    tags: ["Exports"],
    response: { description: "The state of rendering.", schema: renderingSchema, example: exampleRendering },
  })
  async status() {
    return present(await servicesOf(this.context).rendering.status());
  }
}
