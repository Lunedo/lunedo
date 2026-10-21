import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

const PUBLIC_IPV6 = new BlockList();
PUBLIC_IPV6.addSubnet("2000::", 3, "ipv6");

const RESERVED = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  RESERVED.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
] as const) {
  RESERVED.addSubnet(address, prefix, "ipv6");
}

const MAX_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 3;

export type OutboundFailure =
  | "invalidAddress"
  | "blockedAddress"
  | "insecureAddress"
  | "unresolvable"
  | "timeout"
  | "network"
  | "tooManyRedirects"
  | "untrustedCertificate";

export class OutboundError extends Error {
  override name = "OutboundError";
  readonly reason: OutboundFailure;
  readonly address: string | null;

  constructor(reason: OutboundFailure, message: string, address: string | null = null) {
    super(message);
    this.reason = reason;
    this.address = address;
  }
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export interface OutboundPolicy {
  allowedNetworks: BlockList;
  resolve: Resolver;
}

function familyOf(address: string): "ipv4" | "ipv6" {
  return isIP(address) === 6 ? "ipv6" : "ipv4";
}

function embeddedIpv4(address: string): string | null {
  const lower = address.toLowerCase();
  const mapped = /^(?:0{0,4}:){0,5}(?:0{0,4}:)?ffff:(.+)$|^::ffff:(.+)$|^64:ff9b::(.+)$/.exec(lower);
  const tail = mapped?.[1] ?? mapped?.[2] ?? mapped?.[3];
  if (!tail) return null;
  if (isIP(tail) === 4) return tail;
  const groups = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail);
  if (!groups) return null;
  const high = Number.parseInt(groups[1] as string, 16);
  const low = Number.parseInt(groups[2] as string, 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

export function parseNetworks(entries: readonly string[]): BlockList {
  const list = new BlockList();
  for (const entry of entries) {
    const [address = "", prefix] = entry.split("/");
    if (prefix === undefined) list.addAddress(address, familyOf(address));
    else list.addSubnet(address, Number(prefix), familyOf(address));
  }
  return list;
}

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) return !RESERVED.check(address, "ipv4");
  if (isIP(address) !== 6) return false;
  const inner = embeddedIpv4(address);
  if (inner) return !RESERVED.check(inner, "ipv4");
  return PUBLIC_IPV6.check(address, "ipv6") && !RESERVED.check(address, "ipv6");
}

function isAllowed(policy: OutboundPolicy, address: string): boolean {
  const inner = isIP(address) === 6 ? embeddedIpv4(address) : null;
  if (inner && policy.allowedNetworks.check(inner, "ipv4")) return true;
  return isIP(address) !== 0 && policy.allowedNetworks.check(address, familyOf(address));
}

export function checkAddress(policy: OutboundPolicy, address: string, secure: boolean): void {
  if (isAllowed(policy, address)) return;
  if (!isPublicAddress(address)) {
    throw new OutboundError("blockedAddress", "The address points to a private or reserved network", address);
  }
  if (!secure) throw new OutboundError("insecureAddress", "Public addresses need HTTPS");
}

export const systemResolver: Resolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((entry) => ({
    address: entry.address,
    family: entry.family === 6 ? 6 : 4,
  }));

export function outboundPolicy(
  allowedNetworks: readonly string[],
  resolve: Resolver = systemResolver,
): OutboundPolicy {
  return { allowedNetworks: parseNetworks(allowedNetworks), resolve };
}

export function parseOutboundUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OutboundError("invalidAddress", "The address is not a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new OutboundError("invalidAddress", "The address needs to start with https://");
  }
  if (url.username || url.password) {
    throw new OutboundError("invalidAddress", "The address must not contain a user name or password");
  }
  return url;
}

export function guardedLookup(policy: OutboundPolicy, secure: boolean): LookupFunction {
  return (hostname, options, callback) => {
    policy
      .resolve(hostname)
      .then((addresses) => {
        if (addresses.length === 0) throw new OutboundError("unresolvable", "The host name has no address");
        for (const entry of addresses) checkAddress(policy, entry.address, secure);
        const wanted =
          options.family === 4 || options.family === 6
            ? addresses.filter((entry) => entry.family === options.family)
            : addresses;
        if (options.all) {
          callback(null, wanted);
        } else {
          const first = wanted[0];
          if (!first) throw new OutboundError("unresolvable", "The host name has no address of this family");
          callback(null, first.address, first.family);
        }
      })
      .catch((error: unknown) => {
        const failure =
          error instanceof OutboundError
            ? error
            : new OutboundError("unresolvable", "The host name could not be resolved");
        callback(failure as NodeJS.ErrnoException, "", 0);
      });
  };
}

export interface OutboundRequest {
  url: string;
  method: "GET" | "POST" | "PUT";
  headers: Record<string, string>;
  body: Buffer | string;
  timeoutMs?: number;
  maxRedirects?: number;
}

export interface OutboundResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

async function readLimited(response: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response) {
    const buffer = chunk as Buffer;
    const room = MAX_RESPONSE_BYTES - size;
    chunks.push(buffer.subarray(0, room));
    size += Math.min(buffer.length, room);
    if (size >= MAX_RESPONSE_BYTES) {
      response.destroy();
      break;
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

function once(
  policy: OutboundPolicy,
  url: URL,
  request: OutboundRequest,
  headers: Record<string, string>,
  deadline: number,
): Promise<OutboundResponse> {
  const secure = url.protocol === "https:";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0) checkAddress(policy, host, secure);
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.reject(new OutboundError("timeout", "The request timed out"));
  const body = typeof request.body === "string" ? Buffer.from(request.body, "utf8") : request.body;
  return new Promise((resolve, reject) => {
    const send = secure ? httpsRequest : httpRequest;
    const outgoing = send(
      url,
      {
        method: request.method,
        headers: { ...headers, "content-length": String(body.length) },
        lookup: guardedLookup(policy, secure),
        timeout: remaining,
        agent: false,
      },
      (response) => {
        readLimited(response).then(
          (text) => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: text }),
          () => reject(new OutboundError("network", "The connection broke while reading the answer")),
        );
      },
    );
    const timer = setTimeout(() => {
      outgoing.destroy(new OutboundError("timeout", "The request timed out"));
    }, remaining);
    outgoing.on("close", () => clearTimeout(timer));
    outgoing.on("timeout", () => outgoing.destroy(new OutboundError("timeout", "The request timed out")));
    outgoing.on("error", (error) => {
      reject(
        error instanceof OutboundError
          ? error
          : new OutboundError("network", "The service could not be reached"),
      );
    });
    outgoing.end(body);
  });
}

const CERTIFICATE_ERRORS = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_UNTRUSTED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

export function isCertificateError(code: string | undefined): boolean {
  return CERTIFICATE_ERRORS.has(code ?? "");
}

export interface StreamRequest {
  url: string;
  headers: Record<string, string>;
  timeoutMs?: number;
  idleTimeoutMs?: number;
  ca?: string | undefined;
  signal?: AbortSignal | undefined;
}

export interface StreamResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: IncomingMessage;
}

export function openOutbound(policy: OutboundPolicy, request: StreamRequest): Promise<StreamResponse> {
  const url = parseOutboundUrl(request.url);
  const secure = url.protocol === "https:";
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0) checkAddress(policy, host, secure);
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const idleTimeoutMs = request.idleTimeoutMs ?? timeoutMs;
  return new Promise((resolve, reject) => {
    const send = secure ? httpsRequest : httpRequest;
    const outgoing = send(
      url,
      {
        method: "GET",
        headers: request.headers,
        lookup: guardedLookup(policy, secure),
        agent: false,
        ...(secure && request.ca ? { ca: request.ca } : {}),
        ...(request.signal ? { signal: request.signal } : {}),
      },
      (response) => {
        clearTimeout(timer);
        response.setTimeout(idleTimeoutMs, () =>
          response.destroy(new OutboundError("timeout", "The answer stopped arriving")),
        );
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body: response });
      },
    );
    const timer = setTimeout(() => {
      outgoing.destroy(new OutboundError("timeout", "The request timed out"));
    }, timeoutMs);
    outgoing.on("close", () => clearTimeout(timer));
    outgoing.on("error", (error: NodeJS.ErrnoException) => {
      if (error instanceof OutboundError) reject(error);
      else if (error.name === "AbortError") reject(error);
      else if (CERTIFICATE_ERRORS.has(error.code ?? "")) {
        reject(new OutboundError("untrustedCertificate", "The certificate of the service is not trusted"));
      } else reject(new OutboundError("network", "The service could not be reached"));
    });
    outgoing.end();
  });
}

export async function sendOutbound(
  policy: OutboundPolicy,
  request: OutboundRequest,
): Promise<OutboundResponse> {
  const deadline = Date.now() + (request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxRedirects = request.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  let url = parseOutboundUrl(request.url);
  const origin = url.origin;
  let headers = { ...request.headers };
  for (let hop = 0; ; hop += 1) {
    const response = await once(policy, url, request, headers, deadline);
    const location = response.headers.location;
    if ((response.status !== 307 && response.status !== 308) || !location) return response;
    if (hop >= maxRedirects) throw new OutboundError("tooManyRedirects", "The service redirected too often");
    let next: URL;
    try {
      next = parseOutboundUrl(new URL(location, url).toString());
    } catch {
      throw new OutboundError("invalidAddress", "The service redirected to an invalid address");
    }
    if (next.origin !== origin) {
      headers = Object.fromEntries(
        Object.entries(headers).filter(([name]) => name.toLowerCase() !== "authorization"),
      );
    }
    url = next;
  }
}
