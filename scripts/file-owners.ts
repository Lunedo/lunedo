import { type Dirent, lstatSync, readdirSync } from "node:fs";
import path from "node:path";

export interface OwnerFileSystem {
  uid: (target: string) => number;
  children: (target: string) => Dirent[];
}

export const nodeOwnerFileSystem: OwnerFileSystem = {
  uid: (target) => lstatSync(target).uid,
  children: (target) => readdirSync(target, { withFileTypes: true }),
};

export interface ForeignEntry {
  path: string;
  uid: number;
}

export function foreignEntries(
  roots: readonly string[],
  uid: number,
  limit = 20,
  fs: OwnerFileSystem = nodeOwnerFileSystem,
): ForeignEntry[] {
  const found: ForeignEntry[] = [];
  const pending = [...roots];
  while (pending.length > 0 && found.length < limit) {
    const current = pending.pop() as string;
    const owner = fs.uid(current);
    if (owner !== uid) {
      found.push({ path: current, uid: owner });
      continue;
    }
    for (const child of fs.children(current)) {
      const target = path.join(current, child.name);
      if (child.isDirectory()) pending.push(target);
      else {
        const childOwner = fs.uid(target);
        if (childOwner !== uid) found.push({ path: target, uid: childOwner });
        if (found.length >= limit) break;
      }
    }
  }
  return found;
}

export function foreignReport(entries: readonly ForeignEntry[], uid: number): string {
  return [
    `${entries.length === 1 ? "One entry belongs" : "These entries belong"} to another user than ${uid}, the owner of the workspace. Later jobs on this runner cannot clean them up. A container in this or an earlier job ran as another user. Run containers with the runner's UID and GID, and remove the entries once on the runner host as root:`,
    ...entries.map((entry) => `  ${entry.path} (UID ${entry.uid})`),
  ].join("\n");
}
