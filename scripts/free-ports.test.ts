import assert from "node:assert/strict";
import { createServer } from "node:net";
import { describe, it } from "node:test";
import { isFree, parseRequests, pickPorts } from "./free-ports.ts";

describe("parseRequests", () => {
  it("reads names with an optional span", () => {
    assert.deepEqual(parseRequests(["POSTGRES_PORT", "APP_PORT:3"]), [
      { name: "POSTGRES_PORT", span: 1 },
      { name: "APP_PORT", span: 3 },
    ]);
  });

  it("rejects malformed requests", () => {
    assert.throws(() => parseRequests(["lower"]), /Invalid port request/);
    assert.throws(() => parseRequests(["NAME:0"]), /Invalid port request/);
  });
});

function sequence(values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length] ?? 0;
}

describe("pickPorts", () => {
  it("gives every name its own range", async () => {
    const ports = await pickPorts(
      parseRequests(["A", "B:3", "C"]),
      async () => true,
      sequence([0.1, 0.1, 0.5, 0.9]),
    );
    assert.equal(ports.A, 20_000 + Math.floor(0.1 * 11_999));
    assert.notEqual(ports.B, ports.A);
    assert.equal(new Set(Object.values(ports)).size, 3);
  });

  it("does not hand the same port to two names", async () => {
    const ports = await pickPorts(parseRequests(["A", "B"]), async () => true, sequence([0.3, 0.3, 0.6]));
    assert.notEqual(ports.A, ports.B);
  });

  it("skips ports that are in use", async () => {
    const first = 20_000 + Math.floor(0.2 * 11_999);
    const ports = await pickPorts(parseRequests(["A"]), async (port) => port !== first, sequence([0.2, 0.7]));
    assert.notEqual(ports.A, first);
    assert.equal(ports.A, 20_000 + Math.floor(0.7 * 11_999));
  });

  it("requires every port of a span to be free", async () => {
    const first = 20_000 + Math.floor(0.2 * 11_999);
    const ports = await pickPorts(
      parseRequests(["A:3"]),
      async (port) => port !== first + 2,
      sequence([0.2, 0.7]),
    );
    assert.equal(ports.A, 20_000 + Math.floor(0.7 * 11_997));
  });

  it("fails when nothing is free", async () => {
    await assert.rejects(
      pickPorts(parseRequests(["A"]), async () => false),
      /No free port range/,
    );
  });
});

describe("isFree", () => {
  it("reports a listening port as taken", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    assert.equal(await isFree(port), false);
    await new Promise((resolve) => server.close(resolve));
    assert.equal(await isFree(port), true);
  });
});
