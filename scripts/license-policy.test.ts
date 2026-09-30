import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isApprovedLicense } from "./license-policy.ts";

describe("isApprovedLicense", () => {
  it("accepts approved licenses", () => {
    for (const license of ["MIT", "Apache-2.0", "BSD-3-Clause", "ISC", "OFL-1.1", "MPL-2.0"]) {
      assert.equal(isApprovedLicense(license), true, license);
    }
  });

  it("rejects licenses that are not OSI-approved", () => {
    for (const license of ["CC0-1.0", "CC-BY-4.0", "BUSL-1.1", "SSPL-1.0", "UNKNOWN", "UNLICENSED", ""]) {
      assert.equal(isApprovedLicense(license), false, license);
    }
  });

  it("accepts a choice when one option is approved", () => {
    assert.equal(isApprovedLicense("MIT OR Apache-2.0"), true);
    assert.equal(isApprovedLicense("(BUSL-1.1 OR MIT)"), true);
  });

  it("requires every part of a combination to be approved", () => {
    assert.equal(isApprovedLicense("(MIT AND Zlib)"), true);
    assert.equal(isApprovedLicense("MIT AND CC-BY-4.0"), false);
  });

  it("handles exceptions and precedence", () => {
    assert.equal(isApprovedLicense("Apache-2.0 WITH LLVM-exception"), true);
    assert.equal(isApprovedLicense("CC0-1.0 OR MIT AND Zlib"), true);
    assert.equal(isApprovedLicense("(CC0-1.0 OR MIT) AND CC-BY-4.0"), false);
  });

  it("rejects malformed expressions", () => {
    assert.equal(isApprovedLicense("(MIT OR"), false);
    assert.equal(isApprovedLicense("MIT Apache-2.0"), false);
    assert.equal(isApprovedLicense("OR MIT"), false);
  });
});
