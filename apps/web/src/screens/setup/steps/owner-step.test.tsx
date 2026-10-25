import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { mockApi, renderWithProviders } from "../../../testing/render.js";
import { OwnerStep } from "./owner-step.js";

describe("the owner step", () => {
  it("creates the owner without a personal language, whatever language the setup shows", async () => {
    const { requests } = mockApi({
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
      "POST /api/v1/setup/steps/owner/createAccount": () => ({ body: {} }),
    });
    await renderWithProviders(
      <OwnerStep
        details={{ owner: null, totpConfirmed: false, passwordMaxLength: 1024 }}
        completed={false}
        back={null}
        onDone={async () => undefined}
        refresh={async () => undefined}
      />,
      "de",
    );
    await userEvent.type(screen.getByLabelText("Name"), "Olivia Owner");
    await userEvent.type(screen.getByLabelText("E-Mail"), "olivia@example.org");
    await userEvent.type(screen.getByLabelText("Passwort"), "violet tram umbrella");
    await userEvent.type(screen.getByLabelText("Passwort wiederholen"), "violet tram umbrella");
    await userEvent.click(screen.getByRole("button", { name: "Weiter" }));
    await waitFor(() =>
      expect(
        requests.find((request) => request.path === "/api/v1/setup/steps/owner/createAccount")?.body,
      ).toEqual({ name: "Olivia Owner", email: "olivia@example.org", password: "violet tram umbrella" }),
    );
  });

  it("completes the step with the authenticator and leaves the recovery codes to the emergency kit", async () => {
    const { requests } = mockApi({
      "POST /api/v1/setup/steps/owner/beginTotp": () => ({
        body: {
          secret: "JBSWY3DPEHPK3PXP",
          uri: "otpauth://totp/Lunedo:olivia%40example.org?secret=JBSWY3DPEHPK3PXP",
        },
      }),
      "POST /api/v1/setup/steps/owner/confirmTotp": () => ({ body: {} }),
    });
    let done = false;
    await renderWithProviders(
      <OwnerStep
        details={{
          owner: { name: "Olivia Owner", email: "olivia@example.org" },
          totpConfirmed: true,
          passwordMaxLength: 1024,
        }}
        completed={false}
        back={null}
        onDone={async () => {
          done = true;
        }}
        refresh={async () => undefined}
      />,
    );
    await userEvent.type(await screen.findByLabelText("Code from your authenticator app"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(done).toBe(true));
    expect(requests.map((request) => request.path)).toEqual([
      "/api/v1/setup/steps/owner/beginTotp",
      "/api/v1/setup/steps/owner/confirmTotp",
    ]);
    expect(screen.queryByText(/recovery code/i)).toBeNull();
  });

  it("shows the ready owner once the step is complete", async () => {
    const { requests } = mockApi({});
    await renderWithProviders(
      <OwnerStep
        details={{
          owner: { name: "Olivia Owner", email: "olivia@example.org" },
          totpConfirmed: true,
          passwordMaxLength: 1024,
        }}
        completed
        back={null}
        onDone={async () => undefined}
        refresh={async () => undefined}
      />,
    );
    expect(await screen.findByText("The owner account is ready")).toBeTruthy();
    expect(requests).toEqual([]);
  });
});
