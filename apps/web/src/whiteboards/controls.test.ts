import { describe, expect, it } from "vitest";
import { nameUnlabeledControls } from "./controls.js";

describe("whiteboard controls", () => {
  it("give unnamed buttons around the canvas an accessible name", () => {
    const container = document.createElement("div");
    container.innerHTML = [
      '<button class="main-menu-trigger"><svg></svg></button>',
      '<button title="Lock — Q"><svg></svg></button>',
      '<button aria-label="Zoom in"><svg></svg></button>',
      "<button>Sticky note</button>",
    ].join("");
    nameUnlabeledControls(container, "Whiteboard menu");
    const names = [...container.querySelectorAll("button")].map((button) =>
      button.getAttribute("aria-label"),
    );
    expect(names).toEqual(["Whiteboard menu", "Lock", "Zoom in", null]);
  });
});
