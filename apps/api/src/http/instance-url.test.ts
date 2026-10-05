import { afterEach, describe, expect, it } from "vitest";
import { createTestApp } from "../testing/create-test-app.js";

const PUBLIC_URL = "https://pagehall-test.example.org";

describe("the configured instance URL", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  async function post(origin: string, headers: Record<string, string> = {}) {
    const app = await createTestApp({ configuredInstanceUrl: PUBLIC_URL, trustedProxies: ["127.0.0.1"] });
    close = () => app.close();
    return app.inject({
      method: "POST",
      url: "/api/v1/unknown",
      headers: { "x-pagehall-request": "1", origin, ...headers },
    });
  }

  it("accepts state-changing requests from the instance URL before the setup stores it", async () => {
    const response = await post(PUBLIC_URL);
    expect(response.statusCode).toBe(404);
  });

  it("refuses other origins", async () => {
    const response = await post("https://attacker.example");
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "csrfRejected" });
  });

  it("refuses a page served under another address and names the current one, also behind a trusted proxy", async () => {
    const response = await post("https://old.example.org", {
      "x-forwarded-host": "old.example.org",
      "x-forwarded-proto": "https",
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "instanceMoved", instanceUrl: PUBLIC_URL });
  });

  it("does not name the address to requests without the request header", async () => {
    const app = await createTestApp({ configuredInstanceUrl: PUBLIC_URL, trustedProxies: ["127.0.0.1"] });
    close = () => app.close();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/unknown",
      headers: {
        origin: "https://old.example.org",
        "x-forwarded-host": "old.example.org",
        "x-forwarded-proto": "https",
      },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "csrfRejected" });
  });
});
