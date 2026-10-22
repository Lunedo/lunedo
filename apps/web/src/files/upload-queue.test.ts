import { describe, expect, it } from "vitest";
import { ApiError } from "../api/request.js";
import { BUSY_RETRIES, uploadQueue } from "./upload-queue.js";

function busy(): ApiError {
  return new ApiError(503, {
    type: "urn:lunedo:problem:busy",
    title: "The server is busy",
    status: 503,
    code: "busy",
    retryAfterSeconds: 2,
  });
}

const file = (name: string) => new File(["x"], name, { type: "image/png" });

describe("upload queue", () => {
  it("uploads one file after the other and keeps the order", async () => {
    let running = 0;
    let most = 0;
    const done: string[] = [];
    const queue = uploadQueue(async (upload: File) => {
      running += 1;
      most = Math.max(most, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      done.push(upload.name);
      return upload.name;
    });
    const names = Array.from({ length: 10 }, (_, index) => `image-${index}.png`);
    expect(await Promise.all(names.map((name) => queue(file(name))))).toEqual(names);
    expect(most).toBe(1);
    expect(done).toEqual(names);
  });

  it("waits the time the server asks for and tries again while it is busy", async () => {
    const waits: number[] = [];
    let calls = 0;
    const queue = uploadQueue(
      async () => {
        calls += 1;
        if (calls < 3) throw busy();
        return "stored";
      },
      async (milliseconds) => {
        waits.push(milliseconds);
      },
    );
    expect(await queue(file("a.png"))).toBe("stored");
    expect(waits).toEqual([2000, 2000]);
  });

  it("gives up after a few busy answers and goes on with the next file", async () => {
    const queue = uploadQueue(
      async (upload: File) => {
        if (upload.name === "a.png") throw busy();
        return upload.name;
      },
      async () => {},
    );
    const first = queue(file("a.png"));
    const second = queue(file("b.png"));
    await expect(first).rejects.toBeInstanceOf(ApiError);
    expect(await second).toBe("b.png");
    expect(BUSY_RETRIES).toBeGreaterThan(0);
  });
});
