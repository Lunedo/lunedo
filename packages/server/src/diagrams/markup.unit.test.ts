import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { accountPrincipal } from "../accounts/principal.js";
import { OwnerSlots } from "../auth/concurrency.js";
import { FileTooLargeError } from "../files/files.js";
import { DiagramRejectedError, sanitizeDrawio } from "./drawio.js";
import {
  MAX_PARALLEL_UPLOADS_PER_ACCOUNT,
  readDrawingUpload,
  readUpload,
  SanitizerBusyError,
  takeMarkup,
  UploadTimeoutError,
} from "./markup.js";

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
  function held(slots: OwnerSlots, owner = ALICE) {
    let release: () => void = () => {};
    const done = slots.run(owner, () => new Promise<string>((resolve) => (release = () => resolve("held"))));
    return { done, release: () => release() };
  }

  it("refuses work beyond the limit of the node and frees the slot afterwards", async () => {
    const slots = new OwnerSlots(2, 1, () => new SanitizerBusyError());
    const first = held(slots, ALICE);
    const second = held(slots, BOB);
    await expect(slots.run(CAROL, () => "refused")).rejects.toBeInstanceOf(SanitizerBusyError);
    first.release();
    second.release();
    expect(await Promise.all([first.done, second.done])).toEqual(["held", "held"]);
    expect(await slots.run(CAROL, () => "next")).toBe("next");
  });

  it("lets one account hold only its own share of the slots", async () => {
    const slots = new OwnerSlots(4, 1, () => new SanitizerBusyError());
    const first = held(slots, ALICE);
    await expect(slots.run(ALICE, () => "second")).rejects.toBeInstanceOf(SanitizerBusyError);
    expect(await slots.run(BOB, () => "other account")).toBe("other account");
    first.release();
    await first.done;
    expect(await slots.run(ALICE, () => "again")).toBe("again");
  });

  it("frees the slot when the work fails", async () => {
    const slots = new OwnerSlots(1, 1, () => new SanitizerBusyError());
    await expect(
      slots.run(ALICE, () => {
        throw new Error("broken");
      }),
    ).rejects.toThrow("broken");
    expect(await slots.run(ALICE, () => "next")).toBe("next");
  });
});

describe("readUpload", () => {
  it("reads the whole body", async () => {
    const body = new PassThrough();
    body.end("<mxfile/>");
    expect((await readUpload(body, 100)).toString("utf8")).toBe("<mxfile/>");
  });

  it("gives up on a body that does not arrive in time", async () => {
    const body = new PassThrough();
    body.write("<mxfile>");
    await expect(readUpload(body, 100, 50)).rejects.toBeInstanceOf(UploadTimeoutError);
    expect(body.destroyed).toBe(true);
  });

  it("refuses a body above the limit", async () => {
    const body = new PassThrough();
    body.end("x".repeat(101));
    await expect(readUpload(body, 100)).rejects.toBeInstanceOf(FileTooLargeError);
  });
});

describe("readDrawingUpload", () => {
  it("refuses more parallel uploads of one account without reading them", async () => {
    const owner = accountPrincipal("uploader");
    const slow = Array.from({ length: MAX_PARALLEL_UPLOADS_PER_ACCOUNT }, () => new PassThrough());
    const reading = slow.map((body) => readDrawingUpload(owner, body, 100));
    const extra = new PassThrough();
    await expect(readDrawingUpload(owner, extra, 100)).rejects.toBeInstanceOf(SanitizerBusyError);
    expect(extra.readableFlowing).toBe(true);
    const other = new PassThrough();
    other.end("<svg/>");
    expect((await readDrawingUpload(BOB, other, 100)).toString("utf8")).toBe("<svg/>");
    for (const body of slow) body.end("<svg/>");
    await Promise.all(reading);
    const again = new PassThrough();
    again.end("<svg/>");
    expect((await readDrawingUpload(owner, again, 100)).toString("utf8")).toBe("<svg/>");
  });
});
