import "reflect-metadata";
import { webcrypto } from "node:crypto";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { Readable } from "node:stream";
import * as x509 from "@peculiar/x509";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { outboundPolicy, type Resolver } from "../../outbound/guarded-request.js";
import {
  ConfluenceApi,
  type ConfluenceConnection,
  type ConfluenceTransport,
  guardedTransport,
  retryDelay,
  type TransportResponse,
} from "./api-client.js";

const ALGORITHM = {
  name: "RSASSA-PKCS1-v1_5",
  hash: "SHA-256",
  publicExponent: new Uint8Array([1, 0, 1]),
  modulusLength: 2048,
} as const;
const TOKEN = "personal-access-token-91c2";
const anything = z.looseObject({});

function pem(label: string, der: ArrayBuffer): string {
  const body = Buffer.from(der)
    .toString("base64")
    .replace(/(.{64})/g, "$1\n")
    .trimEnd();
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

async function keys(): Promise<webcrypto.CryptoKeyPair> {
  return (await webcrypto.subtle.generateKey(ALGORITHM, true, ["sign", "verify"])) as webcrypto.CryptoKeyPair;
}

async function authorityAndServer() {
  const authorityKeys = await keys();
  const now = Date.now();
  const authority = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: "01",
    name: "CN=Lunedo Test CA",
    notBefore: new Date(now - 60_000),
    notAfter: new Date(now + 86_400_000),
    signingAlgorithm: ALGORITHM,
    keys: authorityKeys,
    extensions: [
      new x509.BasicConstraintsExtension(true, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.keyCertSign, true),
    ],
  });
  const serverKeys = await keys();
  const server = await x509.X509CertificateGenerator.create({
    serialNumber: "02",
    subject: "CN=wiki.example.com",
    issuer: authority.subject,
    notBefore: new Date(now - 60_000),
    notAfter: new Date(now + 86_400_000),
    signingAlgorithm: ALGORITHM,
    publicKey: serverKeys.publicKey,
    signingKey: authorityKeys.privateKey,
    extensions: [new x509.SubjectAlternativeNameExtension([{ type: "dns", value: "wiki.example.com" }])],
  });
  return {
    authority: authority.toString("pem"),
    server: server.toString("pem"),
    serverKey: pem("PRIVATE KEY", await webcrypto.subtle.exportKey("pkcs8", serverKeys.privateKey)),
  };
}

const resolver: Resolver = async (hostname) =>
  hostname === "wiki.example.com" || hostname === "elsewhere.example.com"
    ? [{ address: "127.0.0.1", family: 4 }]
    : [];

describe("the Confluence API client", () => {
  let server: Server;
  let port: number;
  let authority: string;
  const seen: string[] = [];

  beforeAll(async () => {
    const material = await authorityAndServer();
    authority = material.authority;
    server = createServer({ key: material.serverKey, cert: material.server }, (request, response) => {
      seen.push(`${request.headers.host}${request.url}`);
      if (request.headers.authorization !== `Bearer ${TOKEN}`) {
        response.writeHead(401).end();
        return;
      }
      if (request.url === "/confluence/rest/api/space/MOVED") {
        response.writeHead(302, { location: `https://elsewhere.example.com:${port}/steal` }).end();
        return;
      }
      if (request.url?.startsWith("/confluence/download/")) {
        response.writeHead(302, { location: `https://elsewhere.example.com:${port}/file` }).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const connection = (caCertificates: string | null): ConfluenceConnection => ({
    kind: "dataCenter",
    site: `wiki.example.com:${port}`,
    basePath: "/confluence",
    email: null,
    token: TOKEN,
    caCertificates,
  });

  it("trusts the server only with the certificate of its authority", async () => {
    const allowed = guardedTransport(outboundPolicy(["127.0.0.1/32"], resolver));
    const untrusted = new ConfluenceApi(connection(null), allowed);
    await expect(untrusted.json("/rest/api/space", anything)).rejects.toMatchObject({
      code: "confluenceCertificate",
    });
    const trusted = new ConfluenceApi(connection(authority), allowed);
    await expect(trusted.json("/rest/api/space", anything)).resolves.toEqual({ ok: true });
  });

  it("refuses addresses in private networks unless the instance allows them", async () => {
    const blocked = new ConfluenceApi(connection(authority), guardedTransport(outboundPolicy([], resolver)));
    const before = seen.length;
    await expect(blocked.json("/rest/api/space", anything)).rejects.toMatchObject({
      code: "confluenceBlocked",
    });
    expect(seen.length).toBe(before);
  });

  it("never follows a redirect to another host", async () => {
    const api = new ConfluenceApi(
      connection(authority),
      guardedTransport(outboundPolicy(["127.0.0.1/32"], resolver)),
    );
    seen.length = 0;
    await expect(api.json("/rest/api/space/MOVED", anything)).rejects.toMatchObject({
      code: "confluenceRedirect",
    });
    await expect(api.download("/download/attachments/1/a.png")).resolves.toBeNull();
    expect(seen.every((entry) => entry.startsWith("wiki.example.com"))).toBe(true);
  });

  it("refuses links that leave the configured address", () => {
    const api = new ConfluenceApi(connection(authority), guardedTransport(outboundPolicy([], resolver)));
    for (const path of ["//elsewhere.example.com/x", "https://elsewhere.example.com/x", "/a b", "\\\\host"]) {
      expect(() => api.url(path)).toThrow();
    }
    expect(api.url("/rest/api/space")).toBe(`https://wiki.example.com:${port}/confluence/rest/api/space`);
  });
});

describe("rate limits", () => {
  const ok = (): TransportResponse => ({
    status: 200,
    headers: {},
    body: Readable.from([Buffer.from("{}")]),
  });
  const limited = (headers: Record<string, string>): TransportResponse => ({
    status: 429,
    headers,
    body: Readable.from([]),
  });
  const cloud: ConfluenceConnection = {
    kind: "cloud",
    site: "example.atlassian.net",
    basePath: "",
    email: "a@example.org",
    token: TOKEN,
    caCertificates: null,
  };

  it("reads Retry-After in seconds and as a date and Atlassian's reset header", () => {
    const now = Date.parse("2026-10-17T10:00:00Z");
    expect(retryDelay({ "retry-after": "7" }, now)).toBe(7000);
    expect(retryDelay({ "retry-after": "Sat, 17 Oct 2026 10:00:30 GMT" }, now)).toBe(30_000);
    expect(retryDelay({ "beta-retry-after": "2.5" }, now)).toBe(2500);
    expect(retryDelay({ "x-ratelimit-reset": "2026-10-17T10:01:00Z" }, now)).toBe(60_000);
    expect(retryDelay({}, now)).toBeNull();
  });

  it("waits as long as Confluence asks, reports it and tries again", async () => {
    const answers = [limited({ "retry-after": "3" }), limited({}), ok()];
    const transport: ConfluenceTransport = { get: async () => answers.shift() ?? ok() };
    const waits: number[] = [];
    const throttled: Date[] = [];
    const api = new ConfluenceApi(cloud, transport, {
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
      },
      onThrottle: async (until) => {
        throttled.push(until);
      },
      now: () => 0,
    });
    await expect(api.json("/rest/api/space", anything)).resolves.toEqual({});
    expect(waits[0]).toBeGreaterThanOrEqual(3000);
    expect(waits[0]).toBeLessThan(3400);
    expect(waits).toHaveLength(2);
    expect(throttled).toHaveLength(2);
  });

  it("hands a long pause back to the job queue instead of blocking a worker", async () => {
    const transport: ConfluenceTransport = { get: async () => limited({ "retry-after": "3600" }) };
    const throttled: Date[] = [];
    const api = new ConfluenceApi(cloud, transport, {
      sleep: async () => {},
      onThrottle: async (until) => {
        throttled.push(until);
      },
      now: () => 0,
    });
    await expect(api.json("/rest/api/space", anything)).rejects.toMatchObject({
      code: "confluenceRateLimited",
    });
    expect(throttled[0]?.getTime()).toBe(3_600_000);
  });
});
