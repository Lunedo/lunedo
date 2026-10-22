import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "../../app.js";
import { initI18n } from "../../i18n/index.js";
import { mockApi, type RecordedRequest } from "../../testing/render.js";

const OLIVIA = {
  id: "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c",
  email: "olivia@example.org",
  name: "Olivia Owner",
};
const TENANT = "3f2a9c1e-7b4d-4e8a-9c21-5d6f0a8b2e17";
const NO_DELIVERY = { lastSuccessAt: null, lastFailure: null };

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

function api(overrides: Record<string, Handler> = {}) {
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
        instance: ["instance.settings.view", "instance.settings.manage"],
        organization: [],
        grantableAreas: { instance: {}, organization: {} },
      },
    }),
    "GET /api/v1/account/preferences": () => ({ body: [] }),
    "GET /api/v1/notifications/unread-count": () => ({ body: { count: 0 } }),
    "GET /api/v1/instance/mail": () => ({
      body: {
        smtp: null,
        passwordSet: false,
        oauth2SecretSet: false,
        method: "smtp",
        graph: null,
        graphCredentials: [],
        delivery: NO_DELIVERY,
      },
    }),
    ...overrides,
  });
}

async function renderMail() {
  window.history.replaceState(null, "", "/settings/instance/mail");
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
}

describe("the e-mail settings", () => {
  it("fills server, port and security from a service and nothing else", async () => {
    api();
    await renderMail();
    await userEvent.click(await screen.findByRole("combobox", { name: "Service" }));
    await userEvent.click(await screen.findByRole("option", { name: "Brevo" }));
    expect((screen.getByLabelText("Server") as HTMLInputElement).value).toBe("smtp-relay.brevo.com");
    expect((screen.getByLabelText("Port") as HTMLInputElement).value).toBe("587");
    expect((screen.getByLabelText("User name") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Sender address") as HTMLInputElement).value).toBe("");
  });

  it("explains the Graph setup, names what failed in a test and saves settings and method together", async () => {
    const { requests } = api({
      "GET /api/v1/instance/mail": () => ({
        body: {
          smtp: null,
          passwordSet: false,
          oauth2SecretSet: false,
          delivery: NO_DELIVERY,
          method: "smtp",
          graph: null,
          graphCredentials: [
            {
              id: "01929b1e-0000-7000-8000-0000000000c1",
              kind: "clientSecret",
              keyId: null,
              expiresAt: "2027-01-01T00:00:00.000Z",
              createdAt: "2026-10-01T00:00:00.000Z",
            },
          ],
        },
      }),
      "POST /api/v1/instance/mail/graph/test": () => ({
        body: { delivered: false, error: { code: "graphMailboxNotAllowed", responseCode: 403 } },
      }),
      "PUT /api/v1/instance/mail/graph": () => ({ status: 204 }),
      "PUT /api/v1/instance/mail/method": () => ({ status: 204 }),
    });
    await renderMail();
    await userEvent.click(await screen.findByRole("radio", { name: "Microsoft Graph" }));
    expect(await screen.findByText(/Lunedo cannot see how the permission was granted/)).toBeTruthy();
    expect(screen.getByText(/run Enable-OrganizationCustomization first/)).toBeTruthy();
    expect(screen.getByText(/can then send as any mailbox of your organization/)).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Directory (tenant) ID"), TENANT);
    await userEvent.type(screen.getByLabelText("Client ID"), "client-id");
    await userEvent.type(screen.getByLabelText("Sender mailbox"), "wiki@example.org");
    await userEvent.click(screen.getByRole("button", { name: "Send test mail" }));
    expect(await screen.findByText(/The app may not send as this mailbox/)).toBeTruthy();
    expect(screen.getByText(/Add the mailbox to the management scope/)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(requests.find((request) => request.path === "/api/v1/instance/mail/method")?.body).toEqual({
        method: "graph",
      }),
    );
    expect(requests.find((request) => request.path === "/api/v1/instance/mail/graph")?.body).toMatchObject({
      tenantId: TENANT,
      clientId: "client-id",
      sender: "wiki@example.org",
      senderName: null,
    });
    const graphTest = requests.find((request) => request.path === "/api/v1/instance/mail/graph/test");
    expect(graphTest?.body).toMatchObject({ to: OLIVIA.email });
    expect(within(document.body).queryByText("Lunedo sends through Microsoft Graph.")).toBeNull();
  });

  it("lists the Microsoft 365 steps in the order they are done", async () => {
    api({});
    await renderMail();
    await userEvent.click(await screen.findByRole("radio", { name: "Microsoft Graph" }));
    const steps = within(screen.getByText("Set up in Microsoft 365").parentElement as HTMLElement)
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(steps).toEqual([
      expect.stringMatching(/^Create an app registration/),
      expect.stringMatching(/^Allow the app to send e-mail/),
      expect.stringMatching(/^Recommended: limit the app to the sender mailbox/),
      expect.stringMatching(/^Enter the tenant ID/),
    ]);
  });

  it("says that Graph keeps no copy in the Sent Items and sends no unsubscribe header", async () => {
    api({});
    await renderMail();
    await userEvent.click(await screen.findByRole("radio", { name: "Microsoft Graph" }));
    const note = screen.getByText(/^Mails sent through Microsoft Graph are not kept in the Sent Items/);
    expect(note.textContent).toContain("through the link in the mail only");
  });

  it("says that Microsoft 365 only accepted the test mail and where a failed delivery shows", async () => {
    api({
      "POST /api/v1/instance/mail/graph/test": () => ({ body: { delivered: true, error: null } }),
    });
    await renderMail();
    await userEvent.click(await screen.findByRole("radio", { name: "Microsoft Graph" }));
    await userEvent.type(screen.getByLabelText("Directory (tenant) ID"), TENANT);
    await userEvent.type(screen.getByLabelText("Client ID"), "client-id");
    await userEvent.type(screen.getByLabelText("Sender mailbox"), "wiki@example.org");
    await userEvent.click(screen.getByRole("button", { name: "Send test mail" }));
    const accepted = await screen.findByText("Microsoft 365 accepted the test mail.");
    const result = accepted.closest("[role=status]")?.textContent;
    expect(result).toContain("non-delivery report in the sender mailbox");
    expect(result).toContain("550 5.7.233");
  });

  it("explains a failed test mail in plain words and keeps the code for administrators", async () => {
    api({
      "POST /api/v1/instance/mail/test": () => ({
        body: { delivered: false, error: { code: "EDNS", responseCode: null } },
      }),
    });
    await renderMail();
    await userEvent.type(await screen.findByLabelText("Server"), "smtp.exmaple.org");
    await userEvent.type(screen.getByLabelText("Sender address"), "wiki@example.org");
    await userEvent.click(screen.getByRole("button", { name: "Send test mail" }));
    expect(await screen.findByText(/The name of the mail server could not be found/)).toBeTruthy();
    expect(screen.getByText("Code for administrators: EDNS")).toBeTruthy();
  });

  it("says that the mail server only accepted the test mail and where a later bounce shows", async () => {
    api({ "POST /api/v1/instance/mail/test": () => ({ body: { delivered: true, error: null } }) });
    await renderMail();
    await userEvent.type(await screen.findByLabelText("Server"), "smtp.example.org");
    await userEvent.type(screen.getByLabelText("Sender address"), "wiki@example.org");
    await userEvent.click(screen.getByRole("button", { name: "Send test mail" }));
    const result = await screen.findByText("The mail server accepted the test mail.");
    expect(result.closest("[role=status]")?.textContent).toContain(
      "look for a non-delivery report in the mailbox of the sender address",
    );
  });
  it("sets up SMTP with OAuth2 for Microsoft 365 and shows what to do in Exchange first", async () => {
    const { requests } = api({
      "POST /api/v1/instance/mail/test": () => ({
        body: { delivered: false, error: { code: "oauthClientRejected", responseCode: 401, step: "token" } },
      }),
      "PUT /api/v1/instance/mail": () => ({ status: 204 }),
    });
    await renderMail();
    await userEvent.click(await screen.findByRole("combobox", { name: "Service" }));
    await userEvent.click(await screen.findByRole("option", { name: "Microsoft 365" }));
    expect(
      (screen.getByRole("radio", { name: "OAuth2" }) as HTMLInputElement).getAttribute("aria-checked"),
    ).toBe("true");
    expect(screen.getByText("Set up in Microsoft 365 first")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Mailbox"), "wiki@contoso.com");
    expect(
      screen.getByText("Set-CASMailbox -Identity wiki@contoso.com -SmtpClientAuthenticationDisabled $false"),
    ).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Sender address"), "wiki@contoso.com");

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Enter the tenant ID/)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Tenant ID"));
    expect(requests.some((request) => request.method === "PUT")).toBe(false);

    await userEvent.type(screen.getByLabelText("Tenant ID"), TENANT);
    await userEvent.type(
      screen.getByLabelText("Application (client) ID"),
      "1b6f0c2e-4d3a-4f5b-8c7d-9e0f1a2b3c4d",
    );
    await userEvent.type(screen.getByLabelText("Client secret"), "app-secret");
    await userEvent.click(screen.getByRole("button", { name: "Send test mail" }));
    expect(await screen.findByText(/did not accept the client ID or the client secret/)).toBeTruthy();
    expect(screen.getByText(/Failed step: getting an access token/)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(
        requests.find((request) => request.method === "PUT" && request.path === "/api/v1/instance/mail")
          ?.body,
      ).toEqual({
        host: "smtp.office365.com",
        port: 587,
        security: "starttls",
        username: "wiki@contoso.com",
        from: "wiki@contoso.com",
        oauth2: {
          provider: "microsoft365",
          tenantId: TENANT,
          clientId: "1b6f0c2e-4d3a-4f5b-8c7d-9e0f1a2b3c4d",
          authority: "https://login.microsoftonline.com",
        },
        oauth2Secret: "app-secret",
      }),
    );
  });

  it("reads the Google key file in the browser and shows the client ID for the delegation", async () => {
    api();
    await renderMail();
    await userEvent.click(await screen.findByRole("combobox", { name: "Service" }));
    await userEvent.click(await screen.findByRole("option", { name: "Google Workspace" }));
    expect(screen.getByText("https://mail.google.com/")).toBeTruthy();
    const key = JSON.stringify({
      type: "service_account",
      client_email: "mailer@project.iam.gserviceaccount.com",
      client_id: "1234567890",
      private_key: "-----BEGIN PRIVATE KEY-----",
    });
    await userEvent.upload(
      screen.getByLabelText("Key file of the service account"),
      new File([key], "key.json", { type: "application/json" }),
    );
    expect(
      await screen.findByText("Service account mailer@project.iam.gserviceaccount.com, client ID 1234567890"),
    ).toBeTruthy();
    await userEvent.upload(
      screen.getByLabelText("Key file of the service account"),
      new File(["{}"], "other.json", { type: "application/json" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/not a JSON key of a Google service account/)).toBeTruthy();
  });

  it("shows the last delivery error with its cause and step", async () => {
    api({
      "GET /api/v1/instance/mail": () => ({
        body: {
          smtp: null,
          passwordSet: false,
          oauth2SecretSet: false,
          method: "smtp",
          graph: null,
          graphCredentials: [],
          delivery: {
            lastSuccessAt: null,
            lastFailure: {
              at: "2026-10-15T08:00:00.000Z",
              code: "ECONNECTION",
              responseCode: null,
              step: "connect",
            },
          },
        },
      }),
    });
    await renderMail();
    expect(await screen.findByText(/Lunedo could not connect to the mail server/)).toBeTruthy();
    expect(screen.getByText(/Failed step: connecting to the mail server/)).toBeTruthy();
    expect(screen.getByText("Not yet")).toBeTruthy();
  });
});

describe("the instance overview", () => {
  async function renderGeneral() {
    window.history.replaceState(null, "", "/settings/instance/general");
    const i18n = await initI18n(["en"]);
    render(<App i18n={i18n} queryClient={createQueryClient()} />);
  }

  it("says that nothing is sent while e-mail is not set up and links to the e-mail settings", async () => {
    api({ "GET /api/v1/instance/settings": () => ({ body: { items: [], nextCursor: null } }) });
    await renderGeneral();
    expect(await screen.findByText("E-mail is not set up")).toBeTruthy();
    expect(screen.getByText(/sends no invitations and no e-mail notifications/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Set up e-mail" }).getAttribute("href")).toBe(
      "/settings/instance/mail",
    );
  });

  it("shows no notice once a mail server is set up", async () => {
    api({
      "GET /api/v1/instance/settings": () => ({ body: { items: [], nextCursor: null } }),
      "GET /api/v1/instance/mail": () => ({
        body: {
          smtp: {
            host: "smtp.example.org",
            port: 587,
            security: "starttls",
            username: null,
            from: "wiki@example.org",
          },
          passwordSet: false,
          oauth2SecretSet: false,
          delivery: NO_DELIVERY,
          method: "smtp",
          graph: null,
          graphCredentials: [],
        },
      }),
    });
    await renderGeneral();
    expect(await screen.findByRole("heading", { name: "General" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("E-mail is not set up")).toBeNull());
  });
});
