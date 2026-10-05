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

  it("refuses other origins, also when a trusted proxy forwards them", async () => {
    const response = await post("https://attacker.example", {
      "x-forwarded-host": "attacker.example",
      "x-forwarded-proto": "https",
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: "csrfRejected" });
  });
});
