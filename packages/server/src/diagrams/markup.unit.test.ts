import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import { DiagramRejectedError, sanitizeDrawio } from "./drawio.js";
import { SanitizerBusyError, SanitizerSlots, takeMarkup } from "./markup.js";

const ALICE = accountPrincipal("alice");
const BOB = accountPrincipal("bob");
const CAROL = accountPrincipal("carol");

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

  it("is an upper bound because the parsers refuse attributes without quoted values", () => {
    for (const input of [
      "<mxfile><mxCell x=1/></mxfile>",
      "<mxfile><mxCell x/></mxfile>",
      '<mxfile><mxCell x="1"y="2"/></mxfile>',
    ]) {
      expect(() => sanitizeDrawio(input), input).toThrow(DiagramRejectedError);
    }
  });
});

describe("sanitizer slots", () => {
  function held(slots: SanitizerSlots, owner = ALICE) {
    let release: () => void = () => {};
    const done = slots.run(owner, () => new Promise<string>((resolve) => (release = () => resolve("held"))));
    return { done, release: () => release() };
  }

  it("refuses work beyond the limit of the node and frees the slot afterwards", async () => {
    const slots = new SanitizerSlots(2, 1);
    const first = held(slots, ALICE);
    const second = held(slots, BOB);
    const body = new PassThrough();
    await expect(slots.run(CAROL, () => "refused", body)).rejects.toBeInstanceOf(SanitizerBusyError);
    expect(body.readableFlowing).toBe(true);
    first.release();
    second.release();
    expect(await Promise.all([first.done, second.done])).toEqual(["held", "held"]);
    expect(await slots.run(CAROL, () => "next")).toBe("next");
  });

  it("lets one account hold only its own share of the slots", async () => {
    const slots = new SanitizerSlots(4, 1);
    const first = held(slots, ALICE);
    await expect(slots.run(ALICE, () => "second")).rejects.toBeInstanceOf(SanitizerBusyError);
    expect(await slots.run(BOB, () => "other account")).toBe("other account");
    first.release();
    await first.done;
    expect(await slots.run(ALICE, () => "again")).toBe("again");
  });

  it("frees the slot when the work fails", async () => {
    const slots = new SanitizerSlots(1, 1);
    await expect(
      slots.run(ALICE, () => {
        throw new Error("broken");
      }),
    ).rejects.toThrow("broken");
    expect(await slots.run(ALICE, () => "next")).toBe("next");
  });
});
