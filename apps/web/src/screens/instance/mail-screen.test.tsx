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
      body: { smtp: null, passwordSet: false, method: "smtp", graph: null, graphCredentials: [] },
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
    expect(await screen.findByText(/Pagehall cannot see how the permission was granted/)).toBeTruthy();
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
    expect(within(document.body).queryByText("Pagehall sends through Microsoft Graph.")).toBeNull();
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
