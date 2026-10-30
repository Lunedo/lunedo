import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "../../app.js";
import { initI18n } from "../../i18n/index.js";
import { mockApi } from "../../testing/render.js";
import { codeFromFragment } from "./setup-screen.js";

const CODE = "VDXK-T5DV-CB5W-NSEN";

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

function api() {
  return mockApi({
    "GET /api/v1/instance/info": () => ({
      body: {
        name: "Lunedo",
        setupComplete: false,
        language: "en",
        accentColor: "petrol",
        passwordMinLength: 12,
        selfRegistration: false,
        organization: null,
      },
    }),
    "GET /api/v1/setup": () => ({ body: { completed: false, session: false } }),
    "POST /api/v1/setup/session": () => ({ status: 204 }),
  });
}

async function renderSetup(path: string) {
  window.history.replaceState(null, "", path);
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
}

describe("codeFromFragment", () => {
  it("reads the code from the fragment and ignores anything else", () => {
    expect(codeFromFragment(`#code=${CODE}`)).toBe(CODE);
    expect(codeFromFragment(`#other=1&code=${CODE}`)).toBe(CODE);
    expect(codeFromFragment("#code=")).toBe("");
    expect(codeFromFragment(`#code=${"X".repeat(65)}`)).toBe("");
    expect(codeFromFragment("")).toBe("");
  });
});

describe("the setup code page", () => {
  it("fills in the code from the link and removes it from the address bar", async () => {
    const { requests } = api();
    await renderSetup(`/setup#code=${CODE}`);
    const input = await screen.findByLabelText("Setup code");
    expect((input as HTMLInputElement).value).toBe(CODE);
    await waitFor(() => expect(window.location.hash).toBe(""));
    expect(window.location.pathname).toBe("/setup");

    await userEvent.click(screen.getByRole("button", { name: "Set up a new instance" }));
    await waitFor(() =>
      expect(requests.find((request) => request.path === "/api/v1/setup/session")?.body).toEqual({
        code: CODE,
      }),
    );
  });

  it("explains where to find the code", async () => {
    api();
    await renderSetup("/setup");
    expect((await screen.findByLabelText("Setup code")).getAttribute("value") ?? "").toBe("");
    expect(
      screen.getByText(
        /^It is in the \.env file \(LUNEDO_SETUP_CODE\) if you used the setup script, otherwise in the log of the container:/,
      ),
    ).toBeTruthy();
    expect(screen.getByText('docker compose logs lunedo | grep "Setup link"')).toBeTruthy();
  });
});

describe("the setup steps", () => {
  it("offers the language from the setup code on", async () => {
    api();
    await renderSetup("/setup");
    await screen.findByLabelText("Setup code");
    expect(screen.getByRole("button", { name: /^Language of the setup: English/ })).toBeTruthy();
    expect(screen.queryByRole("contentinfo")).toBeNull();
  });

  it("says where the code comes from when it is wrong", async () => {
    mockApi({
      "GET /api/v1/instance/info": () => ({
        body: {
          name: "Lunedo",
          setupComplete: false,
          language: "en",
          accentColor: "petrol",
          passwordMinLength: 12,
          selfRegistration: false,
          organization: null,
        },
      }),
      "GET /api/v1/setup": () => ({ body: { completed: false, session: false } }),
      "POST /api/v1/setup/session": () => ({
        status: 400,
        body: {
          type: "urn:lunedo:problem:invalidSetupCode",
          title: "Wrong",
          status: 400,
          code: "invalidSetupCode",
        },
      }),
    });
    await renderSetup("/setup");
    await userEvent.type(await screen.findByLabelText("Setup code"), CODE);
    await userEvent.click(screen.getByRole("button", { name: "Set up a new instance" }));
    expect(await screen.findByText(/Copy the code from LUNEDO_SETUP_CODE in the \.env file/)).toBeTruthy();
  });

  it("keeps what was typed when going back", async () => {
    stepsApi([{ ...INSTANCE, completed: false }]);
    await renderSetup("/setup");
    const name = await screen.findByLabelText("Instance name");
    await userEvent.clear(name);
    await userEvent.type(name, "Team wiki");
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("heading", { name: "Welcome" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Set up a new instance" }));
    expect(((await screen.findByLabelText("Instance name")) as HTMLInputElement).value).toBe("Team wiki");
  });

  it("shows the step in a menu where only reached steps can be chosen, and goes back with the browser", async () => {
    stepsApi([
      INSTANCE,
      SYSTEM_CHECK,
      { ...OWNER, completed: false, details: { ...OWNER.details, totpConfirmed: false } },
      { ...KEYS, completed: false, details: { downloaded: false, provider: "file" } },
      { ...ORGANIZATION, completed: false, details: { organization: null, formats: null } },
    ]);
    await renderSetup("/setup");
    const menu = await screen.findByRole("button", { name: "Step 4 of 7 · Owner account" });
    expect(screen.getByRole("progressbar", { name: "Step 4 of 7 · Owner account" })).toBeTruthy();
    await userEvent.click(menu);
    expect(screen.getByRole("menuitem", { name: "Instance" }).getAttribute("aria-disabled")).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Emergency kit" }).getAttribute("aria-disabled")).toBe(
      "true",
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "System check" }));
    expect(await screen.findByRole("heading", { name: "System check" })).toBeTruthy();
    expect(screen.getByText("https://wiki.example.org can be reached")).toBeTruthy();
    window.history.back();
    expect(await screen.findByRole("heading", { name: "Owner account" })).toBeTruthy();
  });

  it("sums up every step, jumps back to change one and finishes with the next steps", async () => {
    const { requests } = stepsApi([INSTANCE, SYSTEM_CHECK, OWNER, KEYS, ORGANIZATION], {
      "POST /api/v1/setup/complete": () => ({ body: { mailConfigured: false } }),
    });
    await renderSetup("/setup");
    expect(await screen.findByRole("heading", { name: "Summary" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Instance" }).textContent).toContain(
      "https://wiki.example.org",
    );
    expect(screen.getByRole("region", { name: "System check" }).textContent).toContain(
      "4 OK, 1 warning (HTTPS)",
    );
    expect(screen.getByRole("region", { name: "Owner account" }).textContent).toContain("Authenticator app");
    expect(screen.getByRole("region", { name: "Emergency kit" }).textContent).toContain("Yes, confirmed");
    const organization = screen.getByRole("region", { name: "Organization" }).textContent ?? "";
    expect(organization).toContain("Platform Team");
    expect(organization).toMatch(/English, Europe\/Vienna \(UTC\+[12]\)/);
    expect(organization).toMatch(/Formats\d{1,2} \w{3} \d{4} · 14:30 · 1,234\.56 · Monday/);
    expect(screen.queryByRole("button", { name: "Change System check" })).toBeNull();
    const checks = requests.filter((request) => request.path === "/api/v1/setup/steps").length;
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() =>
      expect(requests.filter((request) => request.path === "/api/v1/setup/steps").length).toBe(checks + 1),
    );

    await userEvent.click(screen.getByRole("button", { name: "Change Instance" }));
    expect(await screen.findByLabelText("Instance name")).toBeTruthy();
    window.history.back();
    await userEvent.click(await screen.findByRole("button", { name: "Finish setup" }));
    expect(await screen.findByRole("heading", { name: "Lunedo is ready" })).toBeTruthy();
    expect(requests.some((request) => request.path === "/api/v1/setup/complete")).toBe(true);
    const next = screen.getAllByRole("listitem").map((item) => item.textContent ?? "");
    expect(next[0]).toContain("Set up e-mail");
    expect(next[1]).toContain("Invitations are sent by e-mail, so set up e-mail first.");
    expect(screen.getByRole("button", { name: "Invite" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Create space" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Go to For you" })).toBeTruthy();
  });
});

describe("an address from the environment", () => {
  it("shows it locked in the summary, without a way to change it", async () => {
    stepsApi([
      { ...INSTANCE, details: { ...INSTANCE.details, urlFromEnvironment: true } },
      SYSTEM_CHECK,
      OWNER,
      KEYS,
      ORGANIZATION,
    ]);
    await renderSetup("/setup");
    const instance = await screen.findByRole("region", { name: "Instance" });
    expect(instance.textContent).toContain("Locked:");
    expect(screen.queryByRole("button", { name: "Change Instance" })).toBeNull();
    expect(screen.getByRole("button", { name: "Change Organization" })).toBeTruthy();
  });
});

const CHECK = { status: "ok", cause: null, fixCommand: null, docs: "admin/system-check.md" };
const INSTANCE = {
  id: "instance",
  required: true,
  completed: true,
  details: {
    url: "https://wiki.example.org",
    name: "Lunedo",
    suggestedUrl: "https://wiki.example.org",
    urlFromEnvironment: false,
  },
};
const SYSTEM_CHECK = {
  id: "systemCheck",
  required: true,
  completed: true,
  details: {
    checks: {
      database: { ...CHECK, version: "16", migrationsUpToDate: true },
      clock: { ...CHECK, offsetMs: 0, toleranceMs: 5000 },
      fileStorage: {
        ...CHECK,
        path: "/files",
        exists: true,
        writable: true,
        freeBytes: 10_000_000_000,
        minimumFreeBytes: 1,
        processUid: 1,
        processGid: 1,
        ownerUid: 1,
        ownerGid: 1,
      },
      instanceUrl: { ...CHECK, configured: true, url: "https://wiki.example.org", source: "setting" },
      reachability: { ...CHECK, url: "https://wiki.example.org" },
      https: {
        ...CHECK,
        status: "warning",
        cause: "instanceUrlNotHttps",
        instanceUrl: false,
        request: false,
      },
      clientAddress: { ...CHECK },
    },
  },
};
const OWNER = {
  id: "owner",
  required: true,
  completed: true,
  details: {
    owner: { name: "Olivia Owner", email: "olivia@example.org" },
    totpConfirmed: true,
    passwordMaxLength: 1024,
  },
};
const KEYS = {
  id: "keyBackup",
  required: true,
  completed: true,
  details: { downloaded: true, provider: "file" },
};
const ORGANIZATION = {
  id: "organization",
  required: true,
  completed: true,
  details: {
    organization: {
      id: "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f",
      name: "Platform Team",
      slug: "platform-team",
      language: "en",
      timeZone: "Europe/Vienna",
    },
    formats: { dateFormat: "D MMM YYYY", timeFormat: "24h", numberFormat: "en-US", firstDayOfWeek: "monday" },
  },
};

function stepsApi(steps: object[], extra: Parameters<typeof mockApi>[0] = {}) {
  return mockApi({
    "GET /api/v1/instance/info": () => ({
      body: {
        name: "Lunedo",
        setupComplete: false,
        language: "en",
        accentColor: "petrol",
        passwordMinLength: 12,
        selfRegistration: false,
        organization: null,
      },
    }),
    "GET /api/v1/setup": () => ({ body: { completed: false, session: true } }),
    "GET /api/v1/setup/steps": () => ({ body: { ready: false, steps } }),
    ...extra,
  });
}
