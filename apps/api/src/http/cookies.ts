import type { FastifyReply, FastifyRequest } from "fastify";

export const COOKIES = {
  session: "__Host-pagehall-session",
  pending: "__Host-pagehall-pending",
  device: "__Host-pagehall-device",
  setup: "__Host-pagehall-setup",
} as const;

export type CookieName = (typeof COOKIES)[keyof typeof COOKIES];

const DEVICE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
const PENDING_MAX_AGE_SECONDS = 5 * 60;

export function readCookie(request: FastifyRequest, name: CookieName): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

function serialize(name: CookieName, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

function append(reply: FastifyReply, cookie: string): void {
  const existing = reply.getHeader("set-cookie");
  const list = existing === undefined ? [] : Array.isArray(existing) ? existing : [String(existing)];
  reply.header("set-cookie", [...list, cookie]);
}

export function setCookie(reply: FastifyReply, name: CookieName, value: string, maxAgeSeconds: number): void {
  append(reply, serialize(name, value, maxAgeSeconds));
}

export function clearCookie(reply: FastifyReply, name: CookieName): void {
  append(reply, serialize(name, "", 0));
}

export function setPendingCookie(reply: FastifyReply, token: string): void {
  setCookie(reply, COOKIES.pending, token, PENDING_MAX_AGE_SECONDS);
}

export function ensureDeviceCookie(
  request: FastifyRequest,
  reply: FastifyReply,
  generate: () => string,
): string {
  const existing = readCookie(request, COOKIES.device);
  if (existing && /^[A-Za-z0-9_-]{43}$/.test(existing)) return existing;
  const token = generate();
  setCookie(reply, COOKIES.device, token, DEVICE_MAX_AGE_SECONDS);
  return token;
}
