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
      completed={false}
      details={{ organization: null, formats: null }}
      back={null}
      onDone={async () => undefined}
      refresh={async () => undefined}
    />,
  );
}

describe("the organization step", () => {
  it("keeps the formats when the language changes", async () => {
    const { requests } = mockApi({
      "POST /api/v1/setup/steps/organization/save": () => ({
        body: { organizationId: "01929b1e-6f2a-7c3d-8e9f-0a1b2c3d4e5f" },
      }),
    });
    await renderStep();
    expect(screen.queryByRole("combobox", { name: "Date format" })).toBeNull();
    const formats = screen.getByRole("button", {
      name: /^Adjust the formats \(proposed: \d{1,2} \w{3} \d{4} · 14:30 · 1,234\.56 · Monday\)$/,
    });
    expect(formats.getAttribute("aria-expanded")).toBe("false");
    expect((screen.getByRole("combobox", { name: "Default time zone" }) as HTMLInputElement).value).toMatch(
      /^Europe\/Vienna \(UTC\+[12]\)$/,
    );
    await userEvent.click(formats);
    expect(screen.getByRole("combobox", { name: "Date format" }).textContent).toMatch(
      /^\d{1,2} \w{3} \d{4}$/,
    );
    expect(screen.getByRole("combobox", { name: "Time format" }).textContent).toBe("14:30");

    await userEvent.click(screen.getByRole("combobox", { name: "Default language" }));
    await userEvent.click(await screen.findByRole("option", { name: "Deutsch" }));
    expect(screen.getByRole("combobox", { name: "Date format" }).textContent).toMatch(
      /^\d{1,2} \w{3} \d{4}$/,
    );

    await userEvent.click(screen.getByRole("combobox", { name: "Date format" }));
    await userEvent.click(await screen.findByRole("option", { name: /^\d{4}-\d{2}-\d{2}$/ }));
    await userEvent.click(screen.getByRole("combobox", { name: "Default language" }));
    await userEvent.click(await screen.findByRole("option", { name: "English" }));
    expect(screen.getByRole("combobox", { name: "Date format" }).textContent).toMatch(/^\d{4}-\d{2}-\d{2}$/);

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
          numberFormat: "en-US",
          firstDayOfWeek: "monday",
        },
      }),
    );
  }, 15_000);
});
