import { describe, expect, it } from "vitest";
import { checkBrandColor, contrastRatio, normalizeHex, proposeBrandColor } from "./brand-colors.js";

const light = { background: "#FFFFFF", onBrand: "#FFFFFF" };
const dark = { background: "#151617", onBrand: "#0E1415" };

describe("brand colors", () => {
  it("normalizes color values", () => {
    expect(normalizeHex("#0b6f78")).toBe("#0B6F78");
    expect(normalizeHex("0b6f78")).toBe("#0B6F78");
    expect(normalizeHex("#abc")).toBe("#AABBCC");
    expect(normalizeHex("teal")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
  });

  it("computes WCAG contrast ratios", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    expect(contrastRatio("#767676", "#FFFFFF")).toBeCloseTo(4.54, 2);
  });

  it("accepts a passing own color unchanged", () => {
    expect(checkBrandColor("#1F4E99", light).passes).toBe(true);
    expect(proposeBrandColor("#1F4E99", "light", light)).toBe("#1F4E99");
  });

  it("proposes the nearest darker shade in light mode", () => {
    const failing = "#FFB000";
    expect(checkBrandColor(failing, light).passes).toBe(false);
    const proposal = proposeBrandColor(failing, "light", light);
    expect(proposal).not.toBeNull();
    expect(checkBrandColor(proposal ?? "", light).passes).toBe(true);
    expect(contrastRatio(proposal ?? "", "#FFFFFF")).toBeLessThan(5);
  });

  it("proposes the nearest lighter shade in dark mode", () => {
    const failing = "#1F4E99";
    expect(checkBrandColor(failing, dark).passes).toBe(false);
    const proposal = proposeBrandColor(failing, "dark", dark);
    expect(proposal).not.toBeNull();
    expect(checkBrandColor(proposal ?? "", dark).passes).toBe(true);
    expect(contrastRatio(proposal ?? "", "#151617")).toBeLessThan(5);
  });
});
