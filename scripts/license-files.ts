import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type PackageLicense, UNDECLARED_LICENSE } from "./license-policy.ts";

export type ListedPackage = PackageLicense & { paths?: string[] };

const licenseFileName = /^(licen[cs]e|copying|mit-licen[cs]e)(\.(md|txt))?$/i;

function licenseFileHash(directory: string): string | undefined {
  const names = readdirSync(directory).filter((name) => licenseFileName.test(name));
  if (names.length !== 1 || names[0] === undefined) return undefined;
  return createHash("sha256")
    .update(readFileSync(join(directory, names[0])))
    .digest("hex");
}

export function withDeclaredLicense(pkg: ListedPackage): PackageLicense {
  const { paths, ...listed } = pkg;
  const licenseFiles: Record<string, string> = {};
  let undeclared = false;
  for (const directory of paths ?? []) {
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
      version: string;
      license?: unknown;
      licenses?: unknown;
    };
    if (manifest.license !== undefined || manifest.licenses !== undefined) continue;
    undeclared = true;
    const hash = licenseFileHash(directory);
    if (hash) licenseFiles[manifest.version] = hash;
  }
  return undeclared ? { ...listed, license: UNDECLARED_LICENSE, licenseFiles } : listed;
}
