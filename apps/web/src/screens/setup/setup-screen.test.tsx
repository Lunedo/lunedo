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

    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
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
        "The code is in the .env file if you used the setup script or set LUNEDO_SETUP_CODE. Otherwise it is in the log of the Lunedo container:",
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
    expect(screen.getByRole("combobox", { name: "Language of the setup" })).toBeTruthy();
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
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/Copy the code from LUNEDO_SETUP_CODE in the \.env file/)).toBeTruthy();
  });

  it("keeps what was typed when going back", async () => {
    const check = { status: "ok", cause: null, fixCommand: null, docs: "setup.md" };
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
      "GET /api/v1/setup": () => ({ body: { completed: false, session: true } }),
      "POST /api/v1/setup/steps/systemCheck/acknowledge": () => ({ body: {} }),
      "GET /api/v1/setup/steps": () => ({
        body: {
          ready: false,
          steps: [
            {
              id: "systemCheck",
              required: true,
              completed: true,
              details: {
                checks: {
                  database: { ...check, version: "16", migrationsUpToDate: true },
                  clock: { ...check, offsetMs: 0, toleranceMs: 5000 },
                  fileStorage: {
                    ...check,
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
                  instanceUrl: {
                    ...check,
                    status: "warning",
                    cause: "notSet",
                    configured: false,
                    url: null,
                    source: null,
                  },
                  https: { ...check, instanceUrl: true, request: true },
                },
              },
            },
            {
              id: "instance",
              required: true,
              completed: false,
              details: {
                url: "",
                name: "Lunedo",
                suggestedUrl: "https://wiki.example.org",
                urlFromEnvironment: false,
              },
            },
          ],
        },
      }),
    });
    await renderSetup("/setup");
    const name = await screen.findByLabelText("Instance name");
    await userEvent.clear(name);
    await userEvent.type(name, "Team wiki");
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("You set the address in the next step.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(((await screen.findByLabelText("Instance name")) as HTMLInputElement).value).toBe("Team wiki");
  });
});
