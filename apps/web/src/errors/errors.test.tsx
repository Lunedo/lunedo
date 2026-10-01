import { Button } from "@pagehall/ui";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "../app.js";
import { initI18n } from "../i18n/index.js";
import { PreferencesProvider } from "../preferences/preferences-provider.js";
import { SystemCheckStep } from "../screens/setup/steps/system-check-step.js";
import { mockApi, problem, renderWithProviders } from "../testing/render.js";
import { useFailureToast } from "./failure.js";

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
  const help = { cause: null, fixCommand: null, docs: "setup.md#system-check" };
  return {
    database: { status: "ok", ...help, version: "16.4", migrationsUpToDate: true },
    clock: { status: "ok", ...help, offsetMs: 120, toleranceMs: 5000 },
    fileStorage: {
      status: "error",
      cause: "notWritable",
      fixCommand: "chown -R 1000:1000 /var/lib/pagehall/files",
      docs: "setup.md#file-storage",
      path: "/var/lib/pagehall/files",
      exists: true,
      writable: false,
      freeBytes: null,
      minimumFreeBytes: 1_073_741_824,
      processUid: 1000,
      processGid: 1000,
      ownerUid: 0,
      ownerGid: 0,
    },
    instanceUrl: { status: "warning", ...help, cause: "notSet", configured: false },
    https: { status: "ok", ...help, instanceUrl: true, request: true },
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
          back={null}
          onDone={async () => undefined}
          refresh={refresh}
        />
      </PreferencesProvider>,
    );
    expect(screen.getByText("File storage did not pass the check")).toBeTruthy();
    expect(
      screen.getByText(
        "/var/lib/pagehall/files is not writable by the user Pagehall runs as (UID 1000). The directory belongs to UID 0.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("chown -R 1000:1000 /var/lib/pagehall/files")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /Read the documentation/ })[0]?.getAttribute("href")).toBe(
      "https://github.com/pagehall/pagehall/blob/main/docs/setup.md#file-storage",
    );
    expect(screen.getByText("You set it in the next step.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" }).hasAttribute("disabled")).toBe(true);

    await userEvent.click(screen.getAllByRole("button", { name: "Check again" })[0] as HTMLElement);
    await userEvent.click(screen.getByRole("button", { name: "Run all checks again" }));
    expect(refresh).toHaveBeenCalledTimes(2);
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
        body: { instance: [], organization: ["organization.view", "organization.groups.view"] },
      }),
      "GET /api/v1/account/preferences": () => ({ body: [] }),
      "GET /api/v1/notifications/unread-count": () => ({ body: { count: 0 } }),
      [`GET /api/v1/organizations/${ORGANIZATION.id}`]: () => ({ body: ORGANIZATION }),
      [`GET /api/v1/organizations/${ORGANIZATION.id}/groups`]: () =>
        failing ? problem(503, "busy") : { body: { items: [], nextCursor: null } },
    });
    window.history.replaceState(null, "", `/settings/organizations/${ORGANIZATION.id}/groups`);
    const i18n = await initI18n(["en"]);
    render(<App i18n={i18n} queryClient={createQueryClient()} />);

    const alert = await screen.findByText("This page could not be loaded", {}, { timeout: 5000 });
    const notice = alert.closest("[role=alert], div") as HTMLElement;
    expect(within(notice.parentElement as HTMLElement).getByText(/The server is busy/)).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Settings" })).toBeTruthy();
    failing = false;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByText("This page could not be loaded")).toBeNull());
    expect(await screen.findByRole("heading", { name: "Groups", level: 1 })).toBeTruthy();
  });
});
