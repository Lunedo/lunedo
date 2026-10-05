import "reflect-metadata";
import { createHash, randomBytes, webcrypto } from "node:crypto";
import * as x509 from "@peculiar/x509";

x509.cryptoProvider.set(webcrypto as unknown as Parameters<typeof x509.cryptoProvider.set>[0]);

const ALGORITHM = {
  name: "RSASSA-PKCS1-v1_5",
  hash: "SHA-256",
  publicExponent: new Uint8Array([1, 0, 1]),
  modulusLength: 3072,
} as const;

export interface GeneratedCertificate {
  privateKey: string;
  certificate: string;
  thumbprint: string;
  expiresAt: Date;
}

function pem(label: string, der: ArrayBuffer): string {
  const body = Buffer.from(der)
    .toString("base64")
    .replace(/(.{64})/g, "$1\n")
    .trimEnd();
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

export async function generateCertificate(options: {
  commonName: string;
  validDays: number;
  now?: Date;
}): Promise<GeneratedCertificate> {
  const keys = (await webcrypto.subtle.generateKey(ALGORITHM, true, [
    "sign",
    "verify",
  ])) as webcrypto.CryptoKeyPair;
  const notBefore = new Date((options.now ?? new Date()).getTime() - 60_000);
  const expiresAt = new Date(notBefore.getTime() + options.validDays * 24 * 60 * 60 * 1000);
  const certificate = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: randomBytes(16)
      .toString("hex")
      .replace(/^[89a-f]/, "1"),
    name: `CN=${options.commonName.replace(/[,+=<>#;"\\]/g, " ")}`,
    notBefore,
    notAfter: expiresAt,
    signingAlgorithm: ALGORITHM,
    keys,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
    ],
  });
  const privateKey = await webcrypto.subtle.exportKey("pkcs8", keys.privateKey);
  return {
    privateKey: pem("PRIVATE KEY", privateKey),
    certificate: certificate.toString("pem"),
    thumbprint: createHash("sha1").update(Buffer.from(certificate.rawData)).digest("base64url"),
    expiresAt,
  };
}
