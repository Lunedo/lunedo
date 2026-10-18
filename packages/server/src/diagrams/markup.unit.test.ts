import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { SanitizerBusyError, SanitizerSlots, takeMarkup } from "./markup.js";

describe("takeMarkup", () => {
  it("counts every tag and every quoted attribute value as an upper bound", () => {
    const budget = { elements: 10, attributes: 10 };
    expect(takeMarkup(`<a x="1" y = '2'><!-- = "--><b z="a=b"/></a>`, budget)).toBe(true);
    expect(budget).toEqual({ elements: 6, attributes: 6 });
  });

  it("stops when the budget is used up", () => {
    expect(takeMarkup("<a/><b/>", { elements: 1, attributes: 0 })).toBe(false);
    expect(takeMarkup('<a x="" y=""/>', { elements: 5, attributes: 1 })).toBe(false);
  });
});

describe("sanitizer slots", () => {
  it("refuses work beyond the limit and frees the slot afterwards", async () => {
    const slots = new SanitizerSlots(1);
    let release: () => void = () => {};
    const held = slots.run(() => new Promise<string>((resolve) => (release = () => resolve("first"))));
    const body = new PassThrough();
    await expect(slots.run(() => "second", body)).rejects.toBeInstanceOf(SanitizerBusyError);
    expect(body.readableFlowing).toBe(true);
    release();
    expect(await held).toBe("first");
    expect(await slots.run(() => "third")).toBe("third");
  });

  it("frees the slot when the work fails", async () => {
    const slots = new SanitizerSlots(1);
    await expect(
      slots.run(() => {
        throw new Error("broken");
      }),
    ).rejects.toThrow("broken");
    expect(await slots.run(() => "next")).toBe("next");
  });
});
