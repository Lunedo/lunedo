import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type ColorModePreference, resolveColorMode, useColorMode } from "./color-mode.js";

function mockSystemPreference(dark: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: dark,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal("matchMedia", () => query as unknown as MediaQueryList);
  return {
    change(nextDark: boolean) {
      query.matches = nextDark;
      for (const listener of listeners) listener();
    },
  };
}

function Probe({ preference }: { preference: ColorModePreference }) {
  useColorMode(preference);
  return null;
}

describe("resolveColorMode", () => {
  it("uses the explicit preference", () => {
    expect(resolveColorMode("light", true)).toBe("light");
    expect(resolveColorMode("dark", false)).toBe("dark");
  });

  it("follows the system for the system preference", () => {
    expect(resolveColorMode("system", true)).toBe("dark");
    expect(resolveColorMode("system", false)).toBe("light");
  });
});

describe("useColorMode", () => {
  it("applies the system mode and follows changes", () => {
    const system = mockSystemPreference(false);
    render(<Probe preference="system" />);
    expect(document.documentElement.dataset.theme).toBe("light");
    act(() => system.change(true));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("keeps an explicit mode when the system changes", () => {
    const system = mockSystemPreference(true);
    render(<Probe preference="light" />);
    act(() => system.change(false));
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
