import { describe, expect, it } from "vitest";
import { markScrollEdges } from "./scroll-edges.js";

function scroller(scrollWidth: number, clientWidth: number): HTMLElement {
  const element = document.createElement("div");
  element.className = "ld-roadmap-scroll";
  Object.defineProperty(element, "scrollWidth", { value: scrollWidth });
  Object.defineProperty(element, "clientWidth", { value: clientWidth });
  return element;
}

describe("scroll edges", () => {
  it("mark a roadmap that is cut off and make it reachable by keyboard", () => {
    const root = document.createElement("div");
    const wide = scroller(960, 696);
    const narrow = scroller(400, 696);
    root.append(wide, narrow);
    const stop = markScrollEdges(root, "Roadmap, scrolls sideways");
    expect(wide.hasAttribute("data-overflow-end")).toBe(true);
    expect(wide.hasAttribute("data-overflow-start")).toBe(false);
    expect(wide.getAttribute("tabindex")).toBe("0");
    expect(wide.getAttribute("aria-label")).toBe("Roadmap, scrolls sideways");
    expect(narrow.hasAttribute("data-overflow-end")).toBe(false);
    expect(narrow.hasAttribute("tabindex")).toBe(false);
    wide.scrollLeft = 264;
    wide.dispatchEvent(new Event("scroll"));
    expect(wide.hasAttribute("data-overflow-start")).toBe(true);
    stop();
  });
});
