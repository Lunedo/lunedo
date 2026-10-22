import "reflect-metadata";
import { webcrypto } from "node:crypto";
import { type AddressInfo, createServer as createNetServer } from "node:net";
import { createServer, type Server } from "node:tls";
import { ldapConfigSchema } from "@lunedo/shared";
import * as x509 from "@peculiar/x509";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DirectoryConnectionError, type LdapProviderDefinition } from "./adapter.js";
import { guidToBytes, LdapAdapter } from "./ldap.js";
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

  it("sends the service account name unchanged in every form and objectGUID filters as raw bytes", async () => {
    const received: Buffer[] = [];
    const reply = (id: Buffer, operation: number) => {
      const result = Buffer.from([operation, 7, 0x0a, 1, 0, 0x04, 0, 0x04, 0]);
      const body = Buffer.concat([Buffer.from([0x02, id.length]), id, result]);
      return Buffer.concat([Buffer.from([0x30, body.length]), body]);
    };
    const server = createNetServer((socket) => {
      socket.on("data", (data) => {
        received.push(data);
        const first = data[1] ?? 0;
        const start = 2 + (first & 0x80 ? first & 0x7f : 0);
        const id = data.subarray(start + 2, start + 2 + (data[start + 1] ?? 0));
        const operation = data[start + 2 + id.length];
        if (operation === 0x60) socket.write(reply(id, 0x61));
        else if (operation === 0x63) socket.write(reply(id, 0x65));
        else socket.end();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const adapter = new LdapAdapter({ allowInsecure: true });
    const groupId = "6c7e9e97-f5c3-4b1a-8d2e-00000000ff80";
    try {
      for (const bindDn of [
        "CN=svc-lunedo,OU=Service,DC=lunedo,DC=lab",
        "svc-lunedo@lunedo.lab",
        "LUNEDO\\svc-lunedo",
      ]) {
        received.length = 0;
        const provider: LdapProviderDefinition = {
          id: "01929b1e-0000-7000-8000-000000000001",
          name: "Active Directory",
          directoryKey: null,
          type: "ldap",
          caCertificates: null,
          config: ldapConfigSchema.parse({
            preset: "activeDirectory",
            url: `ldap://127.0.0.1:${port}`,
            bindDn,
            userBaseDn: "OU=Users,DC=lunedo,DC=lab",
            groupBaseDn: "OU=Groups,DC=lunedo,DC=lab",
          }),
        };
        const credential = {
          id: "c",
          kind: "bindPassword",
          secret: "password",
          keyId: null,
          certificate: null,
        } as const;
        expect(await adapter.readGroup(provider, [credential], groupId)).toBeNull();
        const sent = Buffer.concat(received);
        const name = Buffer.from(bindDn, "utf8");
        expect(sent.includes(Buffer.concat([Buffer.from([0x04, name.length]), name]))).toBe(true);
        expect(sent.includes(Buffer.concat([Buffer.from([0x04, 16]), guidToBytes(groupId)]))).toBe(true);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("fails a subtree search whose base does not exist and returns nothing for a missing entry", async () => {
    const reply = (id: Buffer, operation: number, code: number) => {
      const result = Buffer.from([operation, 7, 0x0a, 1, code, 0x04, 0, 0x04, 0]);
      const body = Buffer.concat([Buffer.from([0x02, id.length]), id, result]);
      return Buffer.concat([Buffer.from([0x30, body.length]), body]);
    };
    const server = createNetServer((socket) => {
      let pending = Buffer.alloc(0);
      socket.on("data", (data) => {
        pending = Buffer.concat([pending, data]);
        while (pending.length >= 2) {
          const first = pending[1] ?? 0;
          const lengthBytes = first & 0x80 ? first & 0x7f : 0;
          if (pending.length < 2 + lengthBytes) return;
          const length = lengthBytes ? pending.readUIntBE(2, lengthBytes) : first;
          const start = 2 + lengthBytes;
          if (pending.length < start + length) return;
          const message = pending.subarray(start, start + length);
          pending = pending.subarray(start + length);
          const id = message.subarray(2, 2 + (message[1] ?? 0));
          const operation = message[2 + id.length];
          if (operation === 0x60) socket.write(reply(id, 0x61, 0));
          else if (operation === 0x63) socket.write(reply(id, 0x65, 32));
          else socket.end();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    const session = ldaptsConnector({
      url: `ldap://127.0.0.1:${port}`,
      startTls: false,
      caCertificates: null,
      allowInsecure: true,
    });
    try {
      await session.bind("cn=service", "password");
      const search = { filter: "(objectClass=*)", attributes: ["cn"] };
      await expect(session.search("ou=moved,dc=example", { ...search, scope: "sub" })).rejects.toMatchObject({
        reason: "searchFailed",
        message: expect.stringContaining("does not exist"),
      });
      await expect(session.search("cn=gone,dc=example", { ...search, scope: "base" })).resolves.toEqual([]);
    } finally {
      await session.close();
      await new Promise((resolve) => server.close(resolve));
    }
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
    expect(parseCaCertificates(authority).info.subject).toBe("CN=Lunedo Test CA");
    expect(() => parseCaCertificates(serverCertificate)).toThrow(/certificate authority/);
    expect(() => parseCaCertificates("not a certificate")).toThrow();
  });
});
