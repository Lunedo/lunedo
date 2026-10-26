import { copyFileSync, cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build, type Metafile } from "esbuild";
import {
  collectNotices,
  installedDependency,
  packageDirectoryOf,
  productionClosure,
  renderNotices,
} from "./third-party-notices.ts";

const root = path.resolve(import.meta.dirname, "..");
const server = path.join(root, "packages", "server");

export const ENTRIES = {
  api: "apps/api/dist/main.js",
  collab: "apps/collab/dist/main.js",
  worker: "apps/worker/dist/main.js",
  cli: "apps/worker/dist/cli/main.js",
  "convert-worker": "packages/server/dist/imports/word/convert-worker.js",
  "extraction-worker": "packages/server/dist/search/extraction/extraction-worker.js",
  server: "packages/server/dist/index.js",
};

export const RUNTIME_DEPENDENCIES: Record<string, string> = {
  "@fontsource/geist": "packages/server",
  "@fontsource/geist-mono": "packages/server",
  minisearch: "packages/server",
  "pdfjs-dist": "packages/server",
  sharp: "packages/server",
};

const ABSENT_OPTIONAL = [
  "@fastify/multipart",
  "@fastify/view",
  "@nestjs/microservices",
  "@nestjs/platform-express",
  "@nestjs/websockets",
  "bufferutil",
  "class-transformer",
  "class-validator",
  "pg-native",
  "utf-8-validate",
];

const BANNER = [
  'import { createRequire as __lunedoCreateRequire } from "node:module";',
  "globalThis.require ??= __lunedoCreateRequire(import.meta.url);",
].join("\n");

interface RuntimeManifest {
  dependencies?: Record<string, string>;
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8")) as T;
}

export function runtimeManifestProblems(
  runtime: RuntimeManifest,
  declared: (name: string, workspace: string) => string | undefined,
): string[] {
  const problems: string[] = [];
  const listed = runtime.dependencies ?? {};
  for (const [name, workspace] of Object.entries(RUNTIME_DEPENDENCIES)) {
    const wanted = declared(name, workspace);
    if (!wanted) problems.push(`${workspace} does not declare ${name}`);
    else if (listed[name] !== wanted) problems.push(`docker/runtime must depend on ${name} ${wanted}`);
  }
  for (const name of Object.keys(listed)) {
    if (!(name in RUNTIME_DEPENDENCIES)) problems.push(`docker/runtime depends on ${name}, which is bundled`);
  }
  return problems;
}

function bundledPackageDirectories(metafile: Metafile): Set<string> {
  const directories = new Set<string>();
  for (const input of Object.keys(metafile.inputs)) {
    if (!input.includes("node_modules")) continue;
    const directory = packageDirectoryOf(path.resolve(root, input));
    if (directory) directories.add(directory);
  }
  return directories;
}

function runtimeDirectories(): string[] {
  return Object.entries(RUNTIME_DEPENDENCIES).map(([name, workspace]) => {
    const directory = installedDependency(path.join(root, workspace), name);
    if (!directory) throw new Error(`${name} is not installed for ${workspace}`);
    return directory;
  });
}

async function bundle(target: string): Promise<void> {
  const problems = runtimeManifestProblems(
    readJson<RuntimeManifest>(path.join(root, "docker", "runtime", "package.json")),
    (name, workspace) =>
      readJson<RuntimeManifest>(path.join(root, workspace, "package.json")).dependencies?.[name],
  );
  if (problems.length > 0) throw new Error(problems.join("\n"));

  const out = path.join(target, "server");
  rmSync(out, { recursive: true, force: true });
  const result = await build({
    absWorkingDir: root,
    entryPoints: Object.fromEntries(
      Object.entries(ENTRIES).map(([name, file]) => [name, path.join(root, file)]),
    ),
    outdir: out,
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "node",
    target: "node24",
    keepNames: true,
    minifyWhitespace: true,
    minifySyntax: true,
    legalComments: "none",
    metafile: true,
    logLevel: "warning",
    external: [...Object.keys(RUNTIME_DEPENDENCIES), ...ABSENT_OPTIONAL],
    banner: { js: BANNER },
  });

  writeFileSync(path.join(out, "package.json"), `${JSON.stringify({ type: "module" }, null, 2)}\n`);
  cpSync(path.join(server, "drizzle"), path.join(out, "drizzle"), {
    recursive: true,
    filter: (file) => !/_snapshot\.json$/.test(file),
  });
  cpSync(path.join(server, "data"), path.join(out, "data"), { recursive: true });
  copyFileSync(path.join(root, "apps", "api", "dist", "docs", "scalar.js"), path.join(out, "scalar.js"));
  const scalar = packageDirectoryOf(
    path.join(root, "apps", "api", "node_modules", "@scalar", "api-reference", "x"),
  );

  const bundled = bundledPackageDirectories(result.metafile);
  if (scalar) bundled.add(scalar);
  const notices = collectNotices([...bundled, ...productionClosure(runtimeDirectories())]);
  writeFileSync(path.join(target, "THIRD_PARTY_NOTICES.txt"), renderNotices("Lunedo", notices));
  console.log(
    `Bundled ${Object.keys(ENTRIES).length} entries into ${out} with ${notices.length} third-party packages.`,
  );
}

if (import.meta.main) {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: node scripts/bundle-server.ts <target directory>");
    process.exit(64);
  }
  await bundle(path.resolve(target));
}
