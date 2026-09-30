import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { type Allowlist, findLicenseViolations, type PackageLicense } from "./license-policy.ts";

function listLicenses(production: boolean): PackageLicense[] {
  const output = execSync(`pnpm licenses list --json --recursive${production ? " --prod" : ""}`, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return Object.values(JSON.parse(output) as Record<string, PackageLicense[]>).flat();
}

const { packages: allowlist } = JSON.parse(
  readFileSync(new URL("../license-allowlist.json", import.meta.url), "utf8"),
) as { packages: Allowlist };

const all = listLicenses(false);
const violations = findLicenseViolations({ all, production: listLicenses(true), allowlist });

if (violations.length > 0) {
  console.error(`License check failed:\n  ${violations.join("\n  ")}`);
  process.exit(1);
}
console.log(`All ${all.length} dependencies meet the license policy.`);
