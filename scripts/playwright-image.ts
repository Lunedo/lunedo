const IMAGE =
  /mcr\.microsoft\.com\/playwright(?::v(\d+\.\d+\.\d+)[\w.-]*|@sha256:[0-9a-f]{64}(?:\s*#\s*v(\d+\.\d+\.\d+)\S*)?)/g;

export interface ImageReference {
  line: number;
  version: string | undefined;
}

export function imageReferences(workflow: string): ImageReference[] {
  const references: ImageReference[] = [];
  workflow.split(/\r?\n/).forEach((text, index) => {
    for (const match of text.matchAll(IMAGE)) {
      references.push({ line: index + 1, version: match[1] ?? match[2] });
    }
  });
  return references;
}

export function playwrightVersions(lockfile: string): string[] {
  const versions = new Set<string>();
  const lines = lockfile.split(/\r?\n/);
  lines.forEach((text, index) => {
    if (!/^\s+'?@playwright\/test'?:\s*$/.test(text)) return;
    const version = /^\s+version:\s*(\d+\.\d+\.\d+)/.exec(lines[index + 2] ?? "");
    if (version?.[1]) versions.add(version[1]);
  });
  return [...versions];
}

export function playwrightImageProblems(workflows: Record<string, string>, lockfile: string): string[] {
  const versions = playwrightVersions(lockfile);
  if (versions.length !== 1) {
    return [`Expected exactly one @playwright/test version in pnpm-lock.yaml, found ${versions.length}`];
  }
  const expected = versions[0];
  const problems: string[] = [];
  for (const [file, workflow] of Object.entries(workflows)) {
    for (const reference of imageReferences(workflow)) {
      if (reference.version === undefined) {
        problems.push(
          `${file}:${reference.line} names no Playwright version; add the tag or a "# v${expected}-noble" comment`,
        );
      } else if (reference.version !== expected) {
        problems.push(
          `${file}:${reference.line} uses the Playwright image ${reference.version}, @playwright/test is ${expected}`,
        );
      }
    }
  }
  return problems;
}
