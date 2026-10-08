import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatReport, latestRelease, pinnedVersion } from "./sheetjs-release.ts";

describe("pinnedVersion", () => {
  it("reads the version from the official tarball URL", () => {
    assert.equal(pinnedVersion("https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"), "0.20.3");
  });

  it("finds nothing for a registry version or a mismatched URL", () => {
    assert.equal(pinnedVersion("^0.18.5"), null);
    assert.equal(pinnedVersion("https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.2.tgz"), null);
    assert.equal(pinnedVersion(undefined), null);
  });
});

describe("latestRelease", () => {
  it("picks the highest release regardless of order and ignores other tags", () => {
    const tags = [{ name: "v0.9.13" }, { name: "v0.20.3" }, { name: "v0.20.10" }, { name: "beta" }, {}];
    assert.equal(latestRelease(tags), "0.20.10");
  });

  it("returns nothing without release tags", () => {
    assert.equal(latestRelease([{ name: "nightly" }]), null);
  });
});

describe("formatReport", () => {
  it("reports a newer release", () => {
    assert.match(formatReport("0.20.3", "0.21.0"), /SheetJS 0\.21\.0 is available; Pagehall pins 0\.20\.3/);
  });

  it("says when the pinned version is current", () => {
    assert.match(formatReport("0.20.3", "0.20.3"), /is the latest release/);
  });

  it("says when a version could not be read", () => {
    assert.match(formatReport(null, "0.20.3"), /was not found/);
    assert.match(formatReport("0.20.3", null), /could not be read/);
  });
});
