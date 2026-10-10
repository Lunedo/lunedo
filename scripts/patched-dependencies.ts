export interface Patch {
  name: string;
  version: string;
  file: string;
}

export interface Manifest {
  file: string;
  content: string;
}

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

function unquote(value: string): string {
  return value.trim().replace(/^(["'])(.*)\1$/, "$2");
}

function splitSpecifier(key: string): { name: string; version: string } | null {
  const separator = key.lastIndexOf("@");
  if (separator <= 0) return null;
  return { name: key.slice(0, separator), version: key.slice(separator + 1) };
}

export function patchesOf(workspace: string): Patch[] {
  const patches: Patch[] = [];
  let inside = false;
  for (const line of workspace.split("\n")) {
    if (/^\S/.test(line)) {
      inside = /^patchedDependencies:\s*$/.test(line);
      continue;
    }
    const entry = inside ? /^\s+("[^"]+"|'[^']+'|[^\s:]+):\s*(\S.*)$/.exec(line) : null;
    const specifier = entry ? splitSpecifier(unquote(entry[1] ?? "")) : null;
    if (entry && specifier) patches.push({ ...specifier, file: unquote(entry[2] ?? "") });
  }
  return patches;
}

export function resolvedVersions(lockfile: string, name: string): string[] {
  const versions = new Set<string>();
  let inside = false;
  for (const line of lockfile.split("\n")) {
    if (/^\S/.test(line)) {
      inside = /^packages:\s*$/.test(line);
      continue;
    }
    const entry = inside ? /^ {2}'?([^'\s]+)'?:\s*$/.exec(line) : null;
    const specifier = entry ? splitSpecifier(entry[1] ?? "") : null;
    if (specifier?.name === name) versions.add(specifier.version);
  }
  return [...versions];
}

export function patchProblems(patches: Patch[], manifests: Manifest[], lockfile: string): string[] {
  const problems: string[] = [];
  const advice = (patch: Patch) =>
    `Check whether the new release fixes the problem the patch ${patch.file} works around, then remove the patch or recreate it for that release.`;
  for (const patch of patches) {
    for (const manifest of manifests) {
      const parsed = JSON.parse(manifest.content) as Partial<Record<string, Record<string, string>>>;
      for (const field of DEPENDENCY_FIELDS) {
        const specifier = parsed[field]?.[patch.name];
        if (specifier !== undefined && specifier !== patch.version && field !== "peerDependencies") {
          problems.push(
            `${manifest.file} asks for ${patch.name}@${specifier}, but the patch was made for exactly ${patch.version}. ${advice(patch)}`,
          );
        }
      }
    }
    const resolved = resolvedVersions(lockfile, patch.name);
    if (resolved.length === 0) {
      problems.push(
        `The lockfile does not contain ${patch.name}, but the patch ${patch.file} exists. Remove the patch.`,
      );
    }
    for (const version of resolved.filter((candidate) => candidate !== patch.version)) {
      problems.push(
        `The lockfile resolves ${patch.name}@${version}, but the patch was made for ${patch.version}. ${advice(patch)}`,
      );
    }
  }
  return problems;
}
