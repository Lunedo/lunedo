import "reflect-metadata";
import { createHash } from "node:crypto";
import * as x509 from "@peculiar/x509";
import type { SamlIdentityProviderMetadata } from "./adapter.js";
import {
  attributeOf,
  children,
  descendants,
  parseXml,
  SAML_METADATA,
  textOf,
  XML_DSIG,
  XmlError,
} from "./xml.js";

const REDIRECT_BINDING = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect";
const METADATA_TIMEOUT_MS = 10_000;
export const METADATA_MAX_BYTES = 1_000_000;

export class SamlMetadataError extends Error {
  override name = "SamlMetadataError";

  constructor(
    message: string,
    readonly reason: "unreachable" | "status" | "invalid" = "invalid",
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

export interface CertificateInfo {
  fingerprint: string;
  subject: string;
  expiresAt: Date;
}

export function toPem(base64: string): string {
  const body = base64.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body)) throw new SamlMetadataError("A certificate is not valid Base64");
  const lines = body.replace(/(.{64})/g, "$1\n").trimEnd();
  return `-----BEGIN CERTIFICATE-----\n${lines}\n-----END CERTIFICATE-----\n`;
}

export function certificateInfo(pem: string): CertificateInfo {
  const certificate = new x509.X509Certificate(pem);
  return {
    fingerprint: createHash("sha256").update(Buffer.from(certificate.rawData)).digest("hex"),
    subject: certificate.subject,
    expiresAt: certificate.notAfter,
  };
}

const BYTE_ORDER_MARK = "﻿";

export function parseSamlMetadata(source: string): SamlIdentityProviderMetadata {
  const xml = source.startsWith(BYTE_ORDER_MARK) ? source.slice(BYTE_ORDER_MARK.length) : source;
  if (Buffer.byteLength(xml, "utf8") > METADATA_MAX_BYTES) {
    throw new SamlMetadataError("The metadata is larger than 1 MB");
  }
  let document: ReturnType<typeof parseXml>;
  try {
    document = parseXml(xml);
  } catch (error) {
    throw new SamlMetadataError((error as XmlError).message);
  }
  const root = document.documentElement;
  if (!root || root.namespaceURI !== SAML_METADATA) {
    throw new SamlMetadataError("The document is not SAML metadata");
  }
  const entities =
    root.localName === "EntityDescriptor" ? [root] : descendants(root, SAML_METADATA, "EntityDescriptor");
  const providers = entities.filter(
    (entity) => children(entity, SAML_METADATA, "IDPSSODescriptor").length > 0,
  );
  if (providers.length !== 1) {
    throw new SamlMetadataError("The metadata must describe exactly one identity provider");
  }
  const entity = providers[0];
  const descriptor = entity ? children(entity, SAML_METADATA, "IDPSSODescriptor")[0] : undefined;
  if (!entity || !descriptor) throw new SamlMetadataError("The metadata describes no identity provider");
  const entityId = attributeOf(entity, "entityID")?.trim();
  if (!entityId) throw new SamlMetadataError("The metadata has no entity ID");
  const service = children(descriptor, SAML_METADATA, "SingleSignOnService").find(
    (candidate) => attributeOf(candidate, "Binding") === REDIRECT_BINDING,
  );
  const ssoUrl = service ? attributeOf(service, "Location")?.trim() : null;
  if (!ssoUrl) {
    throw new SamlMetadataError("The identity provider offers no sign-in address with the redirect binding");
  }
  try {
    new URL(ssoUrl);
  } catch {
    throw new SamlMetadataError("The sign-in address of the identity provider is not a URL");
  }
  const certificates: string[] = [];
  for (const key of children(descriptor, SAML_METADATA, "KeyDescriptor")) {
    const use = attributeOf(key, "use");
    if (use !== null && use !== "signing") continue;
    for (const element of descendants(key, XML_DSIG, "X509Certificate")) {
      let text: string | null;
      try {
        text = textOf(element);
      } catch (error) {
        throw new SamlMetadataError((error as XmlError).message);
      }
      if (!text) continue;
      const pem = toPem(text);
      try {
        certificateInfo(pem);
      } catch {
        throw new SamlMetadataError("A signing certificate in the metadata cannot be read");
      }
      if (!certificates.includes(pem)) certificates.push(pem);
    }
  }
  if (certificates.length === 0) {
    throw new SamlMetadataError("The metadata contains no signing certificate");
  }
  return { entityId, ssoUrl, certificates };
}

export async function fetchSamlMetadata(
  url: string,
  options: { allowInsecure: boolean; fetch?: typeof fetch },
): Promise<string> {
  if (new URL(url).protocol !== "https:" && !options.allowInsecure) {
    throw new SamlMetadataError("Metadata must be loaded through HTTPS");
  }
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(url, {
      redirect: "error",
      headers: { accept: "application/samlmetadata+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
  } catch (error) {
    throw new SamlMetadataError(
      `The metadata could not be loaded: ${(error as Error).message}`,
      "unreachable",
    );
  }
  if (!response.ok) {
    throw new SamlMetadataError(
      `The metadata address answered ${response.status}`,
      "status",
      response.status,
    );
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > METADATA_MAX_BYTES) throw new SamlMetadataError("The metadata is larger than 1 MB");
  const reader = response.body?.getReader();
  if (!reader) throw new SamlMetadataError("The metadata address returned no content");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > METADATA_MAX_BYTES) {
      await reader.cancel();
      throw new SamlMetadataError("The metadata is larger than 1 MB");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export function samlEndpointsInsecure(metadata: SamlIdentityProviderMetadata): boolean {
  return new URL(metadata.ssoUrl).protocol !== "https:";
}
