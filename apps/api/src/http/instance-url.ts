import { instanceUrlSetting } from "@lunedo/server";
import type { FastifyRequest } from "fastify";
import type { ApiContext } from "../context.js";
import { ownOrigin } from "./csrf.js";

export async function instanceUrlOf(
  context: Pick<ApiContext, "settings" | "configuredInstanceUrl">,
): Promise<string> {
  const stored = context.settings ? await context.settings.get(instanceUrlSetting, {}) : "";
  return (stored || context.configuredInstanceUrl || "").replace(/\/+$/, "");
}

export async function originOf(
  context: Pick<ApiContext, "settings" | "configuredInstanceUrl">,
  request: FastifyRequest,
): Promise<string> {
  return (await instanceUrlOf(context)) || ownOrigin(request);
}
