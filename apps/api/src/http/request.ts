import type { ClientInfo, Principal, Session } from "@lunedo/server";
import type { FastifyRequest } from "fastify";
import { COOKIES, readCookie } from "./cookies.js";

declare module "fastify" {
  interface FastifyRequest {
    lunedoSession?: Session;
    lunedoPrincipal?: Extract<Principal, { type: "account" }>;
  }
}

export function sessionOf(request: FastifyRequest): Session {
  if (!request.lunedoSession) throw new Error("The route does not declare session access");
  return request.lunedoSession;
}

export function actorOf(request: FastifyRequest): Extract<Principal, { type: "account" }> {
  if (!request.lunedoPrincipal) throw new Error("The route does not declare authenticated access");
  return request.lunedoPrincipal;
}

export function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (!header) return undefined;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1] ?? "";
}

export function carriesCookieCredentials(request: FastifyRequest): boolean {
  return [COOKIES.session, COOKIES.pending, COOKIES.setup, COOKIES.link].some(
    (name) => readCookie(request, name) !== undefined,
  );
}

export function clientOf(request: FastifyRequest, deviceToken?: string): ClientInfo {
  const userAgent = request.headers["user-agent"];
  const device = deviceToken ?? readCookie(request, COOKIES.device);
  return {
    ip: request.ip,
    ...(userAgent ? { userAgent } : {}),
    ...(device ? { deviceToken: device } : {}),
  };
}
