import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findLicenseViolations,
  isApprovedLicense,
  type PackageLicense,
  UNDECLARED_LICENSE,
} from "./license-policy.ts";

describe("isApprovedLicense", () => {
  it("accepts approved licenses", () => {
    for (const license of ["MIT", "Apache-2.0", "BSD-3-Clause", "ISC", "OFL-1.1", "MPL-2.0", "PSF-2.0"]) {
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

describe("findLicenseViolations", () => {
  const pkg = (name: string, license: string): PackageLicense => ({ name, versions: ["1.0.0"], license });
  const data = pkg("mdn-data", "CC0-1.0");
  const entry = { license: "CC0-1.0", reason: "CSS data for the test DOM" };

  it("accepts approved licenses everywhere", () => {
    const react = pkg("react", "MIT");
    assert.deepEqual(findLicenseViolations({ all: [react], production: [react], allowlist: {} }), []);
  });

  it("accepts a shipped package whose declared license is clarified for its exact version", () => {
    const duck = pkg("duck", "BSD");
    const clarifications = {
      "duck@1.0.0": { declared: "BSD", license: "BSD-2-Clause", reason: "LICENSE file is BSD 2-Clause" },
    };
    assert.deepEqual(
      findLicenseViolations({ all: [duck], production: [duck], allowlist: {}, clarifications }),
      [],
    );
    const newer = { ...duck, versions: ["2.0.0"] };
    assert.equal(
      findLicenseViolations({ all: [newer], production: [newer], allowlist: {}, clarifications }).length,
      2,
    );
    const changed = pkg("duck", "SSPL-1.0");
    assert.equal(
      findLicenseViolations({ all: [changed], production: [changed], allowlist: {}, clarifications }).length,
      2,
    );
  });

  it("accepts a package without a declared license only with its reviewed license file", () => {
    const reviewed = "a".repeat(64);
    const khroma: PackageLicense = {
      name: "khroma",
      versions: ["2.1.0"],
      license: UNDECLARED_LICENSE,
      licenseFiles: { "2.1.0": reviewed },
    };
    const entry = { declared: UNDECLARED_LICENSE, license: "MIT", reason: "license file is MIT" };
    const check = (pkg: PackageLicense, clarification: Record<string, unknown>) =>
      findLicenseViolations({
        all: [pkg],
        production: [pkg],
        allowlist: {},
        clarifications: { "khroma@2.1.0": { ...entry, ...clarification } },
      });

    assert.deepEqual(check(khroma, { licenseFileSha256: reviewed }), []);
    const unpinned = check(khroma, {}).join("\n");
    assert.match(unpinned, /must pin the reviewed license file/);
    assert.match(unpinned, /ships in the image or web client/);

    const changed = check(
      { ...khroma, licenseFiles: { "2.1.0": "b".repeat(64) } },
      { licenseFileSha256: reviewed },
    ).join("\n");
    assert.match(changed, /differs from the reviewed one/);
    assert.match(changed, /ships in the image or web client/);

    const withoutFile = check({ ...khroma, licenseFiles: {} }, { licenseFileSha256: reviewed }).join("\n");
    assert.match(withoutFile, /differs from the reviewed one/);

    const newer = { ...khroma, versions: ["2.2.0"], licenseFiles: { "2.2.0": reviewed } };
    assert.deepEqual(check(newer, { licenseFileSha256: reviewed }), [
      "khroma@2.2.0 (Unknown) ships in the image or web client and needs an OSI-approved license",
      "Clarification khroma@2.1.0 is not needed and must be removed",
    ]);
  });

  it("accepts an allowlisted build or test dependency", () => {
    const violations = findLicenseViolations({
      all: [data],
      production: [],
      allowlist: { "mdn-data": entry },
    });
    assert.deepEqual(violations, []);
  });

  it("rejects a non-approved build dependency without an allowlist entry", () => {
    const violations = findLicenseViolations({ all: [data], production: [], allowlist: {} });
    assert.match(violations[0] ?? "", /not in the allowlist/);
  });

  it("rejects a non-approved production dependency even when allowlisted", () => {
    const violations = findLicenseViolations({
      all: [data],
      production: [data],
      allowlist: { "mdn-data": entry },
    });
    assert.match(violations.join("\n"), /ships in the image or web client/);
  });

  it("rejects an entry whose license no longer matches", () => {
    const changed = pkg("mdn-data", "CC-BY-4.0");
    const violations = findLicenseViolations({
      all: [changed],
      production: [],
      allowlist: { "mdn-data": entry },
    });
    assert.match(violations.join("\n"), /does not match the allowlisted license CC0-1.0/);
  });

  it("rejects an entry without a reason", () => {
    const violations = findLicenseViolations({
      all: [data],
      production: [],
      allowlist: { "mdn-data": { license: "CC0-1.0", reason: " " } },
    });
    assert.match(violations.join("\n"), /without a reason/);
  });

  it("reports entries that are no longer needed", () => {
    const violations = findLicenseViolations({ all: [], production: [], allowlist: { "mdn-data": entry } });
    assert.deepEqual(violations, ["Allowlist entry mdn-data is not needed and must be removed"]);
  });
});
