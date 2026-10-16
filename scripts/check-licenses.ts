import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { type ListedPackage, withDeclaredLicense } from "./license-files.ts";
import {
  type Allowlist,
  type Clarifications,
  findLicenseViolations,
  type PackageLicense,
} from "./license-policy.ts";

function listLicenses(production: boolean): PackageLicense[] {
  const output = execSync(`pnpm licenses list --json --recursive${production ? " --prod" : ""}`, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return Object.values(JSON.parse(output) as Record<string, ListedPackage[]>)
    .flat()
    .map(withDeclaredLicense);
}

const { packages: allowlist } = JSON.parse(
  readFileSync(new URL("../license-allowlist.json", import.meta.url), "utf8"),
) as { packages: Allowlist };

const { packages: clarifications } = JSON.parse(
  readFileSync(new URL("../license-clarifications.json", import.meta.url), "utf8"),
) as { packages: Clarifications };

const all = listLicenses(false);
const violations = findLicenseViolations({ all, production: listLicenses(true), allowlist, clarifications });

if (violations.length > 0) {
  console.error(`License check failed:\n  ${violations.join("\n  ")}`);
  process.exit(1);
}
console.log(`All ${all.length} dependencies meet the license policy.`);
