/**
 * OSI-approved licenses accepted for dependencies. Extend the list only
 * with SPDX identifiers from https://opensource.org/licenses.
 */
export const approvedLicenses = new Set([
  "0BSD",
  "AGPL-3.0-only",
  "AGPL-3.0-or-later",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "EPL-2.0",
  "ISC",
  "LGPL-2.1-only",
  "LGPL-2.1-or-later",
  "LGPL-3.0-only",
  "LGPL-3.0-or-later",
  "MIT",
  "MIT-0",
  "MPL-2.0",
  "OFL-1.1",
  "PSF-2.0",
  "Python-2.0",
  "Unlicense",
  "UPL-1.0",
  "Zlib",
]);

type Expression = { license: string } | { operator: "AND" | "OR"; left: Expression; right: Expression };

function tokenize(expression: string): string[] {
  return expression.replace(/\(/g, " ( ").replace(/\)/g, " ) ").trim().split(/\s+/).filter(Boolean);
}

function parse(tokens: string[]): Expression {
  let position = 0;

  const primary = (): Expression => {
    const token = tokens[position++];
    if (token === undefined || token === ")" || token === "AND" || token === "OR") {
      throw new Error("Unexpected token in license expression");
    }
    if (token === "(") {
      const inner = or();
      if (tokens[position++] !== ")") throw new Error("Missing closing parenthesis");
      return inner;
    }
    if (tokens[position] === "WITH") position += 2;
    return { license: token };
  };

  const and = (): Expression => {
    let left = primary();
    while (tokens[position] === "AND") {
      position++;
      left = { operator: "AND", left, right: primary() };
    }
    return left;
  };

  const or = (): Expression => {
    let left = and();
    while (tokens[position] === "OR") {
      position++;
      left = { operator: "OR", left, right: and() };
    }
    return left;
  };

  const result = or();
  if (position !== tokens.length) throw new Error("Unexpected trailing tokens in license expression");
  return result;
}

function evaluate(expression: Expression, accepted: ReadonlySet<string>): boolean {
  if ("license" in expression) {
    const license = expression.license.replace(/\+$/, "");
    return approvedLicenses.has(license) || accepted.has(license);
  }
  return expression.operator === "AND"
    ? evaluate(expression.left, accepted) && evaluate(expression.right, accepted)
    : evaluate(expression.left, accepted) || evaluate(expression.right, accepted);
}

/** Checks an SPDX license expression such as `MIT OR Apache-2.0`. */
export function isApprovedLicense(expression: string, accepted: ReadonlySet<string> = new Set()): boolean {
  try {
    return evaluate(parse(tokenize(expression)), accepted);
  } catch {
    return false;
  }
}

export const BUNDLING_PACKAGE = /^@img\/sharp-libvips-/;

export const UNDECLARED_LICENSE = "Unknown";

export interface BundledLibraries {
  sha256: string;
  libraries: string[];
}

export interface PackageLicense {
  name: string;
  versions: string[];
  license: string;
  licenseFiles?: Record<string, string>;
  bundled?: Record<string, BundledLibraries>;
}

export interface BundleEntry {
  packages: string[];
  versionsSha256: string;
  libraries: Record<string, string>;
  accepted: string[];
  reason: string;
}

export interface AllowlistEntry {
  license: string;
  reason: string;
}

export type Allowlist = Record<string, AllowlistEntry>;

export interface Clarification {
  declared: string;
  license: string;
  reason: string;
  licenseFileSha256?: string;
}

export type Clarifications = Record<string, Clarification>;

/**
 * Production dependencies ship in the image or the web client and must use an approved license.
 * Build and test dependencies may use other open licenses when the allowlist names the package,
 * its license and a reason. Unused entries are reported so that the list stays accurate.
 */
export function findLicenseViolations(options: {
  all: readonly PackageLicense[];
  production: readonly PackageLicense[];
  allowlist: Allowlist;
  clarifications?: Clarifications;
  bundles?: readonly BundleEntry[];
}): string[] {
  const violations: string[] = [];
  violations.push(...findBundleViolations(options.all, options.bundles ?? []));
  const clarifications = options.clarifications ?? {};
  const usedClarifications = new Set<string>();
  const reviewedFile = (pkg: PackageLicense, version: string, entry: Clarification): boolean => {
    if (pkg.license !== UNDECLARED_LICENSE) return true;
    const key = `${pkg.name}@${version}`;
    if (!entry.licenseFileSha256) {
      violations.push(`Clarification ${key} must pin the reviewed license file with licenseFileSha256`);
      return false;
    }
    if (pkg.licenseFiles?.[version] !== entry.licenseFileSha256) {
      violations.push(
        `The license file of ${key} differs from the reviewed one; review it and update the clarification`,
      );
      return false;
    }
    return true;
  };
  const effective = (pkg: PackageLicense): string => {
    const keys = pkg.versions.map((version) => `${pkg.name}@${version}`);
    const entries = keys.map((key) => clarifications[key]);
    if (keys.length === 0 || entries.some((entry) => !entry || entry.declared !== pkg.license))
      return pkg.license;
    for (const key of keys) usedClarifications.add(key);
    const reviewed = pkg.versions.map((version, index) => {
      const entry = entries[index];
      return entry !== undefined && reviewedFile(pkg, version, entry);
    });
    if (reviewed.includes(false)) return pkg.license;
    const licenses = new Set(entries.map((entry) => entry?.license ?? ""));
    return licenses.size === 1 ? ([...licenses][0] ?? pkg.license) : pkg.license;
  };
  const productionNames = new Set(options.production.map((pkg) => pkg.name));
  const usedEntries = new Set<string>();
  const label = (pkg: PackageLicense) => `${pkg.name}@${pkg.versions.join(", ")} (${pkg.license})`;

  for (const pkg of options.all) {
    if (isApprovedLicense(pkg.license)) continue;
    if (isApprovedLicense(effective(pkg))) continue;
    if (productionNames.has(pkg.name)) {
      violations.push(`${label(pkg)} ships in the image or web client and needs an OSI-approved license`);
      continue;
    }
    const entry = options.allowlist[pkg.name];
    if (!entry) {
      violations.push(`${label(pkg)} is not OSI-approved and not in the allowlist`);
    } else if (entry.license !== pkg.license) {
      violations.push(`${label(pkg)} does not match the allowlisted license ${entry.license}`);
    } else if (entry.reason.trim() === "") {
      violations.push(`${label(pkg)} has an allowlist entry without a reason`);
    } else {
      usedEntries.add(pkg.name);
    }
  }

  for (const [key, entry] of Object.entries(clarifications)) {
    if (entry.reason.trim() === "") violations.push(`Clarification ${key} has no reason`);
    if (!usedClarifications.has(key))
      violations.push(`Clarification ${key} is not needed and must be removed`);
  }
  for (const name of Object.keys(options.allowlist)) {
    if (!usedEntries.has(name)) violations.push(`Allowlist entry ${name} is not needed and must be removed`);
  }
  return violations;
}

function findBundleViolations(all: readonly PackageLicense[], bundles: readonly BundleEntry[]): string[] {
  const violations: string[] = [];
  for (const bundle of bundles) {
    if (bundle.reason.trim() === "")
      violations.push(`Bundle entry ${bundle.packages.join(", ")} has no reason`);
    for (const license of bundle.accepted) {
      if (approvedLicenses.has(license)) {
        violations.push(
          `Bundle entry ${bundle.packages.join(", ")} accepts ${license}, which needs no exception`,
        );
      }
    }
  }
  for (const pkg of all) {
    if (!BUNDLING_PACKAGE.test(pkg.name)) continue;
    for (const version of pkg.versions) {
      const key = `${pkg.name}@${version}`;
      const bundle = bundles.find((entry) => entry.packages.includes(key));
      if (!bundle) {
        violations.push(`${key} bundles native libraries and needs a reviewed entry in license-bundles.json`);
        continue;
      }
      const bundled = pkg.bundled?.[version];
      if (!bundled || bundled.sha256 !== bundle.versionsSha256) {
        violations.push(
          `The bundled libraries of ${key} differ from the reviewed ones; review their licenses and update license-bundles.json`,
        );
        continue;
      }
      const accepted = new Set(bundle.accepted);
      for (const library of bundled.libraries) {
        const license = bundle.libraries[library];
        if (license === undefined) {
          violations.push(`${key} bundles ${library}, which has no reviewed license`);
        } else if (!isApprovedLicense(license, accepted)) {
          violations.push(`${key} bundles ${library} under ${license}, which is not accepted for it`);
        }
      }
    }
  }
  return violations;
}
