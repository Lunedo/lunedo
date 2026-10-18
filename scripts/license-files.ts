import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BUNDLING_PACKAGE,
  type BundledLibraries,
  type PackageLicense,
  UNDECLARED_LICENSE,
} from "./license-policy.ts";

export type ListedPackage = PackageLicense & { paths?: string[] };

const licenseFileName = /^(licen[cs]e|copying|mit-licen[cs]e)(\.(md|txt))?$/i;

function licenseFileHash(directory: string): string | undefined {
  const names = readdirSync(directory).filter((name) => licenseFileName.test(name));
  if (names.length !== 1 || names[0] === undefined) return undefined;
  return createHash("sha256")
    .update(readFileSync(join(directory, names[0])))
    .digest("hex");
}

function bundledLibraries(directory: string): BundledLibraries | undefined {
  const file = join(directory, "versions.json");
  if (!existsSync(file)) return undefined;
  const content = readFileSync(file);
  return {
    sha256: createHash("sha256").update(content).digest("hex"),
    libraries: Object.keys(JSON.parse(content.toString("utf8")) as Record<string, unknown>).sort(),
  };
}

export function withDeclaredLicense(pkg: ListedPackage): PackageLicense {
  const { paths, ...listed } = pkg;
  const licenseFiles: Record<string, string> = {};
  const bundled: Record<string, BundledLibraries> = {};
  let undeclared = false;
  for (const directory of paths ?? []) {
    const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as {
      version: string;
      license?: unknown;
      licenses?: unknown;
    };
    if (BUNDLING_PACKAGE.test(pkg.name)) {
      const libraries = bundledLibraries(directory);
      if (libraries) bundled[manifest.version] = libraries;
    }
    if (manifest.license !== undefined || manifest.licenses !== undefined) continue;
    undeclared = true;
    const hash = licenseFileHash(directory);
    if (hash) licenseFiles[manifest.version] = hash;
  }
  const result = BUNDLING_PACKAGE.test(pkg.name) ? { ...listed, bundled } : listed;
  return undeclared ? { ...result, license: UNDECLARED_LICENSE, licenseFiles } : result;
}
