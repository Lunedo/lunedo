import { describe, expect, it } from "vitest";
import { describeUserAgent } from "./user-agent.js";

describe("describeUserAgent", () => {
  it("names common browsers and systems", () => {
    expect(
      describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0"),
    ).toEqual({ browser: "Firefox 131", system: "Windows" });
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
      ),
    ).toEqual({ browser: "Edge 129", system: "macOS" });
    expect(
      describeUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      ),
    ).toEqual({ browser: "Safari 18", system: "iOS" });
    expect(describeUserAgent("curl/8.9.1")).toEqual({ browser: "curl 8", system: null });
    expect(describeUserAgent("something else")).toEqual({ browser: null, system: null });
  });
});
