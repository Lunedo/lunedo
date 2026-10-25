import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../testing/render.js";
import { SettingsPending } from "./settings-pending.js";

describe("the settings layout while it loads", () => {
  it("shows the navigation area and a busy content area with placeholder lines at once", async () => {
    await renderWithProviders(<SettingsPending />);
    const main = screen.getByRole("main", { name: "Loading settings" });
    expect(main.getAttribute("aria-busy")).toBe("true");
    expect(main.querySelectorAll("[aria-hidden=true] > *").length).toBeGreaterThan(0);
    expect(main.textContent).toBe("");
  });
});
