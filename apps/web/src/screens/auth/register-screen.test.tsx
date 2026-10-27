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

describe("registering", () => {
  it("sends addresses of a managed domain to their provider instead of registering them", async () => {
    mockApi({
      "GET /api/v1/instance/info": () => ({
        body: {
          name: "Lunedo",
          setupComplete: true,
          language: "en",
          accentColor: "petrol",
          passwordMinLength: 12,
          selfRegistration: true,
          organization: null,
        },
      }),
      "GET /api/v1/auth/session": () => ({
        status: 401,
        body: {
          type: "urn:lunedo:problem:notSignedIn",
          title: "Not signed in",
          status: 401,
          code: "notSignedIn",
        },
      }),
      "POST /api/v1/registrations": () => ({
        status: 409,
        body: {
          type: "urn:lunedo:problem:managedDomain",
          title: "Addresses of this domain sign in through an identity provider",
          status: 409,
          code: "managedDomain",
          providerId: "01929b1e-0000-7000-8000-0000000000e1",
          providerName: "Nordwind SSO",
        },
      }),
    });
    window.history.replaceState(null, "", "/register");
    const i18n = await initI18n(["en"]);
    render(<App i18n={i18n} queryClient={createQueryClient()} />);
    await userEvent.type(
      await screen.findByLabelText("Work e-mail address or sign-in name"),
      "lena@nordwind.example",
    );
    await userEvent.click(screen.getByRole("button", { name: "Send link" }));
    expect(await screen.findByText("Sign in through your provider")).toBeTruthy();
    expect(
      screen.getByText(
        "Addresses of this domain sign in through Nordwind SSO and need no registration. Use the button of Nordwind SSO on the sign-in page; your account is created there or your administrator invites you.",
      ),
    ).toBeTruthy();
  });
});
