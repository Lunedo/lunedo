import { Button } from "@lunedo/ui";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "../app.js";
import { resetUpdateState, setUpdateEnvironment } from "../app-update/app-update.js";
import { initI18n } from "../i18n/index.js";
import { PreferencesProvider } from "../preferences/preferences-provider.js";
import { SystemCheckStep } from "../screens/setup/steps/system-check-step.js";
import { mockApi, problem, renderWithProviders } from "../testing/render.js";
import { useFailureToast } from "./failure.js";
import { ScreenErrorScreen } from "./route-error.js";

const ORGANIZATION = {
  id: "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f",
  name: "Platform Team",
  slug: "platform-team",
  logoRef: null,
  language: "en",
  timeZone: "Europe/Vienna",
  accentColor: "petrol",
  createdAt: "2026-10-01T08:00:00.000Z",
  membershipKind: "member",
};

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

function checks(patch: Record<string, unknown> = {}) {
  const help = { cause: null, fixCommand: null, docs: "admin/system-check.md" };
  return {
    database: { status: "ok", ...help, version: "16.4", migrationsUpToDate: true },
    clock: { status: "ok", ...help, offsetMs: 120, toleranceMs: 5000 },
    fileStorage: {
      status: "error",
      cause: "notWritable",
      fixCommand: "chown -R 1000:1000 /var/lib/lunedo/files",
      docs: "admin/system-check.md#file-storage",
      path: "/var/lib/lunedo/files",
      exists: true,
      writable: false,
      freeBytes: null,
      minimumFreeBytes: 1_073_741_824,
      processUid: 1000,
      processGid: 1000,
      ownerUid: 0,
      ownerGid: 0,
    },
    instanceUrl: {
      status: "ok",
      ...help,
      configured: true,
      url: "https://wiki.example.org",
      source: "setting",
    },
    reachability: {
      status: "warning",
      ...help,
      cause: "unreachable",
      docs: "admin/system-check.md#address-reachable",
      url: "https://wiki.example.org",
    },
    https: { status: "ok", ...help, instanceUrl: true, request: true },
    clientAddress: { status: "ok", ...help },
    ...patch,
  };
}

describe("the system check", () => {
  it("explains a failed check with its cause, a command and the documentation", async () => {
    mockApi({ "GET /api/v1/auth/session": () => problem(401, "notSignedIn") });
    const refresh = vi.fn(async () => undefined);
    await renderWithProviders(
      <PreferencesProvider>
        <SystemCheckStep
          details={{ checks: checks() } as never}
          completed={false}
          back={null}
          onDone={async () => undefined}
          refresh={refresh}
        />
      </PreferencesProvider>,
    );
    expect(
      screen.getByText(
        "/var/lib/lunedo/files is not writable by the user Lunedo runs as (UID 1000). The directory belongs to UID 0.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("chown -R 1000:1000 /var/lib/lunedo/files")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy command" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /Read the documentation/ })[0]?.getAttribute("href")).toBe(
      "https://lunedo.org/docs/admin/system-check/#file-storage",
    );
    expect(screen.getByText(/^The server got no answer at https:\/\/wiki\.example\.org,/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Check again" })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("confirms the address and shows HTTPS as a warning with the guide to a reverse proxy", async () => {
    mockApi({ "GET /api/v1/auth/session": () => problem(401, "notSignedIn") });
    await renderWithProviders(
      <PreferencesProvider>
        <SystemCheckStep
          completed={false}
          details={
            {
              checks: checks({
                fileStorage: {
                  ...checks().fileStorage,
                  status: "ok",
                  cause: null,
                  fixCommand: null,
                  freeBytes: 1e10,
                },
                reachability: { ...checks().reachability, status: "ok", cause: null },
                https: {
                  status: "warning",
                  cause: "instanceUrlNotHttps",
                  fixCommand: null,
                  docs: "admin/reverse-proxy.md#tls-and-the-instance-address",
                  instanceUrl: false,
                  request: false,
                },
              }),
            } as never
          }
          back={null}
          onDone={async () => undefined}
          refresh={async () => undefined}
        />
      </PreferencesProvider>,
    );
    expect(screen.getByText("https://wiki.example.org can be reached")).toBeTruthy();
    expect(screen.getByText(/does not start with https:\/\//)).toBeTruthy();
    expect(screen.getByRole("link", { name: /How to set up HTTPS/ }).getAttribute("href")).toBe(
      "https://lunedo.org/docs/admin/reverse-proxy/#tls-and-the-instance-address",
    );
    expect(screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(false);
  });
});

function FailingAction({ code }: { code: string }) {
  const showFailure = useFailureToast();
  const retry = vi.fn();
  return (
    <Button
      onClick={() => showFailure("The role was not saved", Object.assign(new Error(code), { code }), retry)}
    >
      Save
    </Button>
  );
}

describe("failure toasts", () => {
  it("name what failed, explain why and offer a retry", async () => {
    mockApi({});
    await renderWithProviders(<FailingAction code="networkError" />);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("The role was not saved")).toBeTruthy();
    expect(
      screen.getByText(
        "The server gave an unexpected answer. Try again; if it keeps failing, ask your administrator to check the server log.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("screens that cannot load", () => {
  it("say what failed and load again on retry", async () => {
    let failing = true;
    mockApi({
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
        body: {
          sessionKind: "full",
          account: {
            id: "01929b1e-8d4b-7e3f-a05c-4d3e2f1a6b7c",
            email: "olivia@example.org",
            name: "Olivia",
          },
          methods: ["password"],
          recentlyAuthenticated: true,
        },
      }),
      "GET /api/v1/organizations": () => ({ body: { items: [ORGANIZATION], nextCursor: null } }),
      "GET /api/v1/account/permissions": () => ({
        body: {
          instance: [],
          organization: ["organization.view", "organization.integrations.view"],
          grantableAreas: { instance: {}, organization: {} },
        },
      }),
      "GET /api/v1/account/preferences": () => ({ body: [] }),
      "GET /api/v1/notifications/unread-count": () => ({ body: { count: 0, capped: false } }),
      [`GET /api/v1/organizations/${ORGANIZATION.id}`]: () => ({ body: ORGANIZATION }),
      [`GET /api/v1/organizations/${ORGANIZATION.id}/members`]: () => ({
        body: { items: [], nextCursor: null },
      }),
      [`GET /api/v1/organizations/${ORGANIZATION.id}/service-accounts`]: () =>
        failing ? problem(503, "busy") : { body: { items: [], nextCursor: null } },
    });
    window.history.replaceState(null, "", `/settings/organizations/${ORGANIZATION.id}/service-accounts`);
    const i18n = await initI18n(["en"]);
    const queryClient = createQueryClient();
    const defaults = queryClient.getDefaultOptions();
    queryClient.setDefaultOptions({ ...defaults, queries: { ...defaults.queries, retryDelay: 0 } });
    render(<App i18n={i18n} queryClient={queryClient} />);

    const alert = await screen.findByText("This page could not be loaded", {}, { timeout: 5000 });
    const notice = alert.closest("[role=alert], div") as HTMLElement;
    expect(within(notice.parentElement as HTMLElement).getByText(/The server is busy/)).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Settings" })).toBeTruthy();
    failing = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByText("This page could not be loaded")).toBeNull());
    expect(await screen.findByRole("heading", { name: "Service accounts", level: 1 })).toBeTruthy();
  });

  it("blame the browser, not the server, for an error in the page and offer a reload", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    await renderWithProviders(
      <ScreenErrorScreen
        error={new Error("Maximum update depth exceeded")}
        reset={() => undefined}
        info={{ componentStack: "" }}
      />,
    );
    expect(screen.getByText("Something went wrong in this browser")).toBeTruthy();
    expect(screen.queryByText(/server gave an unexpected answer/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Reload page" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reload once instead of showing an error when a part of the app is gone after an update", async () => {
    const reload = vi.fn();
    resetUpdateState();
    const values = new Map<string, string>();
    setUpdateEnvironment({
      reload,
      storage: () =>
        ({
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => values.set(key, value),
        }) as unknown as Storage,
    });
    await renderWithProviders(
      <ScreenErrorScreen
        error={new TypeError("Failed to fetch dynamically imported module: /assets/space-1.js")}
        reset={() => undefined}
        info={{ componentStack: "" }}
      />,
    );
    expect(reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Something went wrong in this browser")).toBeNull();
    expect(screen.queryByRole("button", { name: "Reload page" })).toBeNull();
    resetUpdateState();
  });
});
