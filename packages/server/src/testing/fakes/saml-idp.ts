import { randomUUID } from "node:crypto";
import { SignedXml } from "xml-crypto";
import { encrypt } from "xml-encryption";
import { generateCertificate } from "../../identity/certificates.js";

const PROTOCOL = "urn:oasis:names:tc:SAML:2.0:protocol";
const ASSERTION = "urn:oasis:names:tc:SAML:2.0:assertion";
export const PERSISTENT = "urn:oasis:names:tc:SAML:2.0:nameid-format:persistent";

const ALGORITHMS = {
  sha256: {
    signature: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    digest: "http://www.w3.org/2001/04/xmlenc#sha256",
  },
  sha1: {
    signature: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
    digest: "http://www.w3.org/2000/09/xmldsig#sha1",
  },
} as const;

export interface SamlAssertionOptions {
  id?: string;
  issuer?: string;
  nameId?: string;
  nameIdXml?: string;
  nameIdFormat?: string;
  audience: string;
  recipient: string;
  requestId: string | null;
  notBefore?: Date;
  notOnOrAfter?: Date;
  authnInstant?: Date;
  attributes?: Record<string, string[]>;
}

export interface SamlResponseOptions extends SamlAssertionOptions {
  destination?: string | null;
  inResponseTo?: string | null;
  signAssertion?: boolean;
  signResponse?: boolean;
  algorithm?: keyof typeof ALGORITHMS;
  encryptFor?: string;
  status?: string;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function bare(certificate: string): string {
  return certificate.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");
}

export interface FakeSamlIdp {
  entityId: string;
  ssoUrl: string;
  certificate: string;
  metadata(): string;
  assertion(options: SamlAssertionOptions): string;
  sign(xml: string, elementId: string, algorithm?: keyof typeof ALGORITHMS): string;
  response(options: SamlResponseOptions): Promise<string>;
  wrap(
    assertionXml: string,
    options: Omit<SamlResponseOptions, keyof SamlAssertionOptions> & {
      recipient: string;
      requestId: string | null;
    },
  ): string;
}

export async function createFakeSamlIdp(
  options: { entityId?: string; ssoUrl?: string } = {},
): Promise<FakeSamlIdp> {
  const key = await generateCertificate({ commonName: "Fake SAML identity provider", validDays: 365 });
  const entityId = options.entityId ?? "https://idp.saml.test/metadata";
  const ssoUrl = options.ssoUrl ?? "https://idp.saml.test/sso";

  const sign = (xml: string, elementId: string, algorithm: keyof typeof ALGORITHMS = "sha256") => {
    const chosen = ALGORITHMS[algorithm];
    const signer = new SignedXml({
      privateKey: key.privateKey,
      publicCert: key.certificate,
      signatureAlgorithm: chosen.signature,
      canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
    });
    signer.addReference({
      xpath: `//*[@ID='${elementId}']`,
      transforms: [
        "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
        "http://www.w3.org/2001/10/xml-exc-c14n#",
      ],
      digestAlgorithm: chosen.digest,
    });
    signer.computeSignature(xml, {
      prefix: "ds",
      location: { reference: `//*[@ID='${elementId}']/*[local-name(.)='Issuer']`, action: "after" },
    });
    return signer.getSignedXml();
  };

  const assertion = (input: SamlAssertionOptions) => {
    const now = new Date();
    const notBefore = input.notBefore ?? new Date(now.getTime() - 60_000);
    const notOnOrAfter = input.notOnOrAfter ?? new Date(now.getTime() + 5 * 60_000);
    const id = input.id ?? `_${randomUUID()}`;
    const attributes = Object.entries(input.attributes ?? {})
      .map(
        ([name, values]) =>
          `<saml:Attribute Name="${escapeXml(name)}">${values
            .map((value) => `<saml:AttributeValue>${escapeXml(value)}</saml:AttributeValue>`)
            .join("")}</saml:Attribute>`,
      )
      .join("");
    const inResponseTo = input.requestId ? ` InResponseTo="${input.requestId}"` : "";
    const nameId =
      input.nameIdXml ??
      `<saml:NameID Format="${input.nameIdFormat ?? PERSISTENT}">${escapeXml(input.nameId ?? "person-1")}</saml:NameID>`;
    return (
      `<saml:Assertion xmlns:saml="${ASSERTION}" ID="${id}" Version="2.0" IssueInstant="${now.toISOString()}">` +
      `<saml:Issuer>${escapeXml(input.issuer ?? entityId)}</saml:Issuer>` +
      `<saml:Subject>${nameId}<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">` +
      `<saml:SubjectConfirmationData${inResponseTo} Recipient="${escapeXml(input.recipient)}" NotOnOrAfter="${notOnOrAfter.toISOString()}"/>` +
      `</saml:SubjectConfirmation></saml:Subject>` +
      `<saml:Conditions NotBefore="${notBefore.toISOString()}" NotOnOrAfter="${notOnOrAfter.toISOString()}">` +
      `<saml:AudienceRestriction><saml:Audience>${escapeXml(input.audience)}</saml:Audience></saml:AudienceRestriction>` +
      `</saml:Conditions>` +
      `<saml:AuthnStatement AuthnInstant="${(input.authnInstant ?? now).toISOString()}" SessionIndex="_session">` +
      `<saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext>` +
      `</saml:AuthnStatement>` +
      (attributes ? `<saml:AttributeStatement>${attributes}</saml:AttributeStatement>` : "") +
      `</saml:Assertion>`
    );
  };

  const wrap: FakeSamlIdp["wrap"] = (assertionXml, input) => {
    const id = `_${randomUUID()}`;
    const inResponseTo =
      input.inResponseTo === undefined
        ? input.requestId
          ? ` InResponseTo="${input.requestId}"`
          : ""
        : input.inResponseTo
          ? ` InResponseTo="${input.inResponseTo}"`
          : "";
    const destination =
      input.destination === null ? "" : ` Destination="${escapeXml(input.destination ?? input.recipient)}"`;
    const response =
      `<samlp:Response xmlns:samlp="${PROTOCOL}" xmlns:saml="${ASSERTION}" ID="${id}" Version="2.0" IssueInstant="${new Date().toISOString()}"${destination}${inResponseTo}>` +
      `<saml:Issuer>${escapeXml(entityId)}</saml:Issuer>` +
      `<samlp:Status><samlp:StatusCode Value="${input.status ?? "urn:oasis:names:tc:SAML:2.0:status:Success"}"/></samlp:Status>` +
      assertionXml +
      `</samlp:Response>`;
    return input.signResponse ? sign(response, id, input.algorithm) : response;
  };

  return {
    entityId,
    ssoUrl,
    certificate: key.certificate,
    metadata: () =>
      `<?xml version="1.0"?><md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${escapeXml(entityId)}">` +
      `<md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">` +
      `<md:KeyDescriptor use="signing"><ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:X509Data><ds:X509Certificate>${bare(key.certificate)}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>` +
      `<md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${escapeXml(ssoUrl)}"/>` +
      `</md:IDPSSODescriptor></md:EntityDescriptor>`,
    assertion,
    sign,
    wrap,
    async response(input) {
      const id = input.id ?? `_${randomUUID()}`;
      let xml = assertion({ ...input, id });
      if (input.signAssertion !== false) xml = sign(xml, id, input.algorithm);
      if (input.encryptFor) {
        const certificate = input.encryptFor;
        const encrypted = await new Promise<string>((resolve, reject) => {
          encrypt(
            xml,
            {
              rsa_pub: certificate,
              pem: certificate,
              encryptionAlgorithm: "http://www.w3.org/2009/xmlenc11#aes256-gcm",
              keyEncryptionAlgorithm: "http://www.w3.org/2001/04/xmlenc#rsa-oaep-mgf1p",
            },
            (error, result) => (error ? reject(error) : resolve(result)),
          );
        });
        xml = `<saml:EncryptedAssertion>${encrypted}</saml:EncryptedAssertion>`;
      }
      return Buffer.from(wrap(xml, input)).toString("base64");
    },
  };
}
