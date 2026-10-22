import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../testing/render.js";
import { BrandMark } from "./brand.js";
import { LunedoMark } from "./lunedo-mark.js";

describe("LunedoMark", () => {
  it("offers the petrol, black and white mark for the themes and hides them from assistive technology", () => {
    const { container } = render(<LunedoMark className="size-8" />);
    const mark = container.firstElementChild as HTMLElement;
    expect(mark.className).toBe("lunedo-mark size-8");
    expect(mark.getAttribute("aria-hidden")).toBe("true");
    expect([...mark.querySelectorAll("img")].map((image) => image.dataset.variant)).toEqual([
      "petrol",
      "black",
      "white",
    ]);
    for (const image of mark.querySelectorAll("img")) expect(image.getAttribute("alt")).toBe("");
  });

  it("shows the product name next to the mark when no organization logo is set", async () => {
    await renderWithProviders(<BrandMark organization={null} />);
    const name = await screen.findByText("Lunedo");
    expect(name.parentElement?.querySelector(".lunedo-mark")).not.toBeNull();
  });
});
