import { randomBytes } from "node:crypto";
import {
  type CacheProvider,
  type SamlConfig as NodeSamlConfig,
  SAML,
  ValidateInResponseTo,
} from "@node-saml/node-saml";
import { ENTRA_SAML_CLAIMS, type SamlConfig } from "@pagehall/shared";
import type { Element } from "@xmldom/xmldom";
import {
  type AuthorizationRequest,
  type CallbackInput,
  type DirectoryGroupMatch,
  expectType,
  type IdentityProviderAdapter,
  type ProviderCapabilities,
  type ProviderCredential,
  type ProviderDefinition,
  type ProviderGroup,
  ProviderPolicyError,
  type ProviderProfile,
  ProviderResponseError,
  type RedirectSignInResult,
  type SamlProviderDefinition,
  type StartedAuthorization,
  type SynchronizedAccount,
} from "./adapter.js";
import { receivedClaims } from "./claims.js";
import { DirectoryClients, type GraphConfig } from "./directory.js";
import {
  attributeOf,
  child,
  children,
  descendants,
  parseXml,
  SAML_ASSERTION,
  SAML_PROTOCOL,
  textOf,
  XML_DSIG,
  XmlError,
} from "./xml.js";

export const SAML_CLOCK_SKEW_MS = 2 * 60 * 1000;
const REQUEST_LIFETIME_MS = 10 * 60 * 1000;
const RESPONSE_MAX_BYTES = 700_000;
const PERSISTENT_NAME_ID = "urn:oasis:names:tc:SAML:2.0:nameid-format:persistent";
const BEARER = "urn:oasis:names:tc:SAML:2.0:cm:bearer";

const SIGNATURE_ALGORITHMS = new Set([
  "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
  "http://www.w3.org/2001/04/xmldsig-more#rsa-sha384",
  "http://www.w3.org/2001/04/xmldsig-more#rsa-sha512",
  "http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256",
  "http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha384",
  "http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha512",
]);
const DIGEST_ALGORITHMS = new Set([
  "http://www.w3.org/2001/04/xmlenc#sha256",
  "http://www.w3.org/2001/04/xmldsig-more#sha384",
  "http://www.w3.org/2001/04/xmlenc#sha512",
]);

export function samlPaths(providerId: string): { acs: string; metadata: string } {
  const base = `/api/v1/auth/providers/${providerId}/saml`;
  return { acs: `${base}/acs`, metadata: `${base}/metadata` };
}

export function samlEntityId(baseUrl: string, providerId: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${samlPaths(providerId).metadata}`;
}

export function samlCapabilities(config: SamlConfig, graphCredential: boolean): ProviderCapabilities {
  if (config.preset === "entraId") {
    const directorySync = config.graphClientId !== null && graphCredential;
    return { groups: true, directorySync, disabledAccounts: directorySync, groupsByName: false };
  }
  const groups = config.attributes.groups !== null;
  return {
    groups,
    directorySync: false,
    disabledAccounts: false,
    groupsByName: groups && config.groupValues === "names",
  };
}

function graphConfig(config: SamlConfig): GraphConfig | null {
  if (config.preset !== "entraId" || config.graphClientId === null) return null;
  return {
    preset: "entraId",
    authority: config.authority,
    tenantId: config.tenantId,
    clientId: config.graphClientId,
    graphUrl: config.graphUrl,
    emailSource: config.emailSource,
  };
}

function graphCredentials(credentials: readonly ProviderCredential[]): ProviderCredential[] {
  return credentials.filter(
    (credential) => credential.kind === "clientSecret" || credential.kind === "certificate",
  );
}

export function signingCredentials(credentials: readonly ProviderCredential[]): ProviderCredential[] {
  return credentials.filter(
    (credential) => credential.kind === "samlSigning" && credential.certificate !== null,
  );
}

function objectIdOf(subject: string): string {
  return subject.split(":")[1] ?? subject;
}

function guidFromBase64(value: string): string | null {
  if (!/^[A-Za-z0-9+/]{22}==$/.test(value)) return null;
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== 16) return null;
  const hex = (start: number, end: number, reverse: boolean) => {
    const part = [...bytes.subarray(start, end)];
    return (reverse ? part.reverse() : part).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  return `${hex(0, 4, true)}-${hex(4, 6, true)}-${hex(6, 8, true)}-${hex(8, 10, false)}-${hex(10, 16, false)}`;
}

function checkAlgorithms(root: Element): void {
  for (const method of descendants(root, XML_DSIG, "SignatureMethod")) {
    if (!SIGNATURE_ALGORITHMS.has(attributeOf(method, "Algorithm") ?? "")) {
      throw new ProviderResponseError("The response is signed with an algorithm weaker than SHA-256");
    }
  }
  const references = descendants(root, XML_DSIG, "Reference");
  for (const method of references.flatMap((reference) => descendants(reference, XML_DSIG, "DigestMethod"))) {
    if (!DIGEST_ALGORITHMS.has(attributeOf(method, "Algorithm") ?? "")) {
      throw new ProviderResponseError("The response uses a digest weaker than SHA-256");
    }
  }
}

function timeOf(value: string | null, name: string): number {
  const time = value ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(time)) throw new ProviderResponseError(`The assertion has no valid ${name}`);
  return time;
}

interface VerifiedAssertion {
  id: string;
  nameId: string | null;
  nameIdFormat: string | null;
  attributes: Map<string, string[]>;
  authnInstant: number;
  contextClasses: string[];
  expiresAt: Date;
}

function readAssertion(
  xml: string,
  expected: { issuer: string; acsUrl: string; requestId: string | null; now: number },
): VerifiedAssertion {
  const assertion = parseXml(xml).documentElement;
  if (!assertion || assertion.namespaceURI !== SAML_ASSERTION || assertion.localName !== "Assertion") {
    throw new ProviderResponseError("The signed content is not an assertion");
  }
  checkAlgorithms(assertion);
  const id = attributeOf(assertion, "ID");
  if (!id) throw new ProviderResponseError("The assertion has no ID");
  if (textOf(child(assertion, SAML_ASSERTION, "Issuer")) !== expected.issuer) {
    throw new ProviderResponseError("The assertion comes from another issuer");
  }
  const subject = child(assertion, SAML_ASSERTION, "Subject");
  if (!subject) throw new ProviderResponseError("The assertion has no subject");
  const nameIdElement = child(subject, SAML_ASSERTION, "NameID");
  const confirmations = children(subject, SAML_ASSERTION, "SubjectConfirmation").filter(
    (confirmation) => attributeOf(confirmation, "Method") === BEARER,
  );
  let confirmedUntil: number | null = null;
  for (const confirmation of confirmations) {
    const data = child(confirmation, SAML_ASSERTION, "SubjectConfirmationData");
    if (!data) continue;
    if (attributeOf(data, "Recipient") !== expected.acsUrl) continue;
    if ((attributeOf(data, "InResponseTo") ?? null) !== expected.requestId) continue;
    const notOnOrAfter = timeOf(attributeOf(data, "NotOnOrAfter"), "NotOnOrAfter");
    if (notOnOrAfter + SAML_CLOCK_SKEW_MS <= expected.now) continue;
    const notBefore = attributeOf(data, "NotBefore");
    if (notBefore && timeOf(notBefore, "NotBefore") - SAML_CLOCK_SKEW_MS > expected.now) continue;
    confirmedUntil = notOnOrAfter;
    break;
  }
  if (confirmedUntil === null) {
    throw new ProviderResponseError("The assertion is not confirmed for this request, recipient and time");
  }
  const conditions = children(assertion, SAML_ASSERTION, "Conditions");
  if (conditions.length !== 1 || !conditions[0])
    throw new ProviderResponseError("The assertion has no conditions");
  const condition = conditions[0];
  const notOnOrAfter = timeOf(attributeOf(condition, "NotOnOrAfter"), "NotOnOrAfter");
  if (notOnOrAfter + SAML_CLOCK_SKEW_MS <= expected.now)
    throw new ProviderResponseError("The assertion has expired");
  const notBefore = attributeOf(condition, "NotBefore");
  if (notBefore && timeOf(notBefore, "NotBefore") - SAML_CLOCK_SKEW_MS > expected.now) {
    throw new ProviderResponseError("The assertion is not valid yet");
  }
  const statement = child(assertion, SAML_ASSERTION, "AuthnStatement");
  if (!statement) throw new ProviderResponseError("The assertion has no authentication statement");
  const authnInstant = timeOf(attributeOf(statement, "AuthnInstant"), "AuthnInstant");
  const contextClasses = descendants(statement, SAML_ASSERTION, "AuthnContextClassRef").flatMap((element) => {
    const value = textOf(element);
    return value ? [value] : [];
  });
  const attributes = new Map<string, string[]>();
  for (const attributeStatement of children(assertion, SAML_ASSERTION, "AttributeStatement")) {
    for (const attribute of children(attributeStatement, SAML_ASSERTION, "Attribute")) {
      const name = attributeOf(attribute, "Name");
      if (!name) continue;
      const values = children(attribute, SAML_ASSERTION, "AttributeValue").flatMap((value) => {
        const text = textOf(value);
        return text ? [text] : [];
      });
      attributes.set(name, [...(attributes.get(name) ?? []), ...values]);
    }
  }
  return {
    id,
    nameId: textOf(nameIdElement),
    nameIdFormat: nameIdElement ? attributeOf(nameIdElement, "Format") : null,
    attributes,
    authnInstant,
    contextClasses,
    expiresAt: new Date(Math.max(confirmedUntil, notOnOrAfter) + SAML_CLOCK_SKEW_MS),
  };
}

function checkResponse(
  xml: string,
  expected: { issuer: string; acsUrl: string; requestId: string | null; encrypted: boolean },
): void {
  const response = parseXml(xml).documentElement;
  if (!response || response.namespaceURI !== SAML_PROTOCOL || response.localName !== "Response") {
    throw new ProviderResponseError("The message is not a SAML response");
  }
  checkAlgorithms(response);
  const destination = attributeOf(response, "Destination");
  if (destination !== null && destination !== expected.acsUrl) {
    throw new ProviderResponseError("The response is addressed to another destination");
  }
  const issuer = child(response, SAML_ASSERTION, "Issuer");
  if (issuer && textOf(issuer) !== expected.issuer) {
    throw new ProviderResponseError("The response comes from another issuer");
  }
  if ((attributeOf(response, "InResponseTo") ?? null) !== expected.requestId) {
    throw new ProviderResponseError(
      expected.requestId
        ? "The response does not answer the request Pagehall sent"
        : "The response answers an unknown request",
    );
  }
  const status = child(response, SAML_PROTOCOL, "Status");
  const code = status ? child(status, SAML_PROTOCOL, "StatusCode") : null;
  if (!code || attributeOf(code, "Value") !== "urn:oasis:names:tc:SAML:2.0:status:Success") {
    throw new ProviderResponseError("The identity provider did not sign the person in");
  }
  const plain = children(response, SAML_ASSERTION, "Assertion").length;
  const encrypted = children(response, SAML_ASSERTION, "EncryptedAssertion").length;
  if (plain + encrypted !== 1)
    throw new ProviderResponseError("The response must contain exactly one assertion");
  if (expected.encrypted && encrypted !== 1) {
    throw new ProviderResponseError("The provider requires encrypted assertions");
  }
}

function first(attributes: Map<string, string[]>, name: string | null): string | null {
  if (!name) return null;
  return attributes.get(name)?.[0] ?? null;
}

export class SamlAdapter implements IdentityProviderAdapter {
  readonly type = "saml" as const;
  readonly #allowInsecure: boolean;
  readonly #clock: () => Date;
  readonly #directory: DirectoryClients;

  constructor(options: { allowInsecure: boolean; fetch?: typeof fetch; clock?: () => Date }) {
    this.#allowInsecure = options.allowInsecure;
    this.#clock = options.clock ?? (() => new Date());
    this.#directory = new DirectoryClients(options);
  }

  #metadata(provider: SamlProviderDefinition) {
    if (!provider.metadata) throw new ProviderResponseError("The provider has no metadata yet");
    if (new URL(provider.metadata.ssoUrl).protocol !== "https:" && !this.#allowInsecure) {
      throw new ProviderResponseError("Identity providers must be reached through HTTPS");
    }
    return provider.metadata;
  }

  serviceProviderMetadata(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    baseUrl: string,
  ): string {
    const saml = expectType(provider, "saml");
    const signing = signingCredentials(credentials);
    const newest = signing[0];
    if (!newest?.certificate) throw new ProviderResponseError("The provider has no signing certificate");
    const entityId = samlEntityId(baseUrl, saml.id);
    const client = new SAML({
      issuer: entityId,
      callbackUrl: `${baseUrl.replace(/\/+$/, "")}${samlPaths(saml.id).acs}`,
      idpCert: saml.metadata?.certificates ?? [],
      privateKey: newest.secret,
      ...(saml.config.encryptedAssertions ? { decryptionPvk: newest.secret } : {}),
      wantAssertionsSigned: true,
      identifierFormat: this.#identifierFormat(saml.config),
    });
    return client.generateServiceProviderMetadata(
      saml.config.encryptedAssertions ? newest.certificate : null,
      signing.flatMap((credential) => (credential.certificate ? [credential.certificate] : [])),
    );
  }

  #identifierFormat(config: SamlConfig): string | null {
    return config.preset === "generic" && config.identifierAttribute === null ? PERSISTENT_NAME_ID : null;
  }

  async authorizationUrl(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    request: AuthorizationRequest,
  ): Promise<StartedAuthorization> {
    const saml = expectType(provider, "saml");
    const metadata = this.#metadata(saml);
    const signing = signingCredentials(credentials)[0];
    if (!signing) throw new ProviderResponseError("The provider has no signing key");
    let requestId: string | null = null;
    const capture: CacheProvider = {
      async saveAsync(key, value) {
        requestId = key;
        return { value, createdAt: Date.now() };
      },
      async getAsync() {
        return null;
      },
      async removeAsync() {
        return null;
      },
    };
    const base = request.redirectUri.slice(0, -samlPaths(saml.id).acs.length);
    const client = new SAML({
      entryPoint: metadata.ssoUrl,
      issuer: samlEntityId(base, saml.id),
      callbackUrl: request.redirectUri,
      idpCert: metadata.certificates,
      privateKey: signing.secret,
      signatureAlgorithm: "sha256",
      digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
      identifierFormat: this.#identifierFormat(saml.config),
      disableRequestedAuthnContext: true,
      forceAuthn: request.reauthenticate,
      validateInResponseTo: ValidateInResponseTo.always,
      cacheProvider: capture,
      generateUniqueId: () => `_${randomBytes(20).toString("hex")}`,
    });
    const url = new URL(await client.getAuthorizeUrlAsync(request.state, undefined, {}));
    if (!requestId) throw new ProviderResponseError("The request has no ID");
    return { url, requestId };
  }

  async completeSignIn(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    input: CallbackInput,
  ): Promise<RedirectSignInResult> {
    const saml = expectType(provider, "saml");
    const metadata = this.#metadata(saml);
    const encoded = input.samlResponse ?? "";
    if (encoded.length === 0 || encoded.length > (RESPONSE_MAX_BYTES * 4) / 3) {
      throw new ProviderResponseError("The SAML response is missing or too large");
    }
    const acsUrl = input.redirectUri;
    const base = acsUrl.slice(0, -samlPaths(saml.id).acs.length);
    const expected = { issuer: metadata.entityId, acsUrl, requestId: input.requestId };
    try {
      checkResponse(Buffer.from(encoded, "base64").toString("utf8"), {
        ...expected,
        encrypted: saml.config.encryptedAssertions,
      });
    } catch (error) {
      if (error instanceof XmlError) throw new ProviderResponseError(error.message);
      throw error;
    }
    const keys = saml.config.encryptedAssertions ? signingCredentials(credentials) : [null];
    let assertionXml: string | null = null;
    let lastError: unknown = null;
    for (const key of keys) {
      const requestId = input.requestId;
      const cache: CacheProvider = {
        async saveAsync() {
          return null;
        },
        async getAsync(id) {
          return requestId !== null && id === requestId ? new Date().toISOString() : null;
        },
        async removeAsync() {
          return null;
        },
      };
      const options: NodeSamlConfig = {
        issuer: samlEntityId(base, saml.id),
        callbackUrl: acsUrl,
        audience: samlEntityId(base, saml.id),
        idpCert: metadata.certificates,
        idpIssuer: metadata.entityId,
        wantAssertionsSigned: true,
        wantAuthnResponseSigned: saml.config.requireSignedResponse,
        acceptedClockSkewMs: SAML_CLOCK_SKEW_MS,
        maxAssertionAgeMs: 0,
        validateInResponseTo: requestId ? ValidateInResponseTo.always : ValidateInResponseTo.never,
        requestIdExpirationPeriodMs: REQUEST_LIFETIME_MS,
        cacheProvider: cache,
        ...(key ? { decryptionPvk: key.secret } : {}),
      };
      try {
        const { profile } = await new SAML(options).validatePostResponseAsync({ SAMLResponse: encoded });
        assertionXml = profile?.getAssertionXml?.() ?? null;
        if (assertionXml) break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!assertionXml) {
      throw new ProviderResponseError(
        `The SAML response was not accepted: ${(lastError as Error | null)?.message ?? "no assertion"}`,
      );
    }
    let assertion: VerifiedAssertion;
    try {
      assertion = readAssertion(assertionXml, { ...expected, now: this.#clock().getTime() });
    } catch (error) {
      if (error instanceof XmlError) throw new ProviderResponseError(error.message);
      throw error;
    }
    const profile = this.#profile(saml.config, assertion);
    const methods = [
      ...assertion.contextClasses,
      ...(saml.config.preset === "entraId"
        ? (assertion.attributes.get(ENTRA_SAML_CLAIMS.methods) ?? [])
        : []),
    ];
    return {
      profile,
      methods,
      authTime: Math.floor(assertion.authnInstant / 1000),
      providerSessionId: null,
      claims: receivedClaims(assertion.attributes),
      assertion: { id: assertion.id, expiresAt: assertion.expiresAt },
    };
  }

  #profile(config: SamlConfig, assertion: VerifiedAssertion): ProviderProfile {
    const attributes = assertion.attributes;
    if (config.preset === "entraId") {
      const tenant = first(attributes, ENTRA_SAML_CLAIMS.tenantId)?.toLowerCase();
      const objectId = first(attributes, ENTRA_SAML_CLAIMS.objectId)?.toLowerCase();
      if (!tenant || !objectId) throw new ProviderResponseError("The assertion has no tenant or object ID");
      if (tenant !== config.tenantId) {
        throw new ProviderPolicyError("otherTenant", "The assertion comes from another tenant");
      }
      const userPrincipalName = first(attributes, ENTRA_SAML_CLAIMS.userPrincipalName);
      const overage = attributes.has(ENTRA_SAML_CLAIMS.groupsLink);
      return {
        subject: `${tenant}:${objectId}`,
        email:
          config.emailSource === "email" ? first(attributes, ENTRA_SAML_CLAIMS.email) : userPrincipalName,
        signInName: userPrincipalName,
        displayName: first(attributes, ENTRA_SAML_CLAIMS.displayName),
        groups: overage
          ? null
          : (attributes.get(ENTRA_SAML_CLAIMS.groups) ?? []).map((id) => ({
              id: id.toLowerCase(),
              name: null,
            })),
      };
    }
    let subject: string | null;
    if (config.identifierAttribute === null) {
      if (assertion.nameIdFormat !== PERSISTENT_NAME_ID) {
        throw new ProviderResponseError("The assertion has no persistent NameID");
      }
      subject = assertion.nameId;
    } else {
      const value = first(attributes, config.identifierAttribute);
      subject = value ? (guidFromBase64(value) ?? value.toLowerCase()) : null;
    }
    if (!subject) throw new ProviderResponseError("The assertion has no identifier");
    const groups = config.attributes.groups
      ? (attributes.get(config.attributes.groups) ?? []).map((id) => ({
          id,
          name: config.groupValues === "names" ? id : null,
        }))
      : null;
    return {
      subject,
      email: first(attributes, config.attributes.email),
      signInName: first(attributes, config.attributes.signInName),
      displayName: first(attributes, config.attributes.displayName),
      groups,
    };
  }

  hasDirectory(provider: ProviderDefinition): boolean {
    return provider.type === "saml" && graphConfig(provider.config) !== null;
  }

  #graph(provider: ProviderDefinition): { id: string; config: GraphConfig } | null {
    if (provider.type !== "saml") return null;
    const config = graphConfig(provider.config);
    return config ? { id: provider.id, config } : null;
  }

  async readGroups(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    subject: string,
  ): Promise<ProviderGroup[] | null> {
    const graph = this.#graph(provider);
    if (!graph) return null;
    return this.#directory.graphGroupsOf(
      graph.id,
      graph.config,
      graphCredentials(credentials),
      objectIdOf(subject),
    );
  }

  async readProfile(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    subject: string,
  ): Promise<ProviderProfile | null> {
    const graph = this.#graph(provider);
    if (!graph) return null;
    const account = await this.#directory.graphAccount(
      graph.id,
      graph.config,
      graphCredentials(credentials),
      objectIdOf(subject),
    );
    return account
      ? {
          subject,
          email: account.email,
          signInName: account.signInName,
          displayName: account.displayName,
          groups: null,
        }
      : null;
  }

  async *synchronizeAccounts(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    subjects: readonly string[],
  ): AsyncIterable<SynchronizedAccount> {
    const graph = this.#graph(provider);
    if (!graph) return;
    const usable = graphCredentials(credentials);
    for (const subject of subjects) {
      const objectId = objectIdOf(subject);
      const account = await this.#directory.graphAccount(graph.id, graph.config, usable, objectId);
      if (!account) {
        yield { subject, state: "deleted", profile: null };
        continue;
      }
      const groups = await this.#directory.graphGroupsOf(graph.id, graph.config, usable, objectId);
      yield {
        subject,
        state: account.enabled ? "enabled" : "disabled",
        profile: {
          subject,
          email: account.email,
          signInName: account.signInName,
          displayName: account.displayName,
          groups,
        },
      };
    }
  }

  async readGroup(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    groupId: string,
  ): Promise<ProviderGroup | null> {
    const graph = this.#graph(provider);
    if (!graph) throw new ProviderResponseError("The provider has no directory to read groups from");
    return this.#directory.graphGroup(graph.id, graph.config, graphCredentials(credentials), groupId);
  }

  async searchGroups(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    query: string,
  ): Promise<DirectoryGroupMatch[]> {
    const graph = this.#graph(provider);
    if (!graph) return [];
    return this.#directory.graphSearchGroups(graph.id, graph.config, graphCredentials(credentials), query);
  }

  async countMembers(
    provider: ProviderDefinition,
    credentials: readonly ProviderCredential[],
    groupId: string,
  ): Promise<number | null> {
    const graph = this.#graph(provider);
    if (!graph) return null;
    return this.#directory.graphMemberCount(graph.id, graph.config, graphCredentials(credentials), groupId);
  }
}
