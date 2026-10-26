import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../testing/render.js";
import { BrandMark } from "./brand.js";
import { LunedoMark } from "./lunedo-mark.js";

const LOGO = path.resolve("src/assets/logo");
const VARIANTS = ["lunedo-mark", "lunedo-mark-dark", "lunedo-mark-mono-black", "lunedo-mark-mono-white"];

function viewBoxRatio(file: string): number {
  const viewBox = /viewBox="([^"]+)"/.exec(readFileSync(path.join(LOGO, `${file}.svg`), "utf8"))?.[1] ?? "";
  const [, , width = 0, height = 1] = viewBox.split(" ").map(Number);
  return width / height;
}

describe("LunedoMark", () => {
  it("offers the light, dark and both high contrast marks and hides them from assistive technology", () => {
    const { container } = render(<LunedoMark className="h-8" />);
    const mark = container.firstElementChild as HTMLElement;
    expect(mark.className).toBe("lunedo-mark h-8");
    expect(mark.getAttribute("aria-hidden")).toBe("true");
    expect([...mark.querySelectorAll("img")].map((image) => image.dataset.variant)).toEqual([
      "light",
      "dark",
      "mono-black",
      "mono-white",
    ]);
    for (const image of mark.querySelectorAll("img")) expect(image.getAttribute("alt")).toBe("");
  });

  it("shows exactly one variant for every combination of theme and contrast", () => {
    const css = readFileSync(path.join(LOGO, "logo.css"), "utf8");
    expect(css).toContain(
      ':root:not([data-theme="dark"]):not([data-contrast="high"]) .lunedo-mark > [data-variant="light"]',
    );
    expect(css).toContain(
      ':root[data-theme="dark"]:not([data-contrast="high"]) .lunedo-mark > [data-variant="dark"]',
    );
    expect(css).toContain(
      ':root[data-contrast="high"]:not([data-theme="dark"]) .lunedo-mark > [data-variant="mono-black"]',
    );
    expect(css).toContain(
      ':root[data-contrast="high"][data-theme="dark"] .lunedo-mark > [data-variant="mono-white"]',
    );
  });

  it("keeps the proportions of the drawing so a height alone sizes the mark", () => {
    const css = readFileSync(path.join(LOGO, "logo.css"), "utf8");
    const [width = 0, height = 1] = (/aspect-ratio:\s*([\d.]+)\s*\/\s*([\d.]+)/.exec(css) ?? [])
      .slice(1)
      .map(Number);
    for (const variant of VARIANTS) expect(viewBoxRatio(variant)).toBeCloseTo(width / height, 4);
  });

  it("is sized by height everywhere it is used, never squeezed into a square", () => {
    const uses = readdirSync(path.resolve("src"), { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".tsx") && !file.endsWith(".test.tsx"))
      .flatMap((file) => [
        ...readFileSync(path.resolve("src", file), "utf8").matchAll(
          /<LunedoMark\b[^>]*?className="([^"]*)"/g,
        ),
      ]);
    expect(uses.length).toBeGreaterThanOrEqual(5);
    for (const [, className = ""] of uses) {
      expect(className).toMatch(/(?:^|\s)h-/);
      expect(className).not.toMatch(/(?:^|\s)(?:size|w)-/);
    }
  });

  it("shows the product name next to the mark when no organization logo is set", async () => {
    await renderWithProviders(<BrandMark organization={null} />);
    const name = await screen.findByText("Lunedo");
    expect(name.parentElement?.querySelector(".lunedo-mark")).not.toBeNull();
  });
});
