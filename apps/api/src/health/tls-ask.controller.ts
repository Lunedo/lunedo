import { isIP } from "node:net";
import { Controller, Get, Header, HttpCode, Inject, Query, Req, Res } from "@nestjs/common";
import { normalizeDomain, trustedProxyList } from "@pagehall/server";
import type { FastifyReply, FastifyRequest } from "fastify";
import { PublicRoute } from "../access/route-access.js";
import { API_CONTEXT, type ApiContext } from "../context.js";

export const TLS_ASK_PATH = "/tls/ask";
export const TLS_ASK_LIMIT = 120;
export const TLS_ASK_WINDOW_MS = 60_000;
const MAX_TRACKED_CLIENTS = 10_000;

export class WindowLimiter {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #now: () => number;
  #windowStart = 0;
  #counts = new Map<string, number>();

  constructor(options: { limit: number; windowMs: number; now?: () => number }) {
    this.#limit = options.limit;
    this.#windowMs = options.windowMs;
    this.#now = options.now ?? Date.now;
  }

  allow(key: string): boolean {
    const now = this.#now();
    if (now - this.#windowStart >= this.#windowMs) {
      this.#windowStart = now;
      this.#counts = new Map();
    }
    const count = this.#counts.get(key) ?? 0;
    if (count >= this.#limit) return false;
    if (count === 0 && this.#counts.size >= MAX_TRACKED_CLIENTS) {
      const oldest = this.#counts.keys().next().value;
      if (oldest !== undefined) this.#counts.delete(oldest);
    }
    this.#counts.set(key, count + 1);
    return true;
  }
}

function plainAddress(address: string): string {
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

@Controller("tls")
export class TlsAskController {
  readonly #limiter = new WindowLimiter({ limit: TLS_ASK_LIMIT, windowMs: TLS_ASK_WINDOW_MS });
  readonly #proxies: ReturnType<typeof trustedProxyList>;

  constructor(@Inject(API_CONTEXT) private readonly context: ApiContext) {
    this.#proxies = trustedProxyList(context.trustedProxies, { loopback: true });
  }

  #fromProxyItself(request: FastifyRequest): boolean {
    if (request.headers["x-forwarded-for"] !== undefined) return false;
    const remote = plainAddress(request.socket.remoteAddress ?? "");
    const family = isIP(remote);
    return family !== 0 && this.#proxies.check(remote, family === 6 ? "ipv6" : "ipv4");
  }

  @Get("ask")
  @PublicRoute()
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @Header("Content-Type", "text/plain; charset=utf-8")
  async ask(
    @Query("domain") value: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    if (!this.#fromProxyItself(request) && !this.#limiter.allow(request.ip)) {
      reply.status(429).header("retry-after", String(TLS_ASK_WINDOW_MS / 1000));
      return "";
    }
    const domain = typeof value === "string" ? normalizeDomain(value) : null;
    const portals = this.context.services?.portals;
    const allowed = domain !== null && portals !== undefined && (await portals.isPortalDomain(domain));
    reply.status(allowed ? 200 : 404);
    return "";
  }
}
