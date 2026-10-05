import { act, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScrollArea, scrollEdges } from "./scroll-area.js";
import { renderUi } from "./testing/render.js";

function sized(
  element: HTMLElement,
  sizes: { scrollWidth: number; clientWidth: number; scrollLeft: number },
) {
  for (const [key, value] of Object.entries(sizes)) {
    Object.defineProperty(element, key, { configurable: true, writable: true, value });
  }
}

describe("scrollEdges", () => {
  it("reports no edge when everything fits", () => {
    const element = document.createElement("div");
    sized(element, { scrollWidth: 300, clientWidth: 300, scrollLeft: 0 });
    expect(scrollEdges(element)).toEqual({ start: false, end: false });
  });

  it("reports hidden content at the end, then at both sides, then at the start", () => {
    const element = document.createElement("div");
    sized(element, { scrollWidth: 500, clientWidth: 300, scrollLeft: 0 });
    expect(scrollEdges(element)).toEqual({ start: false, end: true });
    element.scrollLeft = 100;
    expect(scrollEdges(element)).toEqual({ start: true, end: true });
    element.scrollLeft = 200;
    expect(scrollEdges(element)).toEqual({ start: true, end: false });
  });
});

describe("ScrollArea", () => {
  it("shows a fade where content is hidden and makes the region reachable by keyboard", () => {
    renderUi(
      <ScrollArea label="Accounts">
        <p>Wide content</p>
      </ScrollArea>,
    );
    const scroller = screen.getByText("Wide content").parentElement as HTMLElement;
    const area = scroller.parentElement as HTMLElement;
    expect(area.hasAttribute("data-overflow-end")).toBe(false);
    sized(scroller, { scrollWidth: 800, clientWidth: 300, scrollLeft: 0 });
    act(() => {
      scroller.dispatchEvent(new Event("scroll"));
    });
    expect(area.hasAttribute("data-overflow-end")).toBe(true);
    expect(area.hasAttribute("data-overflow-start")).toBe(false);
    expect(screen.getByRole("region", { name: "Accounts" }).tabIndex).toBe(0);
    expect(area.querySelectorAll("span[aria-hidden=true]")).toHaveLength(1);
    scroller.scrollLeft = 500;
    act(() => {
      scroller.dispatchEvent(new Event("scroll"));
    });
    expect(area.hasAttribute("data-overflow-start")).toBe(true);
    expect(area.hasAttribute("data-overflow-end")).toBe(false);
  });
});
