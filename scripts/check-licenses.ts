import { execSync } from "node:child_process";
import { isApprovedLicense } from "./license-policy.ts";

interface PackageLicense {
  name: string;
  versions: string[];
  license: string;
}

const output = execSync("pnpm licenses list --json --recursive", {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
const byLicense = JSON.parse(output) as Record<string, PackageLicense[]>;

const rejected = Object.entries(byLicense)
  .filter(([license]) => !isApprovedLicense(license))
  .flatMap(([license, packages]) =>
    packages.map((pkg) => `${pkg.name}@${pkg.versions.join(", ")}: ${license}`),
  );

const total = Object.values(byLicense).reduce((sum, packages) => sum + packages.length, 0);
if (rejected.length > 0) {
  console.error(`Dependencies without an OSI-approved license:\n  ${rejected.join("\n  ")}`);
  process.exit(1);
}
console.log(`All ${total} dependencies use OSI-approved licenses.`);
