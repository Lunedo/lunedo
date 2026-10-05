import { afterEach, describe, expect, it, vi } from "vitest";

const TOKEN = "k".repeat(43);

afterEach(() => {
  window.history.replaceState(null, "", "/");
  sessionStorage.clear();
});

async function freshModule() {
  vi.resetModules();
  return import("./link-token.js");
}

describe("link tokens", () => {
  it("removes the token from the address and keeps it for a reload of the same page", async () => {
    window.history.replaceState(null, "", `/accept-invitation#token=${TOKEN}`);
    expect((await freshModule()).captureLinkToken()).toBe(TOKEN);
    expect(window.location.hash).toBe("");

    const reloaded = await freshModule();
    expect(reloaded.captureLinkToken()).toBe(TOKEN);
    window.history.replaceState(null, "", "/reset-password");
    expect(reloaded.captureLinkToken()).toBeNull();
  });

  it("forgets the token once it was used", async () => {
    window.history.replaceState(null, "", `/accept-invitation#token=${TOKEN}`);
    const first = await freshModule();
    first.captureLinkToken();
    first.forgetLinkToken();
    expect((await freshModule()).captureLinkToken()).toBeNull();
  });
});
