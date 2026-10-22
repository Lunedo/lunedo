import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App, createQueryClient } from "../../app.js";
import { initI18n } from "../../i18n/index.js";
import { mockApi } from "../../testing/render.js";

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

function problem(status: number, code: string) {
  return { status, body: { type: `urn:lunedo:problem:${code}`, title: code, status, code } };
}

function api() {
  let declined = false;
  return mockApi({
    "GET /api/v1/instance/info": () => ({
      body: {
        name: "Lunedo",
        setupComplete: true,
        language: "en",
        accentColor: "petrol",
        passwordMinLength: 12,
        selfRegistration: false,
        organization: null,
      },
    }),
    "GET /api/v1/auth/session": () => problem(401, "notSignedIn"),
    "GET /api/v1/auth/link": () =>
      declined
        ? problem(410, "challengeExpired")
        : {
            body: {
              password: true,
              passkey: false,
              providers: [],
              confirmed: false,
              providerName: "Company login",
              email: "lena@example.org",
              accountName: "Lena Lind",
              factors: [],
            },
          },
    "POST /api/v1/auth/link": () => problem(401, "invalidCredentials"),
    "POST /api/v1/auth/link/decline": () => {
      declined = true;
      return { body: { reference: "E2M1-855D" } };
    },
  });
}

async function open() {
  window.history.replaceState(null, "", "/sign-in/link");
  const i18n = await initI18n(["en"]);
  render(<App i18n={i18n} queryClient={createQueryClient()} />);
}

describe("linking an identity to an existing account", () => {
  it("names the account at a wrong password without an e-mail address", async () => {
    api();
    await open();
    await userEvent.type(await screen.findByLabelText("Password of Lena Lind"), "wrong password");
    await userEvent.click(screen.getByRole("button", { name: "Confirm and link" }));
    expect(
      await screen.findByText(
        'This is not the Lunedo password of Lena Lind. Enter it again, or reset it with "Forgot password?" on the sign-in page.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/e-mail address or the password/)).toBeNull();
  });

  it("shows the reference after a wrong password instead of an expired link", async () => {
    api();
    await open();
    await userEvent.type(await screen.findByLabelText("Password of Lena Lind"), "wrong password");
    await userEvent.click(screen.getByRole("button", { name: "Confirm and link" }));
    await screen.findByText(/This is not the Lunedo password/);
    await userEvent.click(screen.getByRole("button", { name: "This is not my account" }));
    expect(await screen.findByText("E2M1-855D")).toBeTruthy();
    expect(screen.queryByText("This link has expired")).toBeNull();
  });
});
