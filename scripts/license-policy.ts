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

function evaluate(expression: Expression): boolean {
  if ("license" in expression) return approvedLicenses.has(expression.license.replace(/\+$/, ""));
  return expression.operator === "AND"
    ? evaluate(expression.left) && evaluate(expression.right)
    : evaluate(expression.left) || evaluate(expression.right);
}

/** Checks an SPDX license expression such as `MIT OR Apache-2.0`. */
export function isApprovedLicense(expression: string): boolean {
  try {
    return evaluate(parse(tokenize(expression)));
  } catch {
    return false;
  }
}

export interface PackageLicense {
  name: string;
  versions: string[];
  license: string;
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
}): string[] {
  const violations: string[] = [];
  const clarifications = options.clarifications ?? {};
  const usedClarifications = new Set<string>();
  const effective = (pkg: PackageLicense): string => {
    const keys = pkg.versions.map((version) => `${pkg.name}@${version}`);
    const entries = keys.map((key) => clarifications[key]);
    if (keys.length === 0 || entries.some((entry) => !entry || entry.declared !== pkg.license))
      return pkg.license;
    for (const key of keys) usedClarifications.add(key);
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
