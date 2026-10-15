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
const GB = 1024 ** 3;

type Handler = (request: RecordedRequest) => { status?: number; body?: unknown };

function status(overrides: Record<string, unknown> = {}) {
  return {
    store: "local",
    measured: true,
    inactiveReason: null,
    usedBytes: 412 * GB,
    totalBytes: 500 * GB,
    percent: 82.4,
    level: 1,
    thresholds: { warning: 80, largeWrites: 90, critical: 95 },
    s3LimitBytes: null,
    reminder: "weekly",
    operationsEmails: ["tickets@example.org"],
    teamsWebhook: { configured: true, host: "prod-12.logic.azure.com" },
    checkedAt: new Date().toISOString(),
    ...overrides,
  };
}

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

function api(
  overrides: Record<string, Handler> = {},
  permissions = ["instance.settings.view", "instance.settings.manage"],
) {
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
        instance: permissions,
        organization: [],
        grantableAreas: { instance: {}, organization: {} },
      },
    }),
    "GET /api/v1/account/preferences": () => ({ body: [] }),
    "GET /api/v1/notifications/unread-count": () => ({ body: { count: 0 } }),
    "GET /api/v1/instance/storage": () => ({ body: status() }),
    "GET /api/v1/instance/settings": () => ({ body: { items: [], nextCursor: null } }),
    "GET /api/v1/instance/mail": () => ({
      body: {
        smtp: null,
        passwordSet: false,
        oauth2SecretSet: false,
        method: "smtp",
        graph: null,
        graphCredentials: [],
        delivery: { lastSuccessAt: null, lastFailure: null },
      },
    }),
    ...overrides,
  });
}

async function renderAt(path: string) {
  window.history.replaceState(null, "", path);
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
}

describe("the storage settings", () => {
  it("shows the usage, the active level and the stored contacts", async () => {
    api();
    await renderAt("/settings/instance/storage");
    expect(await screen.findByText("412 GB of 500 GB used (82.4%)")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Used share of the file store" })).toBeTruthy();
    expect(screen.getByText("Warning", { selector: "span" })).toBeTruthy();
    expect(screen.getByText("Local volume")).toBeTruthy();
    expect((screen.getByLabelText("E-mail addresses") as HTMLTextAreaElement).value).toBe(
      "tickets@example.org",
    );
    expect(screen.getByText("Webhook set on prod-12.logic.azure.com")).toBeTruthy();
    expect(screen.queryByLabelText("Limit for stored files")).toBeNull();
  });

  it("says why S3 storage without a limit has no warning and offers the limit", async () => {
    const { requests } = api({
      "GET /api/v1/instance/storage": () => ({
        body: status({
          store: "s3",
          measured: false,
          inactiveReason: "noLimit",
          usedBytes: null,
          totalBytes: null,
          percent: null,
          level: 0,
        }),
      }),
      "PUT /api/v1/instance/storage": (request) => ({
        body: status({ store: "s3", s3LimitBytes: (request.body as { s3LimitBytes: number }).s3LimitBytes }),
      }),
    });
    await renderAt("/settings/instance/storage");
    expect(await screen.findByText("Storage warning inactive")).toBeTruthy();
    expect(
      screen.getAllByText(/S3 does not report free space. Set a limit so Pagehall can warn you./),
    ).not.toHaveLength(0);
    const limit = screen.getByLabelText("Limit for stored files");
    await userEvent.type(limit, "abc");
    await userEvent.tab();
    expect(await screen.findByText(/Enter a size in gigabytes/)).toBeTruthy();
    expect(requests.some((request) => request.method === "PUT")).toBe(false);
    await userEvent.clear(limit);
    await userEvent.type(limit, "500");
    await userEvent.tab();
    await waitFor(() =>
      expect(requests.find((request) => request.method === "PUT")?.body).toEqual({ s3LimitBytes: 500 * GB }),
    );
  });

  it("checks the order of the levels on save and keeps the button enabled", async () => {
    const { requests } = api({
      "PUT /api/v1/instance/storage": (request) => ({
        body: status({ thresholds: (request.body as { thresholds: unknown }).thresholds }),
      }),
    });
    await renderAt("/settings/instance/storage");
    const warning = await screen.findByLabelText("Warning");
    await userEvent.clear(warning);
    await userEvent.type(warning, "92");
    const save = (await screen.findAllByRole("button", { name: "Save" }))[0] as HTMLElement;
    expect((save as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(save);
    expect(await screen.findByText(/Each level must be higher than the one before/)).toBeTruthy();
    expect(requests.some((request) => request.method === "PUT")).toBe(false);
    expect(document.activeElement).toBe(screen.getByLabelText("Large writes paused"));

    await userEvent.clear(warning);
    await userEvent.type(warning, "70");
    await userEvent.click((await screen.findAllByRole("button", { name: "Save" }))[0] as HTMLElement);
    await waitFor(() =>
      expect(requests.find((request) => request.method === "PUT")?.body).toEqual({
        thresholds: { warning: 70, largeWrites: 90, critical: 95 },
      }),
    );
  });

  it("restores the saved levels on cancel", async () => {
    api();
    await renderAt("/settings/instance/storage");
    const critical = (await screen.findByLabelText("Critical")) as HTMLInputElement;
    await userEvent.clear(critical);
    await userEvent.type(critical, "99");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(critical.value).toBe("95");
  });

  it("marks an invalid address, keeps the entry and saves a corrected list", async () => {
    const { requests } = api({
      "PUT /api/v1/instance/storage": (request) => ({
        body: status({ operationsEmails: (request.body as { operationsEmails: string[] }).operationsEmails }),
      }),
    });
    await renderAt("/settings/instance/storage");
    const addresses = (await screen.findByLabelText("E-mail addresses")) as HTMLTextAreaElement;
    await userEvent.clear(addresses);
    await userEvent.type(addresses, "not an address");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText(/Check the addresses: each line needs one valid e-mail address/),
    ).toBeTruthy();
    expect(addresses.value).toBe("not an address");
    expect(requests.some((request) => request.method === "PUT")).toBe(false);

    await userEvent.clear(addresses);
    await userEvent.type(addresses, "ops@example.org, it@example.org");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(requests.find((request) => request.method === "PUT")?.body).toEqual({
        operationsEmails: ["ops@example.org", "it@example.org"],
      }),
    );
  });

  it("removes the webhook only on save and never shows its address", async () => {
    const { requests } = api({
      "PUT /api/v1/instance/storage": () => ({
        body: status({ teamsWebhook: { configured: false, host: null } }),
      }),
    });
    await renderAt("/settings/instance/storage");
    await userEvent.click(await screen.findByRole("button", { name: "Remove webhook" }));
    expect(screen.getByText("The webhook is removed when you save.")).toBeTruthy();
    expect(requests.some((request) => request.method === "PUT")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(requests.find((request) => request.method === "PUT")?.body).toEqual({
        operationsEmails: ["tickets@example.org"],
        teamsWebhook: null,
      }),
    );
  });

  it("shows the server's verdict on a webhook address at the field", async () => {
    api({
      "GET /api/v1/instance/storage": () => ({
        body: status({ teamsWebhook: { configured: false, host: null } }),
      }),
      "PUT /api/v1/instance/storage": () =>
        problem(400, "invalidStorageSettings", {
          fields: ["body.teamsWebhook"],
          problem: "invalidTeamsWebhook",
        }),
    });
    await renderAt("/settings/instance/storage");
    await userEvent.type(await screen.findByLabelText("Teams webhook"), "https://example.invalid/x");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/This webhook address cannot be used/)).toBeTruthy();
  });

  it("reports what a test message reached", async () => {
    api({
      "POST /api/v1/instance/storage/test": () => ({
        body: { addresses: 1, teams: { delivered: false, reason: "unauthorized", status: 401 } },
      }),
    });
    await renderAt("/settings/instance/storage");
    await userEvent.click(await screen.findByRole("button", { name: "Send test message" }));
    expect(await screen.findByText(/Test message sent to 1 address\./)).toBeTruthy();
    expect(screen.getByText(/Teams did not accept the test message \(unauthorized\)/)).toBeTruthy();
  });

  it("asks to save a contact first when nothing is stored", async () => {
    api({
      "GET /api/v1/instance/storage": () => ({
        body: status({ operationsEmails: [], teamsWebhook: { configured: false, host: null } }),
      }),
    });
    await renderAt("/settings/instance/storage");
    await userEvent.click(await screen.findByRole("button", { name: "Send test message" }));
    expect(await screen.findByText(/Save an e-mail address or a Teams webhook first/)).toBeTruthy();
  });

  it("hides the controls from people who may only view", async () => {
    api({}, ["instance.settings.view"]);
    await renderAt("/settings/instance/storage");
    await screen.findByText("412 GB of 500 GB used (82.4%)");
    expect(screen.queryByRole("button", { name: "Send test message" })).toBeNull();
    expect((screen.getByLabelText("Warning") as HTMLInputElement).disabled).toBe(true);
  });
});

describe("the storage banner", () => {
  it("appears on every settings page while a level is active and links to the storage settings", async () => {
    api({ "GET /api/v1/instance/storage": () => ({ body: status({ level: 3, percent: 96.2 }) }) });
    await renderAt("/settings/instance/mail");
    const banner = await screen.findByText("Uploads are paused: the file store is almost full");
    expect(banner).toBeTruthy();
    const notice = banner.closest("div")?.parentElement as HTMLElement;
    expect(within(notice).getByRole("link", { name: "Open the storage settings" }).getAttribute("href")).toBe(
      "/settings/instance/storage",
    );
    expect(screen.getByText(/96.2% of the file store is used/)).toBeTruthy();
  });

  it("names the level that is active", async () => {
    api({ "GET /api/v1/instance/storage": () => ({ body: status({ level: 2, percent: 91 }) }) });
    await renderAt("/settings/instance/mail");
    expect(await screen.findByText("New exports and imports are paused")).toBeTruthy();
  });

  it("stays away when the usage is normal", async () => {
    const { requests } = api({ "GET /api/v1/instance/storage": () => ({ body: status({ level: 0 }) }) });
    await renderAt("/settings/instance/mail");
    await screen.findByText("E-mail", { selector: "h1" });
    await waitFor(() =>
      expect(requests.some((request) => request.path === "/api/v1/instance/storage")).toBe(true),
    );
    expect(screen.queryByText("The file store is filling up")).toBeNull();
  });

  it("is not requested for people without access to the instance settings", async () => {
    const { requests } = api({}, []);
    await renderAt("/settings/account");
    await waitFor(() => expect(requests.length).toBeGreaterThan(0));
    expect(requests.some((request) => request.path === "/api/v1/instance/storage")).toBe(false);
  });
});
