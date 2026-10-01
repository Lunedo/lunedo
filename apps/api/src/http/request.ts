import type { ClientInfo, Session } from "@pagehall/server";
import type { FastifyRequest } from "fastify";
import { COOKIES, readCookie } from "./cookies.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the route access guard on session routes. */
    pagehallSession?: Session;
  }
}

/** The session of a session route. */
export function sessionOf(request: FastifyRequest): Session {
  if (!request.pagehallSession) throw new Error("The route does not declare session access");
  return request.pagehallSession;
}

/** Client address, user agent and device cookie of the request. */
export function clientOf(request: FastifyRequest, deviceToken?: string): ClientInfo {
  const userAgent = request.headers["user-agent"];
  const device = deviceToken ?? readCookie(request, COOKIES.device);
  return {
    ip: request.ip,
    ...(userAgent ? { userAgent } : {}),
    ...(device ? { deviceToken: device } : {}),
  };
}
