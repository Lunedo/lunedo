import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

export interface PackageNotice {
  name: string;
  version: string;
  license: string;
  texts: { file: string; text: string }[];
}

interface Manifest {
  name?: string;
  version?: string;
  private?: boolean;
  license?: unknown;
  licenses?: unknown;
  author?: unknown;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice|mit-licen[cs]e)([.-][a-z0-9.-]*)?$/i;

function readManifest(directory: string): Manifest | null {
  const file = path.join(directory, "package.json");
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as Manifest;
}

function isOwnPackage(manifest: Manifest): boolean {
  return manifest.private === true && (manifest.name?.startsWith("@lunedo/") ?? false);
}

export function packageDirectoryOf(file: string): string | null {
  let directory = path.dirname(path.resolve(file));
  for (;;) {
    const manifest = readManifest(directory);
    if (manifest?.name && manifest.version) return realpathSync(directory);
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

export function installedDependency(from: string, name: string): string | null {
  let directory = from;
  for (;;) {
    const candidate = path.join(directory, "node_modules", name);
    if (existsSync(path.join(candidate, "package.json"))) return realpathSync(candidate);
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

export function productionClosure(directories: Iterable<string>): Set<string> {
  const seen = new Set<string>();
  const queue = [...directories].map((directory) => realpathSync(directory));
  while (queue.length > 0) {
    const directory = queue.pop() as string;
    if (seen.has(directory)) continue;
    seen.add(directory);
    const manifest = readManifest(directory);
    if (!manifest) throw new Error(`${directory} has no package.json`);
    const required = Object.keys(manifest.dependencies ?? {});
    const optional = Object.keys(manifest.optionalDependencies ?? {});
    for (const name of required) {
      const found = installedDependency(directory, name);
      if (!found) throw new Error(`${manifest.name} needs ${name}, which is not installed`);
      queue.push(found);
    }
    for (const name of optional) {
      const found = installedDependency(directory, name);
      if (found) queue.push(found);
    }
  }
  return seen;
}

function declaredLicense(manifest: Manifest): string {
  const { license, licenses } = manifest;
  if (typeof license === "string") return license;
  if (license && typeof license === "object" && "type" in license) return String(license.type);
  if (Array.isArray(licenses)) {
    return licenses
      .map((entry: unknown) =>
        entry && typeof entry === "object" && "type" in entry ? String(entry.type) : String(entry),
      )
      .join(" OR ");
  }
  return "UNKNOWN";
}

const TEXTS = path.join(import.meta.dirname, "licence-texts");
const AGPL = [path.join(import.meta.dirname, "..", "LICENSE")];

const STANDARD_TEXTS: Record<string, string[]> = {
  MIT: [path.join(TEXTS, "MIT.txt")],
  "Apache-2.0": [path.join(TEXTS, "Apache-2.0.txt")],
  "AGPL-3.0": AGPL,
  "AGPL-3.0-only": AGPL,
  "AGPL-3.0-or-later": AGPL,
  "LGPL-3.0-or-later": [path.join(TEXTS, "LGPL-3.0.txt"), path.join(TEXTS, "GPL-3.0.txt")],
};

interface BundleEntry {
  packages: string[];
  libraries: Record<string, string>;
}

const BUNDLES = (
  JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "license-bundles.json"), "utf8")) as {
    bundles: BundleEntry[];
  }
).bundles;

function authorOf(manifest: Manifest): string {
  const { author } = manifest;
  if (typeof author === "string") return author.replace(/\s*[<(].*$/, "");
  if (author && typeof author === "object" && "name" in author) return String(author.name);
  return `the authors of ${manifest.name}`;
}

function readText(file: string): string {
  return readFileSync(file, "utf8").replace(/\r\n/g, "\n").trim();
}

function standardTexts(license: string, manifest: Manifest): { file: string; text: string }[] {
  return (STANDARD_TEXTS[license] ?? []).map((file) => ({
    file: `${path.basename(file, ".txt")} (standard text; the package declares ${license} but ships no licence file)`,
    text: readText(file).replace("{copyright}", authorOf(manifest)),
  }));
}

function bundledLibraries(directory: string, id: string): { file: string; text: string }[] {
  if (!existsSync(path.join(directory, "versions.json"))) return [];
  const versions = JSON.parse(readFileSync(path.join(directory, "versions.json"), "utf8")) as Record<
    string,
    string
  >;
  const licenses = BUNDLES.find((bundle) => bundle.packages.includes(id))?.libraries ?? {};
  const lines = Object.entries(versions).map(
    ([library, version]) => `${library} ${version}: ${licenses[library] ?? "licence not reviewed"}`,
  );
  return [
    {
      file: "versions.json (prebuilt native libraries in this package and their licences)",
      text: lines.join("\n"),
    },
  ];
}

export function noticeOf(directory: string): PackageNotice | null {
  const manifest = readManifest(directory);
  if (!manifest?.name || !manifest.version || isOwnPackage(manifest)) return null;
  const files = readdirSync(directory)
    .filter((name) => LICENSE_FILE.test(name) && statSync(path.join(directory, name)).isFile())
    .sort()
    .map((file) => ({ file, text: readText(path.join(directory, file)) }));
  const license = declaredLicense(manifest);
  const texts = files.length > 0 ? files : standardTexts(license, manifest);
  const libraries =
    texts.length > 0 ? bundledLibraries(directory, `${manifest.name}@${manifest.version}`) : [];
  return { name: manifest.name, version: manifest.version, license, texts: [...texts, ...libraries] };
}

export function collectNotices(directories: Iterable<string>, extra: PackageNotice[] = []): PackageNotice[] {
  const notices = new Map<string, PackageNotice>();
  for (const directory of directories) {
    const notice = noticeOf(directory);
    if (notice) notices.set(`${notice.name}@${notice.version}`, notice);
  }
  for (const notice of extra) notices.set(`${notice.name}@${notice.version}`, notice);
  return [...notices.values()].sort((a, b) =>
    a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name),
  );
}

export function withoutLicenseText(notices: PackageNotice[]): string[] {
  return notices
    .filter((notice) => notice.texts.length === 0)
    .map((notice) => `${notice.name}@${notice.version}`);
}

const RULE = "=".repeat(80);
const THIN_RULE = "-".repeat(80);

export function renderNotices(product: string, notices: PackageNotice[]): string {
  const missing = withoutLicenseText(notices);
  if (missing.length > 0) {
    throw new Error(
      `No licence text for ${missing.join(", ")}. Add the standard text of their licence to scripts/licence-texts.`,
    );
  }
  const head = [
    `Third-party software in ${product}`,
    "",
    `${product} is licensed under the GNU Affero General Public License version 3.`,
    `It contains the following ${notices.length} third-party packages, each under its own licence.`,
    "",
    ...notices.map((notice) => `- ${notice.name} ${notice.version} (${notice.license})`),
  ];
  const bodies = notices.flatMap((notice) => [
    "",
    RULE,
    `${notice.name} ${notice.version}`,
    `License: ${notice.license}`,
    ...notice.texts.flatMap((text) => [THIN_RULE, `${text.file}:`, "", text.text]),
  ]);
  return `${[...head, ...bodies].join("\n")}\n`;
}
