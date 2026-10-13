import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../testing/render.js";
import { SettingsSearchField } from "./settings-search.js";

const FITS_THE_SIDEBAR = 24;

describe("the settings search field", () => {
  it.each(["en", "de"])("has a placeholder that fits the narrow sidebar in %s", async (language) => {
    await renderWithProviders(<SettingsSearchField value="" onChange={() => undefined} />, language);
    const field = screen.getByRole("searchbox");
    expect((field.getAttribute("placeholder") ?? "").length).toBeLessThanOrEqual(FITS_THE_SIDEBAR);
    expect(field.getAttribute("placeholder")).not.toBe("");
  });
});
