import { describe, expect, it } from "vitest";
import { diagramFile, diagramPositions } from "./diagram-files.js";

const FIRST = "0a1c7905-2312-4c79-81cf-65b67e4d9709";
const SECOND = "1b2d8016-3423-4d8a-92d0-76c78f5e0810";

describe("diagram files", () => {
  it("recognize the files a diagram block stores and leave other files alone", () => {
    expect(diagramFile(`drawio-${FIRST}.drawio`)).toEqual({ kind: "drawio", blockId: FIRST, part: "source" });
    expect(diagramFile(`drawio-${FIRST}.svg`)).toEqual({ kind: "drawio", blockId: FIRST, part: "image" });
    expect(diagramFile(`drawing-${FIRST}.excalidraw`)?.kind).toBe("drawing");
    expect(diagramFile("drawio-notes.drawio")).toBeNull();
    expect(diagramFile("network.png")).toBeNull();
  });

  it("number diagrams in the order they appear on the page", () => {
    const root = document.createElement("div");
    root.innerHTML = `<figure data-diagram="drawio" data-diagram-id="${SECOND}"></figure><figure data-diagram="drawio" data-diagram-id="${FIRST}"></figure>`;
    const positions = diagramPositions(
      [
        { kind: "drawio", blockId: FIRST },
        { kind: "drawio", blockId: SECOND },
      ],
      root,
    );
    expect(positions.get(SECOND)).toBe(1);
    expect(positions.get(FIRST)).toBe(2);
  });
});
