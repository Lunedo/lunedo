import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { mockApi, renderWithProviders } from "../../../testing/render.js";
import { OrganizationStep } from "./organization-step.js";

vi.mock("../../../format/time-zones.js", async (original) => ({
  ...(await original<typeof import("../../../format/time-zones.js")>()),
  browserTimeZone: () => "Europe/Vienna",
}));

function renderStep() {
  return renderWithProviders(
    <OrganizationStep
      details={{ organization: null, formats: null }}
      back={null}
      onDone={async () => undefined}
      refresh={async () => undefined}
    />,
  );
}

describe("the organization step", () => {
  it("proposes formats for the language and time zone until they are chosen", async () => {
    const { requests } = mockApi({
      "POST /api/v1/setup/steps/organization/save": () => ({
        body: { organizationId: "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f" },
      }),
    });
    await renderStep();
    expect(screen.getByRole("combobox", { name: "Date format" }).textContent).toContain("DD/MM/YYYY");

    await userEvent.click(screen.getByRole("combobox", { name: "Default language" }));
    await userEvent.click(await screen.findByRole("option", { name: "Deutsch" }));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Date format" }).textContent).toContain("DD.MM.YYYY"),
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Date format" }));
    await userEvent.click(await screen.findByRole("option", { name: /^YYYY-MM-DD/ }));
    await userEvent.click(screen.getByRole("combobox", { name: "Default language" }));
    await userEvent.click(await screen.findByRole("option", { name: "English" }));
    expect(screen.getByRole("combobox", { name: "Date format" }).textContent).toContain("YYYY-MM-DD");

    await userEvent.type(screen.getByLabelText("Name"), "Platform Team");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() =>
      expect(
        requests.find((request) => request.path === "/api/v1/setup/steps/organization/save")?.body,
      ).toEqual({
        name: "Platform Team",
        language: "en",
        timeZone: "Europe/Vienna",
        formats: {
          dateFormat: "YYYY-MM-DD",
          timeFormat: "24h",
          numberFormat: "de-DE",
          firstDayOfWeek: "monday",
        },
      }),
    );
  });
});
