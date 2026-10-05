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
          name: "Pagehall",
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
});
