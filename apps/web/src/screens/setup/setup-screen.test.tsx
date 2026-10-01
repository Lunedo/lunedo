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
        name: "Pagehall",
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
        "The code is in the .env file if you used the setup script or set PAGEHALL_SETUP_CODE. Otherwise it is in the log of the Pagehall container:",
      ),
    ).toBeTruthy();
    expect(screen.getByText('docker compose logs pagehall | grep "Setup link"')).toBeTruthy();
  });
});
