import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "../../app.js";
import { initI18n } from "../../i18n/index.js";
import { mockApi, problem, type RecordedRequest } from "../../testing/render.js";

const OLIVIA = {
  id: "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c",
  email: "olivia@example.org",
  name: "Olivia Owner",
};
const SAML = "01929b1e-0000-7000-8000-0000000000a2";
const LDAP = "01929b1e-0000-7000-8000-0000000000a3";
const BASE = "/api/v1/instance/identity-providers";
const PEM = "-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIU\n-----END CERTIFICATE-----\n";

type Handler = (request: RecordedRequest) => { status?: number; body?: unknown };

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal(
    "EventSource",
    class {
      addEventListener() {}
      removeEventListener() {}
      close() {}
    },
  );
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

async function renderPath(path: string) {
  window.history.replaceState(null, "", path);
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
}

function adminApi(overrides: Record<string, Handler> = {}) {
  return mockApi({
    "GET /api/v1/instance/info": () => ({
      body: {
        name: "Example Wiki",
        setupComplete: true,
        language: "en",
        accentColor: "petrol",
        passwordMinLength: 12,
        selfRegistration: false,
        organization: null,
      },
    }),
    "GET /api/v1/auth/session": () => ({
      body: { sessionKind: "full", account: OLIVIA, methods: ["password"], recentlyAuthenticated: true },
    }),
    "GET /api/v1/organizations": () => ({ body: { items: [], nextCursor: null } }),
    "GET /api/v1/account/permissions": () => ({
      body: {
        instance: ["instance.signIn.view", "instance.signIn.manage"],
        organization: [],
        grantableAreas: { instance: {}, organization: {} },
      },
    }),
    "GET /api/v1/account/preferences": () => ({ body: [] }),
    "GET /api/v1/notifications/unread-count": () => ({ body: { count: 0 } }),
    "GET /api/v1/instance/settings": () => ({ body: { items: [], nextCursor: null } }),
    ...overrides,
  });
}

const common = {
  logoRef: null,
  directoryKey: false,
  deactivatedAt: null,
  setupComplete: true,
  createdAt: "2026-09-01T08:00:00.000Z",
  updatedAt: "2026-09-01T08:00:00.000Z",
};

function samlProvider(patch: Record<string, unknown> = {}, metadata: Record<string, unknown> = {}) {
  return {
    ...common,
    id: SAML,
    type: "saml",
    name: "ADFS · Verlag",
    issuer: "http://adfs.verlag.example/adfs/services/trust",
    redirectUri: `https://wiki.example.org/api/v1/auth/providers/${SAML}/saml/acs`,
    credentials: [
      {
        id: "01929b1e-0000-7000-8000-0000000000b2",
        kind: "samlSigning",
        keyId: null,
        expiresAt: "2028-10-01T00:00:00.000Z",
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ],
    capabilities: { groups: true, directorySync: false, disabledAccounts: false, groupsByName: false },
    warnings: [],
    config: {
      preset: "adfs",
      domains: ["verlag.example"],
      metadata: {
        source: "url",
        url: "https://adfs.verlag.example/FederationMetadata/2007-06/FederationMetadata.xml",
      },
      idpInitiated: false,
      requireSignedResponse: false,
      encryptedAssertions: false,
      accountCreation: { enabled: false, requiredGroups: [] },
      sync: { intervalMinutes: 60, deactivationLimitPercent: 20, deactivationLimitAccounts: 5 },
      secondFactor: { mode: "provider", proofValues: ["mfa"] },
      identifierAttribute: "objectGUID",
      attributes: {
        email: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
        signInName: null,
        displayName: null,
        groups: "http://schemas.xmlsoap.org/claims/Group",
      },
      groupValues: "names",
    },
    saml: {
      entityId: "https://wiki.example.org/api/v1/auth/providers/saml",
      metadataUrl: `https://wiki.example.org/api/v1/auth/providers/${SAML}/saml/metadata`,
      identityProvider: {
        entityId: "http://adfs.verlag.example/adfs/services/trust",
        ssoUrl: "https://adfs.verlag.example/adfs/ls/",
        certificates: [
          {
            fingerprint: "AB:CD",
            subject: "CN=ADFS Signing - adfs.verlag.example",
            expiresAt: "2027-05-01T00:00:00.000Z",
          },
        ],
        fetchedAt: "2026-10-03T08:00:00.000Z",
        refreshFailedAt: null,
        refreshError: null,
        ...metadata,
      },
    },
    ...patch,
  };
}

function ldapProvider(patch: Record<string, unknown> = {}, config: Record<string, unknown> = {}) {
  return {
    ...common,
    id: LDAP,
    type: "ldap",
    name: "Active Directory · Verlag",
    issuer: "ldaps://dc01.verlag.example",
    redirectUri: "https://wiki.example.org/sign-in",
    credentials: [
      {
        id: "01929b1e-0000-7000-8000-0000000000b3",
        kind: "bindPassword",
        keyId: null,
        expiresAt: null,
        createdAt: "2026-10-01T00:00:00.000Z",
      },
    ],
    capabilities: { groups: true, directorySync: true, disabledAccounts: true, groupsByName: false },
    warnings: [],
    config: {
      preset: "activeDirectory",
      url: "ldaps://dc01.verlag.example",
      startTls: false,
      bindDn: "CN=pagehall,OU=Service,DC=verlag,DC=example",
      userBaseDn: "OU=Staff,DC=verlag,DC=example",
      groupBaseDn: "OU=Groups,DC=verlag,DC=example",
      domains: ["verlag.example"],
      accountCreation: { enabled: false, requiredGroups: [] },
      sync: { intervalMinutes: 60, deactivationLimitPercent: 20, deactivationLimitAccounts: 5 },
      secondFactor: { mode: "pagehall" },
      userFilter: "(&(objectCategory=person)(objectClass=user))",
      groupFilter: "(objectClass=group)",
      signInAttribute: "userPrincipalName",
      attributes: { email: "mail", displayName: "displayName" },
      ...config,
    },
    ldap: { caCertificate: null },
    ...patch,
  };
}

const DRAFTS = "/api/v1/instance/identity-provider-drafts";

function draftApi(id: string, type: "saml" | "ldap", preset: string) {
  let current: Record<string, unknown> = {
    id,
    type,
    preset,
    name: type === "saml" ? "SAML 2.0" : "LDAP or Active Directory",
    fields: {},
    redirectUri:
      type === "saml"
        ? `https://wiki.example.org/api/v1/auth/providers/${id}/saml/acs`
        : "https://wiki.example.org/sign-in",
    saml:
      type === "saml"
        ? {
            entityId: `https://wiki.example.org/api/v1/auth/providers/${id}/saml/metadata`,
            metadataUrl: `https://wiki.example.org/api/v1/auth/providers/${id}/saml/metadata`,
            signingCredentialId: "01929b1e-0000-7000-8000-0000000000d1",
          }
        : null,
    createdAt: "2026-10-04T08:00:00.000Z",
    updatedAt: "2026-10-04T08:00:00.000Z",
  };
  return {
    [`POST ${DRAFTS}`]: () => ({ status: 201, body: current }),
    [`GET ${DRAFTS}/${id}`]: () => ({ body: current }),
    [`PATCH ${DRAFTS}/${id}`]: (request: RecordedRequest) => {
      current = { ...current, ...(request.body as object) };
      return { body: current };
    },
  };
}

function bodyOf(requests: RecordedRequest[], method: string, path: string) {
  return requests.find((request) => request.method === method && request.path === path)?.body;
}

describe("adding a SAML provider", () => {
  it("creates it from a metadata file, explains bad metadata and shows Pagehall's details", async () => {
    let refuse = true;
    const { requests } = adminApi({
      [`POST ${BASE}`]: () =>
        refuse
          ? problem(400, "invalidSamlMetadata", { detail: "The metadata has no signing certificate" })
          : { status: 201, body: { provider: samlProvider(), credential: null } },
      [`GET ${BASE}/${SAML}`]: () => ({ body: samlProvider() }),
      [`GET ${BASE}`]: () => ({ body: [samlProvider()] }),
      ...draftApi(SAML, "saml", "entraId"),
    });
    await renderPath("/settings/instance/sign-in-providers/new");
    await userEvent.click(await screen.findByRole("button", { name: /SAML 2\.0/ }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Connect a SAML 2.0 provider" })).toBeTruthy();
    expect(bodyOf(requests, "POST", DRAFTS)).toEqual({ type: "saml", preset: "entraId", name: "SAML 2.0" });
    expect(
      screen.getAllByDisplayValue(`https://wiki.example.org/api/v1/auth/providers/${SAML}/saml/metadata`),
    ).toHaveLength(2);
    expect(
      screen.getByDisplayValue(`https://wiki.example.org/api/v1/auth/providers/${SAML}/saml/acs`),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Download metadata" }).getAttribute("href")).toBe(
      `https://wiki.example.org/api/v1/auth/providers/${SAML}/saml/metadata`,
    );
    expect(screen.getByRole("link", { name: "Download certificate" }).getAttribute("href")).toBe(
      `${BASE}/${SAML}/credentials/01929b1e-0000-7000-8000-0000000000d1/certificate`,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Active Directory Federation Services" }));
    await userEvent.clear(screen.getByLabelText("Name on the sign-in page"));
    await userEvent.type(screen.getByLabelText("Name on the sign-in page"), "ADFS · Verlag");
    await userEvent.click(screen.getByRole("radio", { name: "Uploaded file" }));
    await userEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(await screen.findByText("Choose the metadata file of the identity provider.")).toBeTruthy();
    expect(requests.some((request) => request.method === "POST" && request.path === BASE)).toBe(false);

    await userEvent.upload(
      screen.getByLabelText("Choose metadata file"),
      new File(["<EntityDescriptor/>"], "adfs.xml", { type: "text/xml" }),
    );
    expect(await screen.findByText("adfs.xml")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Domains"), "verlag.example");
    await userEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(
      await screen.findByText(
        /Pagehall could not use the SAML metadata: The metadata has no signing certificate/,
      ),
    ).toBeTruthy();

    refuse = false;
    await userEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(await screen.findByLabelText("Attribute for the identifier")).toBeTruthy();
    expect(bodyOf(requests, "POST", BASE)).toEqual({
      type: "saml",
      name: "ADFS · Verlag",
      draftId: SAML,
      config: { preset: "adfs", domains: ["verlag.example"], metadata: { source: "file" } },
      metadataXml: "<EntityDescriptor/>",
    });
  });

  it("asks for the tenant and the metadata address of Entra ID", async () => {
    const { requests } = adminApi({
      [`POST ${BASE}`]: () => ({ status: 201, body: { provider: samlProvider(), credential: null } }),
      [`GET ${BASE}/${SAML}`]: () => ({ body: samlProvider() }),
      ...draftApi(SAML, "saml", "entraId"),
    });
    await renderPath("/settings/instance/sign-in-providers/new");
    await userEvent.click(await screen.findByRole("button", { name: /SAML 2\.0/ }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.clear(await screen.findByLabelText("Name on the sign-in page"));
    await userEvent.type(screen.getByLabelText("Name on the sign-in page"), "Microsoft");
    await userEvent.type(screen.getByLabelText("Directory (tenant) ID"), "not a tenant");
    await userEvent.type(screen.getByLabelText("Metadata address"), "ftp://example.org");
    await userEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(await screen.findByText(/Enter the tenant ID as shown in Entra ID/)).toBeTruthy();
    expect(screen.getByText("Enter a valid address.")).toBeTruthy();

    await userEvent.clear(screen.getByLabelText("Directory (tenant) ID"));
    await userEvent.type(
      screen.getByLabelText("Directory (tenant) ID"),
      "3f2a9c1e-7b4d-4e8a-9c21-5d6f0a8b2e17",
    );
    await userEvent.clear(screen.getByLabelText("Metadata address"));
    await userEvent.type(
      screen.getByLabelText("Metadata address"),
      "https://login.microsoftonline.com/3f2a9c1e/federationmetadata/2007-06/federationmetadata.xml",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    await waitFor(() =>
      expect(bodyOf(requests, "POST", BASE)).toEqual({
        type: "saml",
        name: "Microsoft",
        draftId: SAML,
        config: {
          preset: "entraId",
          domains: [],
          tenantId: "3f2a9c1e-7b4d-4e8a-9c21-5d6f0a8b2e17",
          metadata: {
            source: "url",
            url: "https://login.microsoftonline.com/3f2a9c1e/federationmetadata/2007-06/federationmetadata.xml",
          },
        },
      }),
    );
  });
});

describe("adding an LDAP directory", () => {
  it("creates it with the service account password and uploads the CA certificate", async () => {
    const { requests } = adminApi({
      [`POST ${BASE}`]: () => ({ status: 201, body: { provider: ldapProvider(), credential: null } }),
      [`PUT ${BASE}/${LDAP}/ca-certificate`]: () => ({ body: ldapProvider() }),
      [`GET ${BASE}/${LDAP}`]: () => ({ body: ldapProvider() }),
      ...draftApi(LDAP, "ldap", "activeDirectory"),
    });
    await renderPath("/settings/instance/sign-in-providers/new");
    await userEvent.click(await screen.findByRole("button", { name: /LDAP or Active Directory/ }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Connect a directory" })).toBeTruthy();
    expect(screen.queryByText(/Enter these values at/)).toBeNull();
    await userEvent.clear(screen.getByLabelText("Name on the sign-in page"));
    await userEvent.type(screen.getByLabelText("Name on the sign-in page"), "Active Directory · Verlag");
    await userEvent.type(screen.getByLabelText("Server address"), "ldap://dc01.verlag.example");
    expect(screen.getByText(/Without StartTLS, passwords travel unencrypted/)).toBeTruthy();
    await userEvent.click(screen.getByRole("switch", { name: "Use StartTLS" }));
    expect(screen.queryByText(/Without StartTLS, passwords travel unencrypted/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    expect((await screen.findAllByText(/Enter a distinguished name/)).length).toBe(3);
    expect(screen.getByText("This field is required.")).toBeTruthy();

    expect(screen.getByText(/Enter a distinguished name, a user principal name/)).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Service account"), "svc-pagehall@verlag.example");
    await userEvent.type(screen.getByLabelText("Password of the service account"), "bind secret");
    await userEvent.type(screen.getByLabelText("Base DN for people"), "OU=Staff,DC=verlag,DC=example");
    await userEvent.type(screen.getByLabelText("Base DN for groups"), "OU=Groups,DC=verlag,DC=example");
    await userEvent.type(screen.getByLabelText("Domains"), "verlag.example");
    await userEvent.upload(
      screen.getByLabelText("Upload CA certificate"),
      new File([PEM], "verlag-ca.pem", { type: "application/x-pem-file" }),
    );
    expect(await screen.findByText("verlag-ca.pem")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(await screen.findByRole("combobox", { name: "Sign-in name" })).toBeTruthy();
    expect(bodyOf(requests, "POST", BASE)).toEqual({
      type: "ldap",
      name: "Active Directory · Verlag",
      draftId: LDAP,
      config: {
        preset: "activeDirectory",
        url: "ldap://dc01.verlag.example",
        startTls: true,
        bindDn: "svc-pagehall@verlag.example",
        userBaseDn: "OU=Staff,DC=verlag,DC=example",
        groupBaseDn: "OU=Groups,DC=verlag,DC=example",
        domains: ["verlag.example"],
      },
      credential: { kind: "bindPassword", secret: "bind secret" },
    });
    expect(bodyOf(requests, "PUT", `${BASE}/${LDAP}/ca-certificate`)).toEqual({ certificate: PEM });
  });

  it("shows an invalid server address at the field and understands a host name as ldaps:// on port 636", async () => {
    adminApi({ ...draftApi(LDAP, "ldap", "activeDirectory") });
    await renderPath("/settings/instance/sign-in-providers/new");
    await userEvent.click(await screen.findByRole("button", { name: /LDAP or Active Directory/ }));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    const field = await screen.findByLabelText("Server address");
    await userEvent.type(field, "dc01 .verlag.example");
    await userEvent.click(screen.getByRole("button", { name: "Save and continue" }));
    expect(
      await screen.findByText("Enter an address such as ldaps://dc01.example.org, without a path."),
    ).toBeTruthy();
    await userEvent.clear(field);
    await userEvent.type(field, "dc01.verlag.example");
    await userEvent.tab();
    expect(await screen.findByDisplayValue("ldaps://dc01.verlag.example:636")).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Use StartTLS" })).toBeNull();
  });

  it("goes back to the connection after saving and links a missing CA certificate to it as a warning", async () => {
    adminApi({
      [`GET ${BASE}/${LDAP}`]: () => ({ body: ldapProvider() }),
      [`POST ${BASE}/${LDAP}/directory-test`]: () => ({
        body: {
          steps: [
            { step: "connection", ok: true, detail: null },
            {
              step: "certificate",
              ok: false,
              detail: "The certificate of the directory server is not trusted",
            },
          ],
          sample: null,
          attributes: [],
        },
      }),
    });
    await renderPath(`/settings/instance/sign-in-providers/new?providerId=${LDAP}&step=2`);
    await userEvent.click(await screen.findByRole("button", { name: "Read attributes" }));
    const warning = await screen.findByText(
      "Upload the CA certificate that issued the server's certificate, then test again.",
    );
    expect(warning).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Go to the CA certificate" }));
    expect(await screen.findByRole("heading", { name: "CA certificate" })).toBeTruthy();
    expect(screen.getByLabelText("Server address")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("button", { name: "Read attributes" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "CA certificate" })).toBeTruthy();
    await userEvent.click(
      within(screen.getByRole("navigation", { name: "Steps" })).getByRole("button", { name: /Test/ }),
    );
    expect(await screen.findByRole("button", { name: "Test the directory" })).toBeTruthy();
    await userEvent.click(
      within(screen.getByRole("navigation", { name: "Steps" })).getByRole("button", { name: /Connection/ }),
    );
    expect(await screen.findByRole("heading", { name: "CA certificate" })).toBeTruthy();
  });

  it("explains a failed directory test, takes the CA certificate right there and tests again", async () => {
    let trusted = false;
    const { requests } = adminApi({
      [`GET ${BASE}/${LDAP}`]: () => ({ body: ldapProvider() }),
      [`PUT ${BASE}/${LDAP}/ca-certificate`]: (request) => {
        trusted = (request.body as { certificate: string }).certificate === PEM;
        return trusted
          ? {
              body: ldapProvider({
                ldap: {
                  caCertificate: {
                    fingerprint: "12:34",
                    subject: "CN=Verlag Root CA",
                    expiresAt: "2030-01-01T00:00:00.000Z",
                  },
                },
              }),
            }
          : problem(400, "invalidCertificate");
      },
      [`POST ${BASE}/${LDAP}/directory-test`]: () =>
        trusted
          ? {
              body: {
                steps: [
                  { step: "connection", ok: true, detail: null },
                  { step: "certificate", ok: true, detail: null },
                  { step: "serviceAccount", ok: true, detail: null },
                  { step: "search", ok: true, detail: null },
                ],
                sample: {
                  subject: "6f1b2c3d-0000-4000-8000-000000000001",
                  email: "lena.hofer@verlag.example",
                  signInName: "lena.hofer@verlag.example",
                  displayName: "Lena Hofer",
                  groups: [{ id: "CN=Redaktion-Wien,OU=Groups", name: "Redaktion Wien" }],
                },
                attributes: [{ name: "department", values: ["Redaktion"] }],
              },
            }
          : {
              body: {
                steps: [
                  { step: "connection", ok: true, detail: null },
                  {
                    step: "certificate",
                    ok: false,
                    detail: "The LDAPS certificate of dc01.verlag.example is not trusted",
                  },
                ],
                sample: null,
                attributes: [],
              },
            },
    });
    await renderPath(`/settings/instance/sign-in-providers/new?providerId=${LDAP}&step=4`);
    await userEvent.type(
      await screen.findByLabelText("Sign-in name of a test person"),
      "lena.hofer@verlag.example",
    );
    await userEvent.click(screen.getByRole("button", { name: "Test the directory" }));
    expect(await screen.findByText("Check failed: Server certificate")).toBeTruthy();
    expect(screen.getByText("The LDAPS certificate of dc01.verlag.example is not trusted")).toBeTruthy();
    expect(screen.getByText(/Upload the CA certificate that issued the server's certificate/)).toBeTruthy();
    const checks = screen.getByRole("list", { name: "Checks" });
    expect(within(checks).getAllByText("Passed")).toHaveLength(1);
    expect(within(checks).getByText("Failed")).toBeTruthy();
    expect(within(checks).getAllByText("Not checked")).toHaveLength(2);
    expect(bodyOf(requests, "POST", `${BASE}/${LDAP}/directory-test`)).toEqual({
      signInName: "lena.hofer@verlag.example",
    });

    await userEvent.upload(
      screen.getByLabelText("Upload CA certificate"),
      new File(["not a certificate"], "wrong.pem", { type: "application/x-pem-file" }),
    );
    expect(await screen.findByText(/This file is not a CA certificate Pagehall can use/)).toBeTruthy();

    await userEvent.upload(
      screen.getByLabelText("Upload CA certificate"),
      new File([PEM], "verlag-ca.pem", { type: "application/x-pem-file" }),
    );
    expect(await screen.findByText("The directory works")).toBeTruthy();
    expect(screen.getByText("Lena Hofer")).toBeTruthy();
    expect(screen.getByText("Redaktion Wien")).toBeTruthy();
    expect(screen.getByText("Attributes the directory returned")).toBeTruthy();
    expect(screen.getByText("department")).toBeTruthy();
    expect(requests.filter((request) => request.path === `${BASE}/${LDAP}/directory-test`).length).toBe(2);
  });

  it("shows what failed when the directory cannot be reached", async () => {
    adminApi({
      [`GET ${BASE}/${LDAP}`]: () => ({ body: ldapProvider() }),
      [`POST ${BASE}/${LDAP}/directory-test`]: () => ({
        body: {
          steps: [{ step: "connection", ok: false, detail: "dc01.verlag.example:636 did not answer" }],
          sample: null,
          attributes: [],
        },
      }),
    });
    await renderPath(`/settings/instance/sign-in-providers/new?providerId=${LDAP}&step=4`);
    await userEvent.click(await screen.findByRole("button", { name: "Test the directory" }));
    expect(await screen.findByText("Check failed: Connection to the server")).toBeTruthy();
    expect(screen.getByText(/Check the server address, the port and the firewall/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Upload CA certificate" })).toBeNull();
  });
});

describe("SAML and LDAP providers in the list and the details", () => {
  it("filters by type and warns about failed metadata and expiring CA certificates", async () => {
    adminApi({
      [`GET ${BASE}`]: () => ({
        body: [
          samlProvider(
            { warnings: ["metadataRefreshFailed"] },
            { refreshFailedAt: "2026-10-04T06:00:00.000Z", refreshError: "The server answered with 503" },
          ),
          ldapProvider({
            warnings: ["caCertificateExpiring"],
            ldap: {
              caCertificate: {
                fingerprint: "12:34",
                subject: "CN=Verlag Root CA",
                expiresAt: "2026-10-20T00:00:00.000Z",
              },
            },
          }),
        ],
      }),
    });
    await renderPath("/settings/instance/sign-in-providers");
    expect(
      await screen.findByText(
        /Metadata of ADFS · Verlag could not be refreshed at .*: The server answered with 503\. Pagehall keeps using the last good metadata\./,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/The CA certificate of Active Directory · Verlag expires on/)).toBeTruthy();
    const table = screen.getByRole("table", { name: "Identity providers" });
    expect(within(table).getByText("Active Directory Federation Services")).toBeTruthy();
    await userEvent.click(screen.getByRole("combobox", { name: "Filter by type" }));
    await userEvent.click(await screen.findByRole("option", { name: "LDAP" }));
    await waitFor(() => expect(within(table).queryByText("ADFS · Verlag")).toBeNull());
    expect(within(table).getByText("Active Directory · Verlag")).toBeTruthy();
  });

  it("loads the metadata again and explains why it failed", async () => {
    let fail = true;
    const { requests } = adminApi({
      [`GET ${BASE}/${SAML}`]: () => ({ body: samlProvider() }),
      [`GET ${BASE}`]: () => ({ body: [samlProvider()] }),
      [`POST ${BASE}/${SAML}/saml-metadata/refresh`]: () =>
        fail
          ? problem(400, "invalidSamlMetadata", { detail: "The metadata is signed with an unknown key" })
          : { body: samlProvider({}, { fetchedAt: "2026-10-04T09:00:00.000Z" }) },
    });
    await renderPath(`/settings/instance/sign-in-providers/${SAML}`);
    expect(await screen.findByText("CN=ADFS Signing - adfs.verlag.example")).toBeTruthy();
    expect(screen.getByText("https://adfs.verlag.example/adfs/ls/")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Load again" }));
    expect(
      await screen.findByText(
        /Pagehall could not use the SAML metadata: The metadata is signed with an unknown key/,
      ),
    ).toBeTruthy();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Load again" }));
    await waitFor(() =>
      expect(requests.filter((request) => request.path.endsWith("/saml-metadata/refresh"))).toHaveLength(2),
    );
  });

  it("shows a failed refresh on the provider and uploads a metadata file", async () => {
    const failed = samlProvider(
      {
        warnings: ["metadataRefreshFailed"],
        config: { ...samlProvider().config, metadata: { source: "file" } },
      },
      { refreshFailedAt: "2026-10-04T06:00:00.000Z", refreshError: "The file has expired" },
    );
    const { requests } = adminApi({
      [`GET ${BASE}/${SAML}`]: () => ({ body: failed }),
      [`GET ${BASE}`]: () => ({ body: [failed] }),
      [`PUT ${BASE}/${SAML}/saml-metadata`]: () => ({ body: samlProvider() }),
    });
    await renderPath(`/settings/instance/sign-in-providers/${SAML}`);
    expect(await screen.findByText("The metadata could not be refreshed")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Load again" })).toBeNull();
    await userEvent.upload(
      screen.getByLabelText("Upload metadata file"),
      new File(["<EntityDescriptor/>"], "adfs.xml", { type: "text/xml" }),
    );
    await waitFor(() =>
      expect(bodyOf(requests, "PUT", `${BASE}/${SAML}/saml-metadata`)).toEqual({
        xml: "<EntityDescriptor/>",
      }),
    );
    await waitFor(() => expect(screen.queryByText("The metadata could not be refreshed")).toBeNull());
  });

  it("saves the SAML switches at once and explains sign-in started at the identity provider", async () => {
    const { requests } = adminApi({
      [`GET ${BASE}/${SAML}`]: () => ({ body: samlProvider() }),
      [`GET ${BASE}`]: () => ({ body: [samlProvider()] }),
      [`PATCH ${BASE}/${SAML}`]: (request) => ({
        body: samlProvider({ config: (request.body as { config: unknown }).config }),
      }),
    });
    await renderPath(`/settings/instance/sign-in-providers/${SAML}?tab=settings`);
    expect(
      await screen.findByText(/an attacker could sign someone into the attacker's account/),
    ).toBeTruthy();
    await userEvent.click(
      screen.getByRole("switch", { name: "Allow sign-in started at the identity provider" }),
    );
    await waitFor(() =>
      expect(
        (bodyOf(requests, "PATCH", `${BASE}/${SAML}`) as { config: Record<string, unknown> } | undefined)
          ?.config,
      ).toMatchObject({ preset: "adfs", idpInitiated: true, requireSignedResponse: false }),
    );
  });

  it("shows the attributes a test sign-in received", async () => {
    const flow = "01929b1e-0000-7000-8000-0000000000c9";
    adminApi({
      [`GET ${BASE}/${SAML}`]: () => ({ body: samlProvider() }),
      [`GET ${BASE}/${SAML}/test-results/${flow}`]: () => ({
        body: {
          subject: "33221100-5544-7766-8899-aabbccddeeff",
          email: "lena.hofer@verlag.example",
          emailVerified: true,
          signInName: null,
          displayName: "Lena Hofer",
          groups: [{ id: "S-1-5-21-1-2-3-1105", name: null }],
          claims: [
            { name: "objectGUID", values: ["ABEiM0RVZneImaq7zN3u/w=="] },
            {
              name: "http://schemas.microsoft.com/ws/2008/06/identity/claims/groupsid",
              values: ["S-1-5-21-1-2-3-1105"],
            },
          ],
        },
      }),
    });
    await renderPath(`/settings/instance/sign-in-providers/${SAML}?tab=overview&providerTest=${flow}`);
    expect(await screen.findByText("Sign-in worked")).toBeTruthy();
    expect(screen.getByText("Received 2 claims and 1 group.")).toBeTruthy();
    expect(screen.getByText("objectGUID")).toBeTruthy();
    expect(screen.getByText("ABEiM0RVZneImaq7zN3u/w==")).toBeTruthy();
    expect(screen.getByText("Tokens, hashes and secrets are never shown.")).toBeTruthy();
  });

  it("switches ADFS groups to SIDs and warns while they are names", async () => {
    const { requests } = adminApi({
      [`GET ${BASE}/${SAML}`]: () => ({ body: samlProvider() }),
      [`GET ${BASE}`]: () => ({ body: [samlProvider()] }),
      [`PATCH ${BASE}/${SAML}`]: (request) => ({
        body: samlProvider({ config: (request.body as { config: unknown }).config }),
      }),
    });
    await renderPath(`/settings/instance/sign-in-providers/${SAML}?tab=settings`);
    expect(await screen.findByText(/renaming a group in the provider breaks the rules for it/)).toBeTruthy();
    await userEvent.click(screen.getByRole("combobox", { name: "Group values" }));
    await userEvent.click(await screen.findByRole("option", { name: "SIDs (Token-Groups as SIDs)" }));
    await waitFor(() =>
      expect(
        (bodyOf(requests, "PATCH", `${BASE}/${SAML}`) as { config: Record<string, unknown> } | undefined)
          ?.config,
      ).toMatchObject({
        groupValues: "identifiers",
        attributes: { groups: "http://schemas.microsoft.com/ws/2008/06/identity/claims/groupsid" },
      }),
    );
  });

  it("asks for the Graph app of an Entra ID SAML provider as a step of the assistant", async () => {
    const entra = samlProvider({
      name: "Entra ID SAML",
      warnings: ["noGraphCredential"],
      config: {
        ...samlProvider().config,
        preset: "entraId",
        tenantId: "3f2a9c1e-7b4d-4e8a-9c21-5d6f0a8b2e17",
        authority: "https://login.microsoftonline.com",
        graphUrl: "https://graph.microsoft.com",
        graphClientId: null,
        emailSource: "email",
      },
    });
    adminApi({ [`GET ${BASE}/${SAML}`]: () => ({ body: entra }) });
    await renderPath(`/settings/instance/sign-in-providers/new?providerId=${SAML}&step=3`);
    expect(await screen.findByRole("heading", { name: "Microsoft Graph" })).toBeTruthy();
    expect(screen.getByText("Entra ID SAML cannot read groups through Microsoft Graph")).toBeTruthy();
    expect(screen.getByLabelText("Client ID for Microsoft Graph")).toBeTruthy();
    const steps = screen.getByRole("navigation", { name: "Steps" });
    expect(within(steps).getAllByRole("button")).toHaveLength(6);
  });

  it("manages the CA certificate, the second factor and the service account password of a directory", async () => {
    let current = ldapProvider({
      ldap: {
        caCertificate: {
          fingerprint: "12:34",
          subject: "CN=Verlag Root CA",
          expiresAt: "2030-01-01T00:00:00.000Z",
        },
      },
    });
    const { requests } = adminApi({
      [`GET ${BASE}/${LDAP}`]: () => ({ body: current }),
      [`GET ${BASE}`]: () => ({ body: [current] }),
      [`PATCH ${BASE}/${LDAP}`]: (request) => {
        current = { ...current, config: (request.body as { config: typeof current.config }).config };
        return { body: current };
      },
      [`DELETE ${BASE}/${LDAP}/ca-certificate`]: () => {
        current = { ...current, ldap: { caCertificate: null } };
        return { body: current };
      },
      [`POST ${BASE}/${LDAP}/credentials`]: () => ({
        status: 201,
        body: {
          id: "01929b1e-0000-7000-8000-0000000000b4",
          kind: "bindPassword",
          keyId: null,
          expiresAt: null,
          createdAt: "2026-10-04T00:00:00.000Z",
          certificate: null,
        },
      }),
    });
    await renderPath(`/settings/instance/sign-in-providers/${LDAP}?tab=settings`);
    expect(await screen.findByText("CN=Verlag Root CA")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Use StartTLS" }).getAttribute("aria-disabled")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Remove CA certificate" }));
    const confirm = await screen.findByRole("dialog", { name: "Remove the CA certificate?" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("No CA certificate uploaded")).toBeTruthy();

    expect(screen.getByText(/A directory password proves no second factor/)).toBeTruthy();
    await userEvent.click(
      screen.getByRole("combobox", { name: "Second factor after a sign-in through this provider" }),
    );
    await userEvent.click(await screen.findByRole("option", { name: "No additional second factor" }));
    await waitFor(() =>
      expect(
        (bodyOf(requests, "PATCH", `${BASE}/${LDAP}`) as { config: { secondFactor: unknown } } | undefined)
          ?.config.secondFactor,
      ).toEqual({ mode: "provider" }),
    );
    expect(
      await screen.findByText(/still asks for one where the instance or an organization requires it/),
    ).toBeTruthy();

    await userEvent.click(screen.getByRole("tab", { name: "Overview" }));
    expect(await screen.findByText("Service account password")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Download certificate" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start test sign-in" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Enter new password" }));
    const dialog = await screen.findByRole("dialog", {
      name: "New credential for Active Directory · Verlag",
    });
    await userEvent.click(within(dialog).getByRole("button", { name: "Save password" }));
    expect(await within(dialog).findByText("This field is required.")).toBeTruthy();
    await userEvent.type(within(dialog).getByLabelText("Password of the service account"), "new bind secret");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save password" }));
    await waitFor(() =>
      expect(bodyOf(requests, "POST", `${BASE}/${LDAP}/credentials`)).toEqual({
        kind: "bindPassword",
        secret: "new bind secret",
      }),
    );
  });

  it("lists the signing certificate of a SAML provider and creates a new one", async () => {
    const { requests } = adminApi({
      [`GET ${BASE}/${SAML}`]: () => ({ body: samlProvider() }),
      [`GET ${BASE}`]: () => ({ body: [samlProvider()] }),
      [`POST ${BASE}/${SAML}/credentials`]: () => ({
        status: 201,
        body: {
          id: "01929b1e-0000-7000-8000-0000000000b5",
          kind: "samlSigning",
          keyId: null,
          expiresAt: "2029-10-04T00:00:00.000Z",
          createdAt: "2026-10-04T00:00:00.000Z",
          certificate: PEM,
        },
      }),
    });
    await renderPath(`/settings/instance/sign-in-providers/${SAML}`);
    expect(await screen.findByText("Signing certificate")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download certificate" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Add signing certificate" }));
    const dialog = await screen.findByRole("dialog", { name: "New credential for ADFS · Verlag" });
    expect(within(dialog).queryByRole("radio", { name: "Client secret for Microsoft Graph" })).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(await within(dialog).findByText("Signing certificate created")).toBeTruthy();
    expect(bodyOf(requests, "POST", `${BASE}/${SAML}/credentials`)).toEqual({
      kind: "samlSigning",
      validDays: 730,
    });
  });

  it("keeps Pagehall's signing certificate apart from the credentials for Microsoft Graph", async () => {
    const entra = samlProvider({
      name: "Entra ID SAML",
      credentials: [
        ...samlProvider().credentials,
        {
          id: "01929b1e-0000-7000-8000-0000000000b6",
          kind: "clientSecret",
          keyId: null,
          expiresAt: "2027-10-01T00:00:00.000Z",
          createdAt: "2026-10-02T00:00:00.000Z",
        },
      ],
      config: {
        ...samlProvider().config,
        preset: "entraId",
        tenantId: "3f2a9c1e-7b4d-4e8a-9c21-5d6f0a8b2e17",
        authority: "https://login.microsoftonline.com",
        graphUrl: "https://graph.microsoft.com",
        graphClientId: "a91b7e04-2c6d-4f13-8e5a-0b9d4c7f2a61",
        emailSource: "email",
      },
    });
    adminApi({
      [`GET ${BASE}/${SAML}`]: () => ({ body: entra }),
      [`GET ${BASE}`]: () => ({ body: [entra] }),
    });
    await renderPath(`/settings/instance/sign-in-providers/${SAML}`);
    const signing = (await screen.findByRole("heading", { name: "Pagehall's signing certificate" })).closest(
      "section",
    ) as HTMLElement;
    const graph = screen
      .getByRole("heading", { name: "Credentials for Microsoft Graph" })
      .closest("section") as HTMLElement;
    expect(within(signing).getByText("Signing certificate")).toBeTruthy();
    expect(within(signing).queryByText("Client secret for Microsoft Graph")).toBeNull();
    expect(within(graph).getByText("Client secret for Microsoft Graph")).toBeTruthy();
    expect(within(graph).queryByText("Signing certificate")).toBeNull();

    await userEvent.click(within(signing).getByRole("button", { name: "Add signing certificate" }));
    let dialog = await screen.findByRole("dialog", { name: "New credential for Entra ID SAML" });
    expect(within(dialog).queryByRole("radio")).toBeNull();
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await userEvent.click(within(graph).getByRole("button", { name: "Add Graph credential" }));
    dialog = await screen.findByRole("dialog", { name: "New credential for Entra ID SAML" });
    expect(
      within(dialog)
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual(["Client secret for Microsoft Graph", "Certificate for Microsoft Graph"]);
  });

  it("offers every attribute the directory returns for a test person", async () => {
    let current = ldapProvider();
    const { requests } = adminApi({
      [`GET ${BASE}/${LDAP}`]: () => ({ body: current }),
      [`PATCH ${BASE}/${LDAP}`]: (request) => {
        current = { ...current, config: (request.body as { config: typeof current.config }).config };
        return { body: current };
      },
      [`POST ${BASE}/${LDAP}/directory-test`]: () => ({
        body: {
          steps: [
            { step: "connection", ok: true, detail: null },
            { step: "certificate", ok: true, detail: null },
            { step: "serviceAccount", ok: true, detail: null },
            { step: "search", ok: true, detail: null },
          ],
          sample: {
            subject: "972e766c-c3f5-49d6-96f6-d904e89e292c",
            email: null,
            signInName: "alice@pagehall.lab",
            displayName: "Alice Admin",
            groups: [],
          },
          attributes: [
            { name: "cn", values: ["Alice Admin"] },
            { name: "objectGUID", values: ["972e766c-c3f5-49d6-96f6-d904e89e292c"] },
            { name: "userPrincipalName", values: ["alice@pagehall.lab"] },
          ],
        },
      }),
    });
    await renderPath(`/settings/instance/sign-in-providers/new?providerId=${LDAP}&step=2`);
    expect(
      (await screen.findAllByText(/Read the attributes of a test person to choose/)).length,
    ).toBeGreaterThan(0);
    await userEvent.type(screen.getByLabelText("Test person"), "alice@pagehall.lab");
    await userEvent.click(screen.getByRole("button", { name: "Read attributes" }));
    expect(await screen.findByText("The directory returned 3 attributes for this person.")).toBeTruthy();
    expect(
      screen.getAllByText(/The directory returned no value of this attribute for the test person/),
    ).toHaveLength(2);
    await userEvent.click(screen.getByRole("combobox", { name: "Attribute for the e-mail address" }));
    await userEvent.click(await screen.findByRole("option", { name: /userPrincipalName/ }));
    await waitFor(() =>
      expect(
        (bodyOf(requests, "PATCH", `${BASE}/${LDAP}`) as { config: { attributes: unknown } } | undefined)
          ?.config.attributes,
      ).toEqual({ email: "userPrincipalName", displayName: "displayName" }),
    );
    expect(await screen.findByText("Value of the test person: alice@pagehall.lab")).toBeTruthy();
  });

  it("refuses an ldaps:// address while StartTLS is on instead of turning StartTLS off", async () => {
    const provider = ldapProvider({}, { url: "ldap://dc01.verlag.example", startTls: true });
    const { requests } = adminApi({
      [`GET ${BASE}/${LDAP}`]: () => ({ body: provider }),
      [`GET ${BASE}`]: () => ({ body: [provider] }),
      [`PATCH ${BASE}/${LDAP}`]: () => ({ body: provider }),
    });
    await renderPath(`/settings/instance/sign-in-providers/${LDAP}?tab=settings`);
    const field = await screen.findByLabelText("Server address");
    await userEvent.clear(field);
    await userEvent.type(field, "ldaps://dc01.verlag.example");
    await userEvent.tab();
    expect(await screen.findByText(/Enter an ldap:\/\/ address while StartTLS is on/)).toBeTruthy();
    expect(requests.some((request) => request.method === "PATCH")).toBe(false);
  });

  it("saves a host name of a directory as the ldaps:// address it was understood as", async () => {
    let provider = ldapProvider();
    const { requests } = adminApi({
      [`GET ${BASE}/${LDAP}`]: () => ({ body: provider }),
      [`GET ${BASE}`]: () => ({ body: [provider] }),
      [`PATCH ${BASE}/${LDAP}`]: (request) => {
        const body = request.body as { config: Record<string, unknown> };
        provider = ldapProvider({}, body.config);
        return { body: provider };
      },
    });
    await renderPath(`/settings/instance/sign-in-providers/${LDAP}?tab=settings`);
    const field = await screen.findByLabelText("Server address");
    await userEvent.clear(field);
    await userEvent.type(field, "dc01 .verlag.example");
    await userEvent.tab();
    expect(
      await screen.findByText("Enter an address such as ldaps://dc01.example.org, without a path."),
    ).toBeTruthy();
    expect(requests.some((request) => request.method === "PATCH")).toBe(false);
    await userEvent.clear(field);
    await userEvent.type(field, "dc01.verlag.example");
    await userEvent.tab();
    await waitFor(() =>
      expect(
        (bodyOf(requests, "PATCH", `${BASE}/${LDAP}`) as { config: { url: string } } | undefined)?.config.url,
      ).toBe("ldaps://dc01.verlag.example:636"),
    );
    expect(await screen.findByDisplayValue("ldaps://dc01.verlag.example:636")).toBeTruthy();
  });
});
