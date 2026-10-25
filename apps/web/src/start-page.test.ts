import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supportedLanguages } from "./i18n/index.js";

const html = readFileSync(path.resolve("index.html"), "utf8");
const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
const shell = /<div id="boot-shell"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/.exec(html)?.[0] ?? "";

function start(pathname: string, stored: Record<string, string> = {}, prefersDark = false) {
  window.history.replaceState(null, "", pathname);
  for (const [key, value] of Object.entries(stored)) localStorage.setItem(key, value);
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches: prefersDark && query.includes("dark") })),
  );
  document.body.innerHTML = shell;
  new Function(script)();
  return document.getElementById("boot-shell") as HTMLElement;
}

describe("the start page", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-contrast");
    document.documentElement.style.cssText = "";
    for (const link of document.head.querySelectorAll("link[rel=modulepreload]")) link.remove();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("knows the same languages as the application", () => {
    expect(/var languages = (\[[^\]]*\]);/.exec(script)?.[1]).toBe(
      JSON.stringify(supportedLanguages).replaceAll(",", ", "),
    );
  });

  it("applies the remembered appearance and language before the application starts", () => {
    start("/home", {
      "lunedo.appearance": JSON.stringify({ colorMode: "dark", highContrast: true, textSize: 1.25 }),
      "lunedo.language": "de",
    });
    const root = document.documentElement;
    expect(root.dataset.theme).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");
    expect(root.dataset.contrast).toBe("high");
    expect(root.style.getPropertyValue("--ld-text-scale")).toBe("1.25");
    expect(root.lang).toBe("de");
  });

  it("follows the system when no appearance is remembered", () => {
    start("/home", {}, true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    start("/home", { "lunedo.appearance": JSON.stringify({ colorMode: "light" }) }, true);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("survives a damaged remembered appearance", () => {
    start("/home", { "lunedo.appearance": "{not json" });
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("shows the outline of the shell on signed-in screens only", () => {
    expect(start("/home").hidden).toBe(false);
    expect(start("/spaces/IT/pages/1/x").hidden).toBe(false);
    expect(start("/settings/profile").hidden).toBe(false);
    for (const pathname of [
      "/sign-in",
      "/sign-in/verify",
      "/setup",
      "/reset-password",
      "/accept-invitation",
      "/s/abc",
      "/print",
    ]) {
      expect(start(pathname).hidden, pathname).toBe(true);
    }
  });

  it("draws the narrow sidebar when the person keeps it collapsed", () => {
    start("/home", { "lunedo.appearance": JSON.stringify({ sidebarCollapsed: true }) });
    expect(document.getElementById("boot-sidebar")?.className).toContain("w-rail");
  });
});
