import { describe, expect, it } from "vitest";
import { renderImage } from "./rendering.controller.js";

describe("render image", () => {
  it("names the image of the release this instance runs", () => {
    expect(renderImage("1.4.2")).toBe("ghcr.io/lunedo/render:1.4.2");
    expect(renderImage("v1.4.2")).toBe("ghcr.io/lunedo/render:1.4.2");
  });

  it("names no image for a build that is not a release", () => {
    expect(renderImage("dev")).toBeNull();
    expect(renderImage("preview-9a01df58")).toBeNull();
  });
});
