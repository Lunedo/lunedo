import { describe, expect, it } from "vitest";
import { receivedClaims } from "./claims.js";

describe("received claims", () => {
  it("keeps profile claims and leaves out tokens, hashes, nonces and secrets", () => {
    const claims = receivedClaims({
      sub: "42",
      email: "ada@example.org",
      groups: ["a", "b"],
      email_verified: true,
      nonce: "n",
      at_hash: "h",
      c_hash: "h",
      sid: "session",
      refresh_token: "r",
      client_secret: "s",
      address: { street: "Main 1", password: "p" },
    });
    expect(claims).toEqual([
      { name: "address", values: ['{"street":"Main 1"}'] },
      { name: "email", values: ["ada@example.org"] },
      { name: "email_verified", values: ["true"] },
      { name: "groups", values: ["a", "b"] },
      { name: "sub", values: ["42"] },
    ]);
  });

  it("shortens long values and limits the number of values", () => {
    const [claim] = receivedClaims(new Map([["groups", Array.from({ length: 80 }, () => "x".repeat(600))]]));
    expect(claim?.values).toHaveLength(50);
    expect(claim?.values[0]).toHaveLength(501);
  });
});
