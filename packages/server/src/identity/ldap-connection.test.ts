import "reflect-metadata";
import { webcrypto } from "node:crypto";
import { type AddressInfo, createServer as createNetServer } from "node:net";
import { createServer, type Server } from "node:tls";
import * as x509 from "@peculiar/x509";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DirectoryConnectionError } from "./adapter.js";
import { ldaptsConnector } from "./ldap-connection.js";
import { parseCaCertificates } from "./providers.js";

const ALGORITHM = {
  name: "RSASSA-PKCS1-v1_5",
  hash: "SHA-256",
  publicExponent: new Uint8Array([1, 0, 1]),
  modulusLength: 2048,
} as const;

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
    name: "CN=Pagehall Test CA",
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
    subject: "CN=localhost",
    issuer: authority.subject,
    notBefore: new Date(now - 60_000),
    notAfter: new Date(now + 86_400_000),
    signingAlgorithm: ALGORITHM,
    publicKey: serverKeys.publicKey,
    signingKey: authorityKeys.privateKey,
    extensions: [new x509.SubjectAlternativeNameExtension([{ type: "dns", value: "localhost" }])],
  });
  return {
    authority: authority.toString("pem"),
    server: server.toString("pem"),
    serverKey: pem("PRIVATE KEY", await webcrypto.subtle.exportKey("pkcs8", serverKeys.privateKey)),
  };
}

describe("directory connections", () => {
  let tlsServer: Server;
  let url: string;
  let authority: string;
  let serverCertificate: string;

  beforeAll(async () => {
    const material = await authorityAndServer();
    authority = material.authority;
    serverCertificate = material.server;
    tlsServer = createServer({ key: material.serverKey, cert: material.server }, (socket) => socket.end());
    await new Promise<void>((resolve) => tlsServer.listen(0, "127.0.0.1", resolve));
    url = `ldaps://localhost:${(tlsServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => tlsServer?.close(resolve));
  });

  it("refuses a server certificate from an authority that is not trusted", async () => {
    const session = ldaptsConnector({ url, startTls: false, caCertificates: null, allowInsecure: false });
    const error = await session.bind("cn=service", "password").catch((caught: unknown) => caught);
    await session.close();
    expect(error).toBeInstanceOf(DirectoryConnectionError);
    expect((error as DirectoryConnectionError).reason).toBe("certificateUntrusted");
  });

  it("trusts the server certificate once its authority is uploaded", async () => {
    const session = ldaptsConnector({
      url,
      startTls: false,
      caCertificates: authority,
      allowInsecure: false,
    });
    const error = await session.bind("cn=service", "password").catch((caught: unknown) => caught);
    await session.close();
    expect((error as DirectoryConnectionError | undefined)?.reason).not.toBe("certificateUntrusted");
    expect((error as DirectoryConnectionError | undefined)?.reason).not.toBe("certificateInvalid");
  });

  it("speaks plain LDAP on ldap:// and asks for StartTLS first when configured", async () => {
    const received: Buffer[] = [];
    const plain = createNetServer((socket) => {
      socket.once("data", (data) => {
        received.push(data);
        socket.destroy();
      });
    });
    await new Promise<void>((resolve) => plain.listen(0, "127.0.0.1", resolve));
    const port = (plain.address() as AddressInfo).port;
    try {
      for (const startTls of [false, true]) {
        const session = ldaptsConnector({
          url: `ldap://127.0.0.1:${port}`,
          startTls,
          caCertificates: null,
          allowInsecure: true,
        });
        await session.bind("cn=service", "password").catch(() => undefined);
        await session.close();
      }
    } finally {
      await new Promise((resolve) => plain.close(resolve));
    }
    expect(received.map((data) => data[0])).toEqual([0x30, 0x30]);
    expect(received[0]?.includes(Buffer.from("cn=service"))).toBe(true);
    expect(received[1]?.includes(Buffer.from("1.3.6.1.4.1.1466.20037"))).toBe(true);
  });

  it("refuses a plain connection without the insecure flag before connecting", () => {
    expect(() =>
      ldaptsConnector({
        url: "ldap://localhost:1",
        startTls: false,
        caCertificates: null,
        allowInsecure: false,
      }),
    ).toThrow(DirectoryConnectionError);
  });

  it("accepts only certificates of authorities as uploaded trust", () => {
    expect(parseCaCertificates(authority).info.subject).toBe("CN=Pagehall Test CA");
    expect(() => parseCaCertificates(serverCertificate)).toThrow(/certificate authority/);
    expect(() => parseCaCertificates("not a certificate")).toThrow();
  });
});
