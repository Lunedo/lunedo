import { describe, expect, it } from "vitest";
import { itemAddress } from "./addresses.js";

describe("item addresses", () => {
  it("gives every content kind its own segment with the number and the slug", () => {
    expect(itemAddress("page", "ENG", 1000, "Release Notes")).toBe("/spaces/ENG/pages/1000/release-notes");
    expect(itemAddress("folder", "ENG", 1001, "Guides")).toBe("/spaces/ENG/folders/1001/guides");
    expect(itemAddress("blogPost", "ENG", 1002, "Launch day")).toBe("/spaces/ENG/blog/1002/launch-day");
    expect(itemAddress("whiteboard", "ENG", 1003, "Plan")).toBe("/spaces/ENG/whiteboards/1003/plan");
    expect(itemAddress("meetingSeries", "ENG", 1004, "Weekly")).toBe("/spaces/ENG/meetings/1004/weekly");
    expect(itemAddress("meetingTopic", "ENG", 1005, "Budget")).toBe("/spaces/ENG/topics/1005/budget");
  });

  it("accepts the number as the text a bigint column returns", () => {
    expect(itemAddress("page", "ENG", "1234567", "Overview")).toBe("/spaces/ENG/pages/1234567/overview");
  });

  it("leaves out the slug when the title has no letters or digits", () => {
    expect(itemAddress("page", "ENG", 1000, "!!! ---")).toBe("/spaces/ENG/pages/1000");
    expect(itemAddress("page", "ENG", 1000, "")).toBe("/spaces/ENG/pages/1000");
  });

  it("encodes the space key", () => {
    expect(itemAddress("page", "a/b c", 1000, "Start")).toBe("/spaces/a%2Fb%20c/pages/1000/start");
  });

  it("uses the shared address for pages, blog posts and whiteboards without a space key", () => {
    expect(itemAddress("page", "", 1000, "Start")).toBe("/shared/1000/start");
    expect(itemAddress("blogPost", "", 1001, "News")).toBe("/shared/1001/news");
    expect(itemAddress("whiteboard", "", 1002, "")).toBe("/shared/1002");
    expect(itemAddress("folder", "", 1003, "Guides")).toBeNull();
    expect(itemAddress("meetingSeries", "", 1004, "Weekly")).toBeNull();
    expect(itemAddress("meetingTopic", "", 1005, "Budget")).toBeNull();
  });

  it("gives links and unknown kinds no address", () => {
    expect(itemAddress("link", "ENG", 1000, "Elsewhere")).toBeNull();
    expect(itemAddress("database", "ENG", 1000, "Later")).toBeNull();
    expect(itemAddress("toString", "ENG", 1000, "Prototype")).toBeNull();
    expect(itemAddress("__proto__", "ENG", 1000, "Prototype")).toBeNull();
  });
});
