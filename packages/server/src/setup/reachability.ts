import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { documentationTargets } from "@lunedo/shared";
import { sql } from "drizzle-orm";
import type { Database } from "../database/database.js";
import { setupSteps } from "./schema.js";

const PROBE_STEP = "systemCheck";
const PROBE_LIFETIME_MS = 60_000;
const PROBE_TIMEOUT_MS = 4_000;
const MAX_ANSWER_BYTES = 1024;
const MAX_REDIRECTS = 3;

const LOOPBACK = new BlockList();
LOOPBACK.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK.addAddress("::1", "ipv6");

const LINK_LOCAL = new BlockList();
LINK_LOCAL.addSubnet("169.254.0.0", 16, "ipv4");
LINK_LOCAL.addSubnet("fe80::", 10, "ipv6");

export const PROBE_PATH = "/api/v1/setup/probe/";

export type ReachabilityCause = "notSet" | "unreachable" | "otherServer" | "loopback";

export interface ReachabilityResult {
  status: "ok" | "warning" | "info";
  cause: ReachabilityCause | null;
  fixCommand: null;
  docs: string;
  url: string | null;
}

export type ProbeFetch = (
  url: string,
  init: { signal: AbortSignal; redirect: "manual" },
) => Promise<Response>;

export type ProbeResolve = (hostname: string) => Promise<string[]>;

export interface ProbeOptions {
  fetch?: ProbeFetch | undefined;
  resolve?: ProbeResolve | undefined;
}

const systemResolve: ProbeResolve = async (hostname) =>
  (await lookup(hostname, { all: true })).map((entry) => entry.address);

function result(url: string | null, cause: ReachabilityCause | null) {
  return {
    status: cause === null ? "ok" : cause === "loopback" ? "info" : "warning",
    cause,
    fixCommand: null,
    docs: documentationTargets.checkAddressReachable,
    url,
  } satisfies ReachabilityResult;
}

export function isLoopbackUrl(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return false;
  }
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const family = isIP(host);
  return family !== 0 && LOOPBACK.check(host, family === 6 ? "ipv6" : "ipv4");
}

function isLinkLocal(address: string): boolean {
  const family = isIP(address);
  return family !== 0 && LINK_LOCAL.check(address, family === 6 ? "ipv6" : "ipv4");
}

function guardedLookup(resolve: ProbeResolve): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname)
      .then((addresses) => {
        if (addresses.length === 0 || addresses.some(isLinkLocal))
          throw new Error("The address is not allowed");
        const entries = addresses.map((address) => ({ address, family: isIP(address) === 6 ? 6 : 4 }));
        const first = entries[0];
        if (options.all) callback(null, entries);
        else if (first) callback(null, first.address, first.family);
      })
      .catch((error: unknown) => callback(error as NodeJS.ErrnoException, "", 0));
  };
}

function headersOf(message: http.IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(message.headers)) {
    for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value])
      headers.append(name, entry);
  }
  return headers;
}

function guardedFetch(resolve: ProbeResolve): ProbeFetch {
  return (url, init) =>
    new Promise((resolved, rejected) => {
      const target = new URL(url);
      const client = target.protocol === "https:" ? https : http;
      const request = client.request(
        target,
        { method: "GET", signal: init.signal, agent: false, lookup: guardedLookup(resolve) },
        (message) => {
          const status = message.statusCode ?? 0;
          const empty = [204, 205, 304].includes(status);
          if (empty) message.resume();
          resolved(
            new Response(empty ? null : (Readable.toWeb(message) as ReadableStream<Uint8Array>), {
              status,
              headers: headersOf(message),
            }),
          );
        },
      );
      request.on("error", rejected);
      request.end();
    });
}

async function allowedTarget(target: URL, resolve: ProbeResolve): Promise<boolean> {
  if (target.protocol !== "https:" && target.protocol !== "http:") return false;
  const host = target.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : await resolve(host);
  return addresses.length > 0 && !addresses.some(isLinkLocal);
}

async function request(start: URL, fetcher: ProbeFetch, resolve: ProbeResolve): Promise<Response | null> {
  const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS);
  let target = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await allowedTarget(target, resolve))) return null;
    const response = await fetcher(target.href, { signal, redirect: "manual" });
    const location =
      response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
    if (!location) return response;
    const next = new URL(location, target);
    if (next.hostname !== start.hostname) return response;
    target = next;
  }
  return null;
}

async function storeProbe(database: Database, challenge: string, answer: string): Promise<void> {
  const entry = { [challenge]: { answer, expiresAt: Date.now() + PROBE_LIFETIME_MS } };
  await database
    .insert(setupSteps)
    .values({ step: PROBE_STEP, state: { probes: entry } })
    .onConflictDoUpdate({
      target: setupSteps.step,
      set: {
        state: sql`jsonb_set(${setupSteps.state}, '{probes}', coalesce(${setupSteps.state}->'probes', '{}'::jsonb) || ${JSON.stringify(entry)}::jsonb)`,
      },
    });
}

async function removeProbe(database: Database, challenge: string): Promise<void> {
  await database.execute(
    sql`update ${setupSteps} set state = state #- array['probes', ${challenge}]::text[] where step = ${PROBE_STEP}`,
  );
}

export async function rememberReachability(database: Database, checked: ReachabilityResult): Promise<void> {
  await database
    .insert(setupSteps)
    .values({ step: PROBE_STEP, state: { reachability: checked } })
    .onConflictDoUpdate({
      target: setupSteps.step,
      set: {
        state: sql`jsonb_set(${setupSteps.state}, '{reachability}', ${JSON.stringify(checked)}::jsonb)`,
      },
    });
}

export function rememberedReachability(
  state: Record<string, unknown>,
  url: string,
): ReachabilityResult | null {
  const stored = state.reachability as ReachabilityResult | undefined;
  return stored && stored.url === url ? stored : null;
}

export async function probeAnswer(database: Database, challenge: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{32,64}$/.test(challenge)) return null;
  const rows = await database.execute<{ answer: string | null; expires_at: string | null }>(
    sql`select state->'probes'->${challenge}->>'answer' as answer,
          state->'probes'->${challenge}->>'expiresAt' as expires_at
        from ${setupSteps} where step = ${PROBE_STEP}`,
  );
  const row = rows.rows[0];
  if (!row?.answer || Number(row.expires_at) < Date.now()) return null;
  return row.answer;
}

async function readAnswer(response: Response): Promise<string | null> {
  if (Number(response.headers.get("content-length") ?? 0) > MAX_ANSWER_BYTES) return null;
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_ANSWER_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { answer?: unknown };
    return typeof parsed.answer === "string" ? parsed.answer : null;
  } catch {
    return null;
  }
}

export async function checkReachability(
  database: Database,
  url: string,
  options: ProbeOptions = {},
): Promise<ReachabilityResult> {
  if (!url) return result(null, "notSet");
  if (isLoopbackUrl(url)) return result(url, "loopback");
  const challenge = randomBytes(32).toString("base64url");
  const answer = randomBytes(32).toString("base64url");
  await storeProbe(database, challenge, answer);
  try {
    const response = await request(
      new URL(`${url.replace(/\/+$/, "")}${PROBE_PATH}${challenge}`),
      options.fetch ?? guardedFetch(options.resolve ?? systemResolve),
      options.resolve ?? systemResolve,
    );
    if (!response) return result(url, "unreachable");
    if (!response.ok) return result(url, "otherServer");
    return (await readAnswer(response)) === answer ? result(url, null) : result(url, "otherServer");
  } catch {
    return result(url, "unreachable");
  } finally {
    await removeProbe(database, challenge);
  }
}
