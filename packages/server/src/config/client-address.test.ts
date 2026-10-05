import { describe, expect, it } from "vitest";
import { clientAddress, trustedProxyList } from "./client-address.js";

describe("clientAddress", () => {
  it("uses the peer when it is not a trusted proxy", () => {
    expect(clientAddress("203.0.113.9", "198.51.100.1", trustedProxyList([]))).toBe("203.0.113.9");
  });

  it("walks the forwarded chain only through trusted proxies", () => {
    const proxies = trustedProxyList(["10.0.0.0/8"], { loopback: true });
    expect(clientAddress("127.0.0.1", "198.51.100.1, 10.1.2.3", proxies)).toBe("198.51.100.1");
    expect(clientAddress("::ffff:10.0.0.5", "203.0.113.7, 198.51.100.1", proxies)).toBe("198.51.100.1");
    expect(clientAddress("127.0.0.1", undefined, proxies)).toBe("127.0.0.1");
    expect(clientAddress(undefined, "198.51.100.1", proxies)).toBe("unknown");
  });
});
