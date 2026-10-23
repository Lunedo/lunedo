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
const PROVIDER = "01929b1e-0000-7000-8000-0000000000a1";
const ORGANIZATION = "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f";
const RULE = "01929b1e-0000-7000-8000-0000000000d1";
const RUN = "01929b1e-0000-7000-8000-0000000000e1";
const BASE = `/api/v1/instance/identity-providers/${PROVIDER}`;

type Handler = (request: RecordedRequest) => { status?: number; body?: unknown };

type StreamListener = (event: MessageEvent<string>) => void;
const streams: Map<string, StreamListener>[] = [];

function emitStream(type: string, data: unknown) {
  for (const listeners of streams)
    listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent<string>);
}

beforeEach(() => {
  streams.length = 0;
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal(
    "EventSource",
    class {
      readonly listeners = new Map<string, StreamListener>();
      constructor() {
        streams.push(this.listeners);
      }
      addEventListener(type: string, listener: StreamListener) {
        this.listeners.set(type, listener);
      }
      removeEventListener(type: string) {
        this.listeners.delete(type);
      }
      close() {}
    },
  );
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

function provider(preset: "entraId" | "generic" | "google" = "entraId") {
  const common = {
    clientId: "a91b7e04-2c6d-4f13-8e5a-0b9d4c7f2a61",
    domains: ["example.org"],
    idTokenAlgorithm: "RS256",
    accountCreation: { enabled: true, requiredGroups: [] },
    sync: { intervalMinutes: 60, deactivationLimitPercent: 20, deactivationLimitAccounts: 5 },
    secondFactor: { mode: "provider", proofValues: ["mfa"] },
  };
  return {
    id: PROVIDER,
    type: "oidc",
    name: preset === "entraId" ? "Entra ID" : preset === "google" ? "Google" : "Keycloak",
    config:
      preset === "google"
        ? { preset, ...common, issuer: "https://accounts.google.com", directory: null }
        : preset === "entraId"
          ? {
              preset,
              ...common,
              tenantId: "3f2a9c1e-7b4d-4e8a-9c21-5d6f0a8b2e17",
              authority: "https://login.microsoftonline.com",
              graphUrl: "https://graph.microsoft.com",
              emailSource: "email",
              signInNameSource: "userPrincipalName",
            }
          : {
              preset,
              ...common,
              issuer: "https://keycloak.example.org/realms/lunedo",
              scopes: ["openid", "email", "profile"],
              claims: {
                email: "email",
                signInName: "preferred_username",
                displayName: "name",
                groups: "groups",
                groupNames: "group_names",
              },
            },
    issuer: "https://login.example/v2.0",
    redirectUri: `https://wiki.example.org/api/v1/auth/providers/${PROVIDER}/callback`,
    logoRef: null,
    credentials: [],
    warnings: [],
    directoryKey: false,
    capabilities: {
      groups: preset !== "google",
      directorySync: preset === "entraId",
      disabledAccounts: preset === "entraId",
      groupsByName: false,
    },
    deactivatedAt: null,
    setupComplete: true,
    createdAt: "2026-09-01T08:00:00.000Z",
    updatedAt: "2026-09-01T08:00:00.000Z",
  };
}

function rule(patch: Record<string, unknown> = {}) {
  return {
    id: RULE,
    providerId: PROVIDER,
    position: 0,
    group: { id: "sg-engineering", name: "Engineering", missing: false },
    target: "organization",
    organization: { id: ORGANIZATION, name: "Platform Team" },
    role: null,
    synchronizedGroup: { id: "01929b1e-0000-7000-8000-0000000000f1", name: "Engineering" },
    homeOrganization: false,
    accounts: 41,
    createdAt: "2026-09-01T08:00:00.000Z",
    updatedAt: "2026-09-01T08:00:00.000Z",
    ...patch,
  };
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
        instance: ["instance.signIn.view", "instance.signIn.manage", "instance.organizations.view"],
        organization: [],
        grantableAreas: { instance: {}, organization: {} },
      },
    }),
    "GET /api/v1/account/preferences": () => ({ body: [] }),
    "GET /api/v1/notifications/unread-count": () => ({ body: { count: 0 } }),
    "GET /api/v1/instance/identity-providers": () => ({ body: [provider()] }),
    [`GET ${BASE}`]: () => ({ body: provider() }),
    [`GET ${BASE}/sync-runs`]: () => ({ body: { items: [], nextCursor: null } }),
    ...overrides,
  });
}

async function renderPath(path: string) {
  window.history.replaceState(null, "", path);
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
}

describe("group mapping", () => {
  it("lists the rules in order and marks a rule whose group no longer exists", async () => {
    adminApi({
      [`GET ${BASE}/mapping-rules`]: () => ({
        body: [
          rule(),
          rule({
            id: "01929b1e-0000-7000-8000-0000000000d2",
            position: 1,
            group: { id: "sg-admins", name: null, missing: true },
            target: "instance",
            organization: null,
            role: { builtIn: "administrator" },
            synchronizedGroup: null,
            accounts: 0,
          }),
        ],
      }),
    });
    await renderPath(`/settings/instance/sign-in-providers/${PROVIDER}?tab=mapping`);
    const table = await screen.findByRole("table", { name: "Mapping rules" });
    expect(within(table).getByText(`Member · group "Engineering"`)).toBeTruthy();
    expect(within(table).getByText("Platform Team")).toBeTruthy();
    expect(within(table).getByText("Group not found")).toBeTruthy();
    expect(within(table).getAllByText("Instance role")).toHaveLength(1);
  });

  it("warns in the list and the dialog that renaming a group breaks rules that use its name", async () => {
    const byName = provider("generic");
    adminApi({
      [`GET ${BASE}`]: () => ({
        body: { ...byName, capabilities: { ...byName.capabilities, groupsByName: true } },
      }),
      [`GET ${BASE}/mapping-rules`]: () => ({ body: [rule()] }),
    });
    await renderPath(`/settings/instance/sign-in-providers/${PROVIDER}?tab=mapping`);
    await screen.findByRole("table", { name: "Mapping rules" });
    expect(screen.getAllByText("Groups are identified by their names")).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "Add rule" }));
    const dialog = await screen.findByRole("dialog", { name: "Add mapping rule" });
    expect(within(dialog).getByText(/Renaming a group in Keycloak breaks every rule for it/)).toBeTruthy();
  });

  it("takes the group value as text when the provider has no directory to search", async () => {
    const byName = provider("generic");
    adminApi({
      [`GET ${BASE}`]: () => ({
        body: { ...byName, capabilities: { ...byName.capabilities, groupsByName: true } },
      }),
      [`GET ${BASE}/mapping-rules`]: () => ({ body: [] }),
      [`GET ${BASE}/groups`]: (request) => ({
        body:
          request.path.includes("q=lunedo") || !request.path.includes("q=")
            ? [{ id: "lunedo-staff", name: "Lunedo staff", members: null, accounts: 3, mapped: false }]
            : [],
      }),
    });
    await renderPath(`/settings/instance/sign-in-providers/${PROVIDER}?tab=mapping`);
    await userEvent.click(await screen.findByRole("button", { name: "Add rule" }));
    const dialog = await screen.findByRole("dialog", { name: "Add mapping rule" });
    expect(within(dialog).getByText(/Suggests the groups Lunedo has seen at sign-ins/)).toBeTruthy();
    await userEvent.type(within(dialog).getByRole("combobox", { name: /^Group in/ }), "lunedo-users");
    expect(await screen.findByRole("option", { name: /Lunedo staff/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /Use this text as group value/ })).toBeTruthy();
  });

  it("offers only groups found in the directory of the provider", async () => {
    adminApi({
      [`GET ${BASE}/mapping-rules`]: () => ({ body: [] }),
      [`GET ${BASE}/groups`]: () => ({ body: [] }),
    });
    await renderPath(`/settings/instance/sign-in-providers/${PROVIDER}?tab=mapping`);
    await userEvent.click(await screen.findByRole("button", { name: "Add rule" }));
    const dialog = await screen.findByRole("dialog", { name: "Add mapping rule" });
    expect(within(dialog).getByText(/Lunedo stores the ID of the group/)).toBeTruthy();
    await userEvent.type(within(dialog).getByRole("combobox", { name: /^Group in/ }), "lunedo-users");
    expect(await screen.findByText(/No group with this name found/)).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Use this text as group value/ })).toBeNull();
  });

  it("shows a group renamed by a synchronization without a reload", async () => {
    let name = "Engineering";
    adminApi({
      [`GET ${BASE}/mapping-rules`]: () => ({
        body: [rule({ group: { id: "sg-engineering", name, missing: false } })],
      }),
    });
    await renderPath(`/settings/instance/sign-in-providers/${PROVIDER}?tab=mapping`);
    const table = await screen.findByRole("table", { name: "Mapping rules" });
    expect(within(table).getAllByText("Engineering").length).toBeGreaterThan(0);
    name = "Platform Engineering";
    emitStream("syncRuns", { providerId: PROVIDER, runId: RUN });
    expect(await within(table).findByText("Platform Engineering")).toBeTruthy();
  });

  it("removes a rule at once and restores it in its place on undo", async () => {
    const second = rule({
      id: "01929b1e-0000-7000-8000-0000000000d2",
      position: 1,
      group: { id: "sg-design", name: "Design", missing: false },
      synchronizedGroup: null,
    });
    const restored = "01929b1e-0000-7000-8000-0000000000d3";
    let rules = [rule(), second];
    const { requests } = adminApi({
      [`GET ${BASE}/mapping-rules`]: () => ({ body: rules }),
      [`DELETE ${BASE}/mapping-rules/${RULE}`]: () => {
        rules = [second];
        return { status: 204 };
      },
      [`POST ${BASE}/mapping-rules`]: () => {
        const created = rule({ id: restored, position: 1 });
        rules = [second, created];
        return { status: 201, body: created };
      },
      [`PUT ${BASE}/mapping-rule-order`]: () => ({ status: 204 }),
    });
    await renderPath(`/settings/instance/sign-in-providers/${PROVIDER}?tab=mapping`);
    await screen.findByRole("table", { name: "Mapping rules" });
    await userEvent.click(screen.getByRole("button", { name: "More for Engineering" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Remove rule" }));
    expect(screen.queryByRole("dialog", { name: "Remove mapping rule" })).toBeNull();
    expect(requests.some((request) => request.method === "DELETE")).toBe(true);
    expect(await screen.findByText("The rule for Engineering was removed.")).toBeTruthy();
    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() =>
      expect(requests.find((request) => request.path.endsWith("/mapping-rule-order"))?.body).toEqual({
        ruleIds: [restored, second.id],
      }),
    );
    const created = requests.find(
      (request) => request.method === "POST" && request.path.endsWith("/mapping-rules"),
    );
    expect(created?.body).toEqual({
      target: "organization",
      group: { id: "sg-engineering", name: "Engineering" },
      organizationId: ORGANIZATION,
      role: null,
      synchronizedGroup: true,
      homeOrganization: false,
    });
  });

  it("shows rules changed in another session without a reload", async () => {
    let rules = [rule()];
    adminApi({ [`GET ${BASE}/mapping-rules`]: () => ({ body: rules }) });
    await renderPath(`/settings/instance/sign-in-providers/${PROVIDER}?tab=mapping`);
    const table = await screen.findByRole("table", { name: "Mapping rules" });
    expect(within(table).getAllByText("Engineering").length).toBeGreaterThan(0);
    rules = [];
    emitStream("changes", { scope: "instance", organizationId: null, target: "mappingRule" });
    await waitFor(() => expect(within(table).queryByText("Engineering")).toBeNull());
  });

  it("does not warn about renaming when groups have identifiers", async () => {
    adminApi({ [`GET ${BASE}/mapping-rules`]: () => ({ body: [rule()] }) });
    await renderPath(`/settings/instance/sign-in-providers/${PROVIDER}?tab=mapping`);
    await screen.findByRole("table", { name: "Mapping rules" });
    expect(screen.queryByText("Groups are identified by their names")).toBeNull();
  });

  it("creates a SCIM token, shows it once, renews it and removes the old one", async () => {
    let tokens: {
      id: string;
      prefix: string;
      expiresAt: string | null;
      lastUsedAt: string | null;
      createdAt: string;
    }[] = [];
    const status = () => ({
      body: {
        url: `https://wiki.example.org/scim/v2/${PROVIDER}`,
        tokens,
        lastRequestAt: null,
        lastDay: { requests: 0, changes: 0, failed: 0 },
      },
    });
    const first = {
      id: "01929b1e-0000-7000-8000-00000000a001",
      prefix: "ldscim_AbCdEf",
      expiresAt: null,
      lastUsedAt: null,
      createdAt: "2026-10-04T08:00:00.000Z",
    };
    const second = { ...first, id: "01929b1e-0000-7000-8000-00000000a002", prefix: "ldscim_GhIjKl" };
    const { requests } = adminApi({
      [`GET ${BASE}/scim`]: status,
      [`POST ${BASE}/scim/tokens`]: () => {
        tokens = [first];
        return { status: 201, body: { ...first, token: "ldscim_AbCdEf-the-secret" } };
      },
      [`POST ${BASE}/scim/tokens/${first.id}/renew`]: () => {
        tokens = [{ ...first, expiresAt: "2026-10-11T08:00:00.000Z" }, second];
        return { status: 201, body: { ...second, token: "ldscim_GhIjKl-the-new-secret" } };
      },
      [`DELETE ${BASE}/scim/tokens/${first.id}`]: () => {
        tokens = [second];
        return { status: 204 };
      },
    });
    await renderPath(`/settings/instance/sign-in-providers/${PROVIDER}?tab=scim`);
    expect(await screen.findByDisplayValue(`https://wiki.example.org/scim/v2/${PROVIDER}`)).toBeTruthy();
    expect(screen.getByText("No token yet. SCIM is off until you create one.")).toBeTruthy();
    const mappings = screen.getByRole("table", { name: "Attribute mappings in Entra ID" });
    const rows = within(mappings)
      .getAllByRole("row")
      .slice(1)
      .map((row) =>
        within(row)
          .getAllByRole("cell")
          .slice(0, 2)
          .map((cell) => cell.textContent),
      );
    expect(rows).toEqual([
      ["externalId", "objectId"],
      ['emails[type eq "work"].value', "userPrincipalName"],
    ]);
    expect(within(mappings).getByText(/When accounts have no mailbox/)).toBeTruthy();
    expect(
      screen.getByText(/gets an account, even when account creation at first sign-in is off/),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Create token" }));
    const created = await screen.findByRole("dialog", { name: "New SCIM token" });
    expect(within(created).getByDisplayValue("ldscim_AbCdEf-the-secret")).toBeTruthy();
    await userEvent.click(within(created).getByRole("button", { name: "Done" }));
    expect(screen.queryByDisplayValue("ldscim_AbCdEf-the-secret")).toBeNull();

    await userEvent.click(await screen.findByRole("button", { name: "Renew" }));
    const renewed = await screen.findByRole("dialog", { name: "New SCIM token" });
    expect(within(renewed).getByDisplayValue("ldscim_GhIjKl-the-new-secret")).toBeTruthy();
    expect(within(renewed).getByText(/keeps working for seven days/)).toBeTruthy();
    await userEvent.click(within(renewed).getByRole("button", { name: "Done" }));
    const old = (await screen.findByText("ldscim_AbCdEf…")).closest("li") as HTMLElement;
    await userEvent.click(within(old).getByRole("button", { name: "Remove token" }));
    const confirm = await screen.findByRole("dialog", { name: "Remove this token?" });
    await userEvent.click(within(confirm).getByRole("button", { name: "Remove token" }));
    await waitFor(() => expect(requests.some((request) => request.method === "DELETE")).toBe(true));
    expect(await screen.findByText("Token removed")).toBeTruthy();
  });

  it("adds a rule after showing who gains access", { timeout: 15_000 }, async () => {
    let rules: unknown[] = [];
    const { requests } = adminApi({
      [`GET ${BASE}/mapping-rules`]: () => ({ body: rules }),
      [`GET ${BASE}/groups`]: () => ({
        body: [{ id: "sg-platform-team", name: "Platform team", members: 64, accounts: 51, mapped: false }],
      }),
      [`GET ${BASE}/group-preview`]: () => ({
        body: {
          members: 64,
          accounts: 51,
          sample: [{ id: OLIVIA.id, name: "Lena Hofer" }],
          withoutAccount: 13,
        },
      }),
      "GET /api/v1/instance/organizations": () => ({
        body: {
          items: [{ id: ORGANIZATION, name: "Platform Team", slug: "platform-team" }],
          nextCursor: null,
        },
      }),
      [`GET /api/v1/organizations/${ORGANIZATION}/roles`]: () => problem(403, "forbidden"),
      [`POST ${BASE}/mapping-rules`]: (request) => {
        rules = [rule({ group: { id: "sg-platform-team", name: "Platform team", missing: false } })];
        return { status: 201, body: { ...(request.body as object), id: RULE } };
      },
    });
    await renderPath(`/settings/instance/sign-in-providers/${PROVIDER}?tab=mapping`);
    await userEvent.click(await screen.findByRole("button", { name: "Add rule" }));
    const dialog = await screen.findByRole("dialog", { name: "Add mapping rule" });
    await userEvent.type(within(dialog).getByRole("combobox", { name: "Group in Entra ID" }), "platform");
    await userEvent.click(await screen.findByRole("option", { name: /Platform team/ }));
    await userEvent.type(within(dialog).getByRole("combobox", { name: "Organization" }), "Plat");
    await userEvent.click(await screen.findByRole("option", { name: /Platform Team/ }));
    expect(await within(dialog).findByText(/64 people become members of Platform Team/)).toBeTruthy();
    expect(within(dialog).getByText(/51 of them have an account already, 13 get one/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("button", { name: "Add rule" }));
    await waitFor(() =>
      expect(
        requests.find((entry) => entry.method === "POST" && entry.path.endsWith("/mapping-rules"))?.body,
      ).toEqual({
        target: "organization",
        group: { id: "sg-platform-team", name: "Platform team" },
        organizationId: ORGANIZATION,
        role: null,
        synchronizedGroup: false,
        homeOrganization: false,
      }),
    );
    expect(await screen.findByText("Platform team")).toBeTruthy();
  });
});

describe("the sync log", () => {
  it("lists runs, filters failed runs and shows the changes of a run", async () => {
    const { requests } = adminApi({
      [`GET ${BASE}/mapping-rules`]: () => ({ body: [] }),
      [`GET ${BASE}/sync-runs`]: () => ({
        body: {
          items: [
            {
              id: RUN,
              providerId: PROVIDER,
              trigger: "manual",
              status: "warnings",
              startedAt: "2026-10-02T11:52:00.000Z",
              finishedAt: "2026-10-02T11:52:38.000Z",
              durationMs: 38_000,
              changeCount: 2,
              warningCount: 1,
              error: null,
            },
          ],
          nextCursor: null,
        },
      }),
      [`GET ${BASE}/sync-runs/${RUN}`]: () => ({
        body: {
          id: RUN,
          providerId: PROVIDER,
          trigger: "manual",
          status: "warnings",
          startedAt: "2026-10-02T11:52:00.000Z",
          finishedAt: "2026-10-02T11:52:38.000Z",
          durationMs: 38_000,
          changeCount: 2,
          warningCount: 1,
          error: null,
          changes: [
            { kind: "accountDeactivated", accountId: OLIVIA.id, organizationId: null, detail: null },
            { kind: "membershipAdded", accountId: OLIVIA.id, organizationId: ORGANIZATION, detail: null },
          ],
          warnings: [{ kind: "missingGroup", accountId: null, ruleId: RULE, detail: "sg-old-projects" }],
          references: {
            [OLIVIA.id]: "Sara Berger",
            [ORGANIZATION]: "Platform Team",
            [RULE]: "sg-old-projects",
          },
        },
      }),
      [`POST ${BASE}/sync`]: () => ({ status: 202, body: { runId: null } }),
    });
    await renderPath(`/settings/instance/sign-in-providers/${PROVIDER}?tab=sync`);
    const table = await screen.findByRole("table", { name: "Synchronization runs" });
    expect(within(table).getByText("Completed with warnings")).toBeTruthy();
    expect(within(table).getByText("2 changes, 1 warning")).toBeTruthy();
    expect(within(table).getByText("38 s")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Sync now" }));
    await waitFor(() => expect(requests.some((entry) => entry.path === `${BASE}/sync`)).toBe(true));

    await userEvent.click(screen.getByRole("combobox", { name: "Filter runs" }));
    await userEvent.click(await screen.findByRole("option", { name: "Failed" }));
    await waitFor(() => expect(requests.some((entry) => entry.path.includes("filter=failed"))).toBe(true));

    await userEvent.click(await screen.findByRole("row", { name: /Show the run of/ }));
    const panel = await screen.findByRole("dialog", { name: "Synchronization run" });
    expect(await within(panel).findByText("Account deactivated")).toBeTruthy();
    expect(within(panel).getByText("Sara Berger · Platform Team")).toBeTruthy();
    expect(within(panel).getByText("Group no longer exists")).toBeTruthy();
  });

  it("cancels a running synchronization from its run", async () => {
    const running = {
      id: RUN,
      providerId: PROVIDER,
      trigger: "schedule",
      status: "running",
      startedAt: "2026-10-02T11:52:00.000Z",
      finishedAt: null,
      durationMs: null,
      changeCount: 0,
      warningCount: 0,
      error: null,
    };
    const { requests } = adminApi({
      [`GET ${BASE}/mapping-rules`]: () => ({ body: [] }),
      [`GET ${BASE}/sync-runs`]: () => ({ body: { items: [running], nextCursor: null } }),
      [`GET ${BASE}/sync-runs/${RUN}`]: () => ({
        body: { ...running, changes: [], warnings: [], references: {} },
      }),
      [`POST ${BASE}/sync-runs/${RUN}/cancel`]: () => ({ status: 204 }),
    });
    await renderPath(`/settings/instance/sign-in-providers/${PROVIDER}?tab=sync`);
    await userEvent.click(await screen.findByRole("row", { name: /Show the run of/ }));
    const panel = await screen.findByRole("dialog", { name: "Synchronization run" });
    await userEvent.click(await within(panel).findByRole("button", { name: "Cancel run" }));
    await waitFor(() =>
      expect(requests.some((entry) => entry.path === `${BASE}/sync-runs/${RUN}/cancel`)).toBe(true),
    );
  });

  it("shows that a run ended before it could be cancelled and refreshes it", async () => {
    let status = "running";
    const run = () => ({
      id: RUN,
      providerId: PROVIDER,
      trigger: "schedule",
      status,
      startedAt: "2026-10-02T11:52:00.000Z",
      finishedAt: status === "running" ? null : "2026-10-02T11:52:10.000Z",
      durationMs: status === "running" ? null : 10_000,
      changeCount: 0,
      warningCount: 0,
      error: null,
    });
    adminApi({
      [`GET ${BASE}/mapping-rules`]: () => ({ body: [] }),
      [`GET ${BASE}/sync-runs`]: () => ({ body: { items: [run()], nextCursor: null } }),
      [`GET ${BASE}/sync-runs/${RUN}`]: () => ({
        body: { ...run(), changes: [], warnings: [], references: {} },
      }),
      [`POST ${BASE}/sync-runs/${RUN}/cancel`]: () => {
        status = "succeeded";
        return problem(409, "syncNotRunning");
      },
    });
    await renderPath(`/settings/instance/sign-in-providers/${PROVIDER}?tab=sync`);
    await userEvent.click(await screen.findByRole("row", { name: /Show the run of/ }));
    const panel = await screen.findByRole("dialog", { name: "Synchronization run" });
    await userEvent.click(await within(panel).findByRole("button", { name: "Cancel run" }));
    expect(
      await screen.findByText("This run has already ended. The sync log shows its result."),
    ).toBeTruthy();
    await waitFor(() => expect(within(panel).queryByRole("button", { name: "Cancel run" })).toBeNull());
    expect(screen.queryByText(/could not be cancelled/i)).toBeNull();
  });

  it("shows new runs and their results in the sync log as they happen", async () => {
    const runs: unknown[] = [];
    adminApi({
      [`GET ${BASE}/mapping-rules`]: () => ({ body: [] }),
      [`GET ${BASE}/sync-runs`]: () => ({ body: { items: runs, nextCursor: null } }),
    });
    await renderPath(`/settings/instance/sign-in-providers/${PROVIDER}?tab=sync`);
    expect(await screen.findByText("No runs yet.")).toBeTruthy();
    runs.push({
      id: RUN,
      providerId: PROVIDER,
      trigger: "manual",
      status: "running",
      startedAt: "2026-10-02T11:52:00.000Z",
      finishedAt: null,
      durationMs: null,
      changeCount: 0,
      warningCount: 0,
      error: null,
    });
    emitStream("syncRuns", { providerId: PROVIDER, runId: RUN });
    expect(await screen.findByRole("row", { name: /Show the run of/ })).toBeTruthy();
    runs[0] = {
      ...(runs[0] as object),
      status: "succeeded",
      finishedAt: "2026-10-02T11:52:10.000Z",
      durationMs: 10_000,
    };
    emitStream("syncRuns", { providerId: PROVIDER, runId: RUN });
    expect(await screen.findByText("Completed")).toBeTruthy();
  });

  it("confirms the deactivations a run held back", async () => {
    const held = {
      id: RUN,
      providerId: PROVIDER,
      trigger: "schedule",
      status: "failed",
      startedAt: "2026-10-02T11:52:00.000Z",
      finishedAt: "2026-10-02T11:52:10.000Z",
      durationMs: 10_000,
      changeCount: 0,
      warningCount: 1,
      error: "The run would deactivate 40 of 120 accounts, more than 20 %, so it deactivated nobody",
      heldDeactivations: 40,
      confirmedAt: null,
    };
    const { requests } = adminApi({
      [`GET ${BASE}/mapping-rules`]: () => ({ body: [] }),
      [`GET ${BASE}/sync-runs`]: () => ({ body: { items: [held], nextCursor: null } }),
      [`GET ${BASE}/sync-runs/${RUN}`]: () => ({
        body: {
          ...held,
          changes: [],
          warnings: [{ kind: "deactivationLimit", accountId: null, ruleId: null, detail: "40/120" }],
          references: {},
        },
      }),
      [`POST ${BASE}/sync-runs/${RUN}/confirm`]: () => ({ status: 202, body: { runId: null } }),
    });
    await renderPath(`/settings/instance/sign-in-providers/${PROVIDER}?tab=sync`);
    await userEvent.click(await screen.findByRole("row", { name: /Show the run of/ }));
    const panel = await screen.findByRole("dialog", { name: "Synchronization run" });
    expect(await within(panel).findByText("Too many deactivations at once")).toBeTruthy();
    expect(within(panel).getByText(/would have deactivated 40 accounts at once/)).toBeTruthy();
    await userEvent.click(within(panel).getByRole("button", { name: "Confirm deactivations" }));
    const confirmation = within(panel).getByRole("group", { name: "Deactivate these accounts?" });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(requests.some((entry) => entry.path === `${BASE}/sync-runs/${RUN}/confirm`)).toBe(false);
    await userEvent.click(within(confirmation).getByRole("button", { name: "Confirm deactivations" }));
    await waitFor(() =>
      expect(requests.some((entry) => entry.path === `${BASE}/sync-runs/${RUN}/confirm`)).toBe(true),
    );
  });

  it("saves the largest share a run may deactivate at once", async () => {
    const { requests } = adminApi({
      [`PATCH ${BASE}`]: (request) => ({
        body: { ...provider(), config: (request.body as { config: unknown }).config },
      }),
    });
    await renderPath(`/settings/instance/sign-in-providers/${PROVIDER}?tab=settings`);
    const field = await screen.findByRole("textbox", { name: "Largest share deactivated at once" });
    await userEvent.clear(field);
    await userEvent.type(field, "0{Enter}");
    expect(await screen.findByRole("alert")).toBeTruthy();
    await userEvent.clear(field);
    await userEvent.type(field, "35{Enter}");
    await waitFor(() =>
      expect(requests.find((entry) => entry.method === "PATCH" && entry.path === BASE)?.body).toMatchObject({
        config: { sync: { intervalMinutes: 60, deactivationLimitPercent: 35, deactivationLimitAccounts: 5 } },
      }),
    );
    const minimum = screen.getByRole("textbox", { name: "Accounts a run may always deactivate" });
    await userEvent.clear(minimum);
    await userEvent.type(minimum, "12{Enter}");
    await waitFor(() =>
      expect(
        requests.filter((entry) => entry.method === "PATCH" && entry.path === BASE).at(-1)?.body,
      ).toMatchObject({ config: { sync: { deactivationLimitAccounts: 12 } } }),
    );
  });

  it("turns on Google group sync with an administrator role and warns about delegation", async () => {
    const { requests } = adminApi({
      [`GET ${BASE}`]: () => ({ body: provider("google") }),
      [`PATCH ${BASE}`]: (request) => ({
        body: { ...provider("google"), config: (request.body as { config: unknown }).config },
      }),
    });
    await renderPath(`/settings/instance/sign-in-providers/${PROVIDER}?tab=settings`);
    await userEvent.click(await screen.findByRole("switch", { name: "Synchronize groups" }));
    await waitFor(() =>
      expect(requests.find((entry) => entry.method === "PATCH" && entry.path === BASE)?.body).toMatchObject({
        config: { directory: { method: "adminRole", readUsers: false } },
      }),
    );
    expect(await screen.findByText(/assign the prebuilt role Groups Reader/)).toBeTruthy();
    await userEvent.click(screen.getByRole("radio", { name: "Domain-wide delegation" }));
    expect(await screen.findByText(/acts as the administrator below/)).toBeTruthy();
  });

  it("explains that providers without a directory only update at sign-in", async () => {
    adminApi({
      [`GET ${BASE}`]: () => ({ body: provider("generic") }),
      [`GET ${BASE}/mapping-rules`]: () => ({ body: [] }),
    });
    await renderPath(`/settings/instance/sign-in-providers/${PROVIDER}?tab=sync`);
    expect(await screen.findByText(/It has no directory Lunedo could synchronize with/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sync now" })).toBeNull();
  });

  it("shows a Google provider without group sync only what it can do", async () => {
    adminApi({ [`GET ${BASE}`]: () => ({ body: provider("google") }) });
    await renderPath(`/settings/instance/sign-in-providers/${PROVIDER}`);
    expect(await screen.findByRole("tab", { name: "Sync log" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Group mapping" })).toBeNull();
    expect(screen.queryByText("Last sync")).toBeNull();
    await userEvent.click(screen.getByRole("tab", { name: "Sync log" }));
    expect(await screen.findByText(/Turn on group synchronization in the settings/)).toBeTruthy();
  });
});

describe("synchronized groups", () => {
  const GROUP = "01929b1e-0000-7000-8000-0000000000f1";
  const group = {
    id: GROUP,
    organizationId: ORGANIZATION,
    name: "Engineering",
    description: null,
    managedBy: { providerId: PROVIDER, providerName: "Entra ID" },
    managers: [],
  };

  const organization = {
    id: ORGANIZATION,
    name: "Platform Team",
    slug: "platform-team",
    logoRef: null,
    language: "en",
    timeZone: "Europe/Vienna",
    accentColor: "petrol",
    createdAt: "2026-10-01T08:00:00.000Z",
    membershipKind: "member",
  };

  function organizationApi() {
    return adminApi({
      [`GET /api/v1/organizations/${ORGANIZATION}`]: () => ({ body: organization }),
      "GET /api/v1/organizations": () => ({ body: { items: [organization], nextCursor: null } }),
      "GET /api/v1/account/permissions": () => ({
        body: {
          instance: [],
          organization: ["organization.view", "organization.members.view", "organization.members.manage"],
          grantableAreas: { instance: {}, organization: {} },
        },
      }),
      [`GET /api/v1/organizations/${ORGANIZATION}/groups`]: () => ({
        body: {
          items: [
            group,
            { ...group, id: "01929b1e-0000-7000-8000-0000000000f2", name: "Projects", managedBy: null },
          ],
          nextCursor: null,
        },
      }),
      [`GET /api/v1/groups/${GROUP}`]: () => ({ body: group }),
      [`GET /api/v1/groups/${GROUP}/members`]: () => ({
        body: { items: [{ accountId: OLIVIA.id, name: OLIVIA.name, email: OLIVIA.email }], nextCursor: null },
      }),
    });
  }

  it("names the provider that manages a group", async () => {
    organizationApi();
    await renderPath(`/settings/organizations/${ORGANIZATION}/groups`);
    const table = await screen.findByRole("table");
    expect(await within(table).findByText("Entra ID")).toBeTruthy();
    expect(within(table).getByText("Lunedo")).toBeTruthy();
  });

  it("keeps the members of a synchronized group read-only", async () => {
    organizationApi();
    await renderPath(`/settings/organizations/${ORGANIZATION}/groups/${GROUP}`);
    expect(await screen.findByText("Managed by Entra ID")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add member" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete group" })).toBeNull();
  });
});
