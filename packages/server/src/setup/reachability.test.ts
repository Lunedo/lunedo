import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabaseBaseUrl } from "../testing/database.js";
import { createTestServices, type TestServices } from "../testing/services.js";
import { checkReachability, isLoopbackUrl, PROBE_PATH, probeAnswer } from "./reachability.js";

const baseUrl = testDatabaseBaseUrl();

describe.skipIf(!baseUrl)("the reachability check", () => {
  let test: TestServices;
  let server: Server;
  let origin: string;
  const hits: string[] = [];

  beforeAll(async () => {
    test = await createTestServices(baseUrl ?? "");
    server = createServer((request, response) => {
      hits.push(request.headers.host ?? "");
      const challenge = (request.url ?? "").slice(PROBE_PATH.length);
      probeAnswer(test.database, challenge).then(
        (answer) => {
          response.writeHead(answer ? 200 : 404, { "content-type": "application/json" });
          response.end(JSON.stringify(answer ? { answer } : {}));
        },
        () => {
          response.writeHead(500);
          response.end();
        },
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server?.close(resolve));
    await test?.close();
  });

  it("reaches this instance through the address with a plain request", async () => {
    const address = `http://wiki.example:${(server.address() as AddressInfo).port}`;
    expect(
      await checkReachability(test.database, address, { resolve: async () => ["127.0.0.1"] }),
    ).toMatchObject({ status: "ok", cause: null, url: address });
  });

  it("reports a loopback address as local without probing it", async () => {
    hits.length = 0;
    for (const address of [origin, "http://localhost:8080", "http://[::1]:8080", "http://127.8.0.1"]) {
      expect(await checkReachability(test.database, address)).toMatchObject({
        status: "info",
        cause: "loopback",
        url: address,
      });
    }
    expect(hits).toEqual([]);
  });

  it("connects to the address the lookup allowed and never to a link-local one", async () => {
    const port = (server.address() as AddressInfo).port;
    hits.length = 0;
    expect(
      await checkReachability(test.database, `http://wiki.example:${port}`, {
        resolve: async () => ["127.0.0.1"],
      }),
    ).toMatchObject({ cause: null });
    expect(hits).toEqual([`wiki.example:${port}`]);

    hits.length = 0;
    let lookups = 0;
    const rebinding = async () => (++lookups === 1 ? ["127.0.0.1"] : ["169.254.169.254"]);
    expect(
      await checkReachability(test.database, `http://wiki.example:${port}`, { resolve: rebinding }),
    ).toMatchObject({
      cause: "unreachable",
    });
    expect(hits).toEqual([]);
    expect(lookups).toBe(2);
  });
});

describe("loopback addresses", () => {
  it("cover localhost, 127.0.0.0/8 and ::1 only", () => {
    expect(isLoopbackUrl("http://localhost:8080")).toBe(true);
    expect(isLoopbackUrl("http://wiki.localhost")).toBe(true);
    expect(isLoopbackUrl("http://127.0.0.1")).toBe(true);
    expect(isLoopbackUrl("http://127.255.0.9:3000")).toBe(true);
    expect(isLoopbackUrl("http://[::1]:8080")).toBe(true);
    expect(isLoopbackUrl("https://wiki.example")).toBe(false);
    expect(isLoopbackUrl("http://128.0.0.1")).toBe(false);
    expect(isLoopbackUrl("http://10.0.0.1")).toBe(false);
    expect(isLoopbackUrl("not a url")).toBe(false);
  });
});
