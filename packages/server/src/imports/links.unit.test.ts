import { describe, expect, it } from "vitest";
import { decodeTinyLink, parseConfluenceLink, tinyLinkCode } from "./links.js";

describe("old Confluence links", () => {
  it.each([
    ["https://example.atlassian.net/wiki/spaces/OPS/pages/123456/Backup+rotation", "123456"],
    ["https://example.atlassian.net/wiki/spaces/OPS/pages/edit-v2/123456", "123456"],
    ["https://wiki.example.org/pages/viewpage.action?pageId=987654", "987654"],
    ["https://wiki.example.org/confluence/pages/viewpage.action?spaceKey=OPS&pageId=42#section", "42"],
    ["/pages/viewpage.action?pageId=42", "42"],
    ["https://example.atlassian.net/wiki/spaces/OPS/blog/2024/01/02/555/Release+notes", "555"],
    ["https://example.atlassian.net/wiki/spaces/OPS/blog/555", "555"],
  ])("reads the page ID from %s", (url, pageId) => {
    expect(parseConfluenceLink(url)).toEqual({ kind: "id", pageId });
  });

  it.each([
    ["https://wiki.example.org/display/OPS/Backup+rotation", "OPS", "Backup rotation", false],
    ["https://wiki.example.org/confluence/display/OPS/Caf%C3%A9+%26+more", "OPS", "Café & more", false],
    ["/display/OPS/2024/01/02/Release+notes", "OPS", "Release notes", true],
  ])("reads space key and title from %s", (url, spaceKey, title, blog) => {
    expect(parseConfluenceLink(url)).toEqual({ kind: "title", spaceKey, title, blog });
  });

  it("decodes short links that encode the page ID", () => {
    for (const id of ["1", "65537", "123456789", "4294967297", "98765432101"]) {
      const code = tinyLinkCode(id);
      expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(decodeTinyLink(code)).toBe(id);
      expect(parseConfluenceLink(`https://wiki.example.org/x/${code}`)).toEqual({ kind: "id", pageId: id });
      expect(parseConfluenceLink(`https://example.atlassian.net/wiki/x/${code}`)).toEqual({
        kind: "id",
        pageId: id,
      });
    }
    expect(tinyLinkCode("1")).toBe("AQ");
  });

  it.each([
    "",
    "not a link at all",
    "https://wiki.example.org/display/OPS",
    "https://wiki.example.org/x/",
    "https://wiki.example.org/x/AAAAAAAAAAAAAA",
    "https://wiki.example.org/pages/viewpage.action?pageId=abc",
    "https://wiki.example.org/spaces/OPS/overview",
    `https://wiki.example.org/display/OPS/${"a".repeat(2100)}`,
  ])("rejects %s", (url) => {
    expect(parseConfluenceLink(url)).toBeNull();
  });
});
