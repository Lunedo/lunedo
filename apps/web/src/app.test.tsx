import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./app.js";
import { initI18n } from "./i18n/index.js";

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

describe("App", () => {
  it("shows the rail with the logo and all navigation items", async () => {
    await initI18n(["en"]);
    render(<App />);

    const rail = screen.getByRole("navigation", { name: "Main navigation" });
    expect(rail).toBeDefined();
    expect(screen.getByRole("link", { name: "Pagehall home" })).toBeDefined();
    for (const name of [
      "Create",
      "For you",
      "Search",
      "Starred",
      "Spaces",
      "Projects",
      "Notifications",
      "Help",
      "Settings",
      "Account",
    ]) {
      expect(screen.getByRole("button", { name })).toBeDefined();
    }
    expect(screen.getByRole("main")).toBeDefined();
  });

  it("uses German labels for German browsers", async () => {
    await initI18n(["de-DE"]);
    render(<App />);
    expect(screen.getByRole("navigation", { name: "Hauptnavigation" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Einstellungen" })).toBeDefined();
  });

  it("applies the system color mode", async () => {
    await initI18n(["en"]);
    render(<App />);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
