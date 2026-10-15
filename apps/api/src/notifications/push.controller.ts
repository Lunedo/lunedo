import { Body, Controller, Delete, Get, Inject, Param, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { InternalRoute, SessionRoute } from "../access/route-access.js";
import { servicesOf } from "../auth/auth.controller.js";
import { API_CONTEXT, type ApiContext } from "../context.js";
import { ApiRoute } from "../http/api-route.js";
import { notFound } from "../http/problems.js";
import { sessionOf } from "../http/request.js";
import { timestamp, uuid } from "../http/schemas.js";

const TAG = "Browser push";

const deviceSchema = z
  .object({
    id: uuid("ID of the device."),
    browser: z.string().nullable().describe("Browser the device signed in with, when known."),
    operatingSystem: z.string().nullable().describe("Operating system of the device, when known."),
    createdAt: timestamp("When browser push was turned on for the device."),
    lastDeliveredAt: timestamp("When the device last received a message.").nullable(),
    current: z.boolean().describe("True for the device of the current session."),
  })
  .describe("A device that receives browser push.");

const pushSchema = z
  .object({
    enabled: z.boolean().describe("Whether browser push is turned on for the instance."),
    publicKey: z
      .string()
      .nullable()
      .describe(
        "Public key the browser needs to subscribe (applicationServerKey), or null while push is off.",
      ),
    devices: z.array(deviceSchema).describe("The caller's devices with browser push."),
  })
  .describe("Browser push of the caller.");

const subscriptionSchema = z
  .object({
    endpoint: z
      .string()
      .min(1)
      .max(2000)
      .describe("Endpoint of the push subscription, as the browser reports it."),
    keys: z
      .object({
        p256dh: z.string().min(1).max(200).describe("Public key of the browser, base64url."),
        auth: z.string().min(1).max(100).describe("Authentication secret of the browser, base64url."),
      })
      .strict()
      .describe("Keys of the push subscription."),
  })
  .strict()
  .describe("The push subscription the browser created.");

const deviceParams = z.object({ deviceId: uuid("ID of the device.") }).strict();

@Controller("api/v1/account/push")
@InternalRoute()
export class PushController {
  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {}

  get #push() {
    return servicesOf(this.context).push;
  }

  @Get()
  @SessionRoute()
  @ApiRoute({
    summary: "Show browser push of the caller",
    tags: [TAG],
    response: { description: "Whether push is on and the caller's devices.", schema: pushSchema },
  })
  async show(@Req() request: FastifyRequest) {
    const session = sessionOf(request);
    const status = await this.#push.status();
    return { ...status, devices: await this.#push.devices(session.accountId, session.id) };
  }

  @Post("devices")
  @SessionRoute()
  @ApiRoute({
    summary: "Turn on browser push for this device",
    description: "Stores the push subscription for the current session. Signing out removes it.",
    tags: [TAG],
    status: 201,
    body: subscriptionSchema,
    response: { description: "The device.", schema: deviceSchema },
    errors: ["pushDisabled", "invalidPushSubscription", "tooManyPushDevices"],
  })
  async subscribe(@Body() body: z.output<typeof subscriptionSchema>, @Req() request: FastifyRequest) {
    const session = sessionOf(request);
    return this.#push.subscribe(session.accountId, session.id, body);
  }

  @Delete("devices/:deviceId")
  @SessionRoute()
  @ApiRoute({
    summary: "Turn off browser push for a device",
    tags: [TAG],
    params: deviceParams,
    errors: ["notFound"],
  })
  async remove(@Param("deviceId") deviceId: string, @Req() request: FastifyRequest) {
    if (!(await this.#push.remove(sessionOf(request).accountId, deviceId))) throw notFound();
  }
}
