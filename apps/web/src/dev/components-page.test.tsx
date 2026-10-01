import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ComponentsPage, { optionsFromSearch } from "./components-page.js";

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

describe("optionsFromSearch", () => {
  it("reads mode, contrast, size, density, font, accent and overlay", () => {
    expect(
      optionsFromSearch(
        "?mode=dark&contrast=high&size=1.25&density=compact&font=readable&accent=violet&overlay=palette",
      ),
    ).toEqual({
      appearance: {
        colorMode: "dark",
        highContrast: true,
        textSize: 1.25,
        density: "compact",
        font: "readable",
        accent: "violet",
      },
      overlay: "palette",
      language: "en",
    });
  });

  it("falls back to the defaults for unknown values", () => {
    expect(optionsFromSearch("?mode=blue&size=3&accent=pink&overlay=window")).toEqual({
      appearance: {
        colorMode: "system",
        highContrast: false,
        textSize: 1,
        density: "default",
        font: "default",
        accent: null,
      },
      overlay: null,
      language: "en",
    });
  });
});

describe("ComponentsPage", () => {
  it("renders every component group and applies the appearance", () => {
    render(<ComponentsPage search="?mode=dark&size=0.875&density=compact" />);
    expect(screen.getByRole("heading", { level: 1, name: "Components" })).toBeDefined();
    for (const group of [
      "Buttons",
      "Badges, avatars and indicators",
      "Form controls",
      "Notices, empty states and skeletons",
      "Tabs, tables and lists",
      "Page layout",
      "Navigation",
      "Overlays",
    ]) {
      expect(screen.getByRole("region", { name: group })).toBeDefined();
    }
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.density).toBe("compact");
    expect(document.documentElement.style.getPropertyValue("--ph-text-scale")).toBe("0.875");
  });

  it("reads the language and shows the page in German", () => {
    expect(optionsFromSearch("?lang=de").language).toBe("de");
    render(<ComponentsPage search="?lang=de&mode=light" />);
    expect(screen.getByRole("heading", { level: 1, name: "Komponenten" })).toBeDefined();
    expect(screen.getByRole("region", { name: "Eingabeelemente" })).toBeDefined();
    expect(screen.getByRole("group", { name: "Textgröße" })).toBeDefined();
    expect(screen.getAllByRole("button", { name: "Erhöhen" }).length).toBeGreaterThan(0);
    expect(document.documentElement.lang).toBe("de");
  });

  it("opens an overlay named in the address", () => {
    render(<ComponentsPage search="?overlay=dialog" />);
    expect(screen.getByRole("dialog", { name: "Invite people" })).toBeDefined();
  });
});
