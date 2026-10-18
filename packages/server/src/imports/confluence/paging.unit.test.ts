import { describe, expect, it } from "vitest";
import { ListingGuard, MAX_LISTING_PAGES } from "./paging.js";

describe("listing guard", () => {
  function guarded() {
    const stops: { listing: string; reason: string }[] = [];
    const guard = new ListingGuard("/api/v2/pages/1/attachments?limit=25", async (listing, reason) => {
      stops.push({ listing, reason });
    });
    return { guard, stops };
  }

  it("follows new links and ends at the last page without a report", async () => {
    const { guard, stops } = guarded();
    expect(await guard.follow("/api/v2/pages/1/attachments?cursor=a")).toBe(
      "/api/v2/pages/1/attachments?cursor=a",
    );
    expect(await guard.follow(null)).toBeNull();
    expect(stops).toEqual([]);
  });

  it("stops when a next link repeats", async () => {
    const { guard, stops } = guarded();
    await guard.follow("/api/v2/pages/1/attachments?cursor=a");
    await guard.follow("/api/v2/pages/1/attachments?cursor=b");
    expect(await guard.follow("/api/v2/pages/1/attachments?cursor=a")).toBeNull();
    expect(await guard.follow("/api/v2/pages/1/attachments?limit=25")).toBeNull();
    expect(stops).toEqual([
      { listing: "/api/v2/pages/1/attachments", reason: "repeated" },
      { listing: "/api/v2/pages/1/attachments", reason: "repeated" },
    ]);
  });

  it("stops after the maximum number of pages", async () => {
    const { guard, stops } = guarded();
    for (let page = 1; page < MAX_LISTING_PAGES; page += 1) {
      expect(await guard.follow(`/api/v2/pages/1/attachments?cursor=${page}`)).not.toBeNull();
    }
    expect(await guard.follow("/api/v2/pages/1/attachments?cursor=last")).toBeNull();
    expect(stops).toEqual([{ listing: "/api/v2/pages/1/attachments", reason: "limit" }]);
  });
});
