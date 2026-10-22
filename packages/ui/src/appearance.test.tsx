import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Appearance, applyAppearance, useAppearance } from "./appearance.js";

const defaults: Appearance = {
  colorMode: "system",
  highContrast: false,
  textSize: 1,
  density: "default",
  font: "default",
  accent: null,
};

function mockSystem(dark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: dark,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal("matchMedia", () => query as unknown as MediaQueryList);
  return {
    change(next: boolean) {
      query.matches = next;
      for (const listener of listeners) listener();
    },
  };
}

function Probe({ appearance }: { appearance: Appearance }) {
  useAppearance(appearance);
  return null;
}

afterEach(() => {
  const root = document.documentElement;
  for (const name of ["data-theme", "data-contrast", "data-density", "data-font", "data-accent", "style"]) {
    root.removeAttribute(name);
  }
});

describe("applyAppearance", () => {
  it("sets every attribute the theme reads", () => {
    const root = document.createElement("html");
    applyAppearance(
      root,
      {
        colorMode: "dark",
        highContrast: true,
        textSize: 1.25,
        density: "compact",
        font: "readable",
        accent: "violet",
      },
      false,
    );
    expect(root.dataset.theme).toBe("dark");
    expect(root.dataset.contrast).toBe("high");
    expect(root.dataset.density).toBe("compact");
    expect(root.dataset.font).toBe("readable");
    expect(root.dataset.accent).toBe("violet");
    expect(root.style.getPropertyValue("--ld-text-scale")).toBe("1.25");
  });

  it("removes attributes for the defaults", () => {
    const root = document.createElement("html");
    applyAppearance(root, { ...defaults, highContrast: true, density: "compact", accent: "red" }, false);
    applyAppearance(root, { ...defaults, accent: "petrol" }, true);
    expect(root.dataset.theme).toBe("dark");
    for (const name of ["contrast", "density", "font", "accent"]) expect(root.dataset[name]).toBeUndefined();
    expect(root.style.getPropertyValue("--ld-text-scale")).toBe("1");
  });
});

describe("useAppearance", () => {
  it("follows the system color mode while set to automatic", () => {
    const system = mockSystem(false);
    render(<Probe appearance={defaults} />);
    expect(document.documentElement.dataset.theme).toBe("light");
    act(() => system.change(true));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("applies changed preferences at once", () => {
    mockSystem(false);
    const { rerender } = render(<Probe appearance={defaults} />);
    rerender(<Probe appearance={{ ...defaults, colorMode: "dark", textSize: 0.875 }} />);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--ld-text-scale")).toBe("0.875");
  });
});
