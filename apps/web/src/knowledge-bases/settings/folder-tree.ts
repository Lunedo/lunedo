export interface TreeFolder {
  id: string;
  parentId: string | null;
}

export interface FolderRow<T extends TreeFolder> {
  folder: T;
  depth: number;
  hasChildren: boolean;
}

export type FolderPlacement =
  | { parentId: string | null; afterId: string }
  | { parentId: string | null; beforeId: string }
  | { parentId: string | null };

export function childrenOf<T extends TreeFolder>(folders: readonly T[], parentId: string | null): T[] {
  return folders.filter((folder) => folder.parentId === parentId);
}

export function flatten<T extends TreeFolder>(
  folders: readonly T[],
  collapsed: ReadonlySet<string>,
  skip: string | null = null,
): FolderRow<T>[] {
  const known = new Set(folders.map((folder) => folder.id));
  const rows: FolderRow<T>[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const folder of folders) {
      if (folder.parentId !== parentId || folder.id === skip) continue;
      const hasChildren = folders.some((child) => child.parentId === folder.id);
      rows.push({ folder, depth, hasChildren });
      if (!collapsed.has(folder.id)) walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);
  for (const folder of folders) {
    if (folder.parentId !== null && !known.has(folder.parentId) && folder.id !== skip) {
      rows.push({ folder, depth: 0, hasChildren: folders.some((child) => child.parentId === folder.id) });
      if (!collapsed.has(folder.id)) walk(folder.id, 1);
    }
  }
  return rows;
}

export function descendantsOf<T extends TreeFolder>(folders: readonly T[], id: string): Set<string> {
  const found = new Set<string>();
  const walk = (parentId: string) => {
    for (const folder of folders) {
      if (folder.parentId === parentId && !found.has(folder.id)) {
        found.add(folder.id);
        walk(folder.id);
      }
    }
  };
  walk(id);
  return found;
}

export interface Projection {
  depth: number;
  parentId: string | null;
  index: number;
}

export function project<T extends TreeFolder>(
  rows: readonly FolderRow<T>[],
  activeId: string,
  overId: string,
  depthOffset: number,
): Projection | null {
  const activeIndex = rows.findIndex((row) => row.folder.id === activeId);
  const overIndex = rows.findIndex((row) => row.folder.id === overId);
  const active = rows[activeIndex];
  if (!active || overIndex < 0) return null;
  const ordered = rows.filter((row) => row.folder.id !== activeId);
  const index = overIndex;
  const previous = ordered[index - 1];
  const next = ordered[index];
  const wanted = active.depth + depthOffset;
  const max = previous ? previous.depth + 1 : 0;
  const min = next ? next.depth : 0;
  const depth = Math.max(min, Math.min(max, wanted));
  let parentId: string | null = null;
  for (let at = index - 1; at >= 0; at -= 1) {
    const row = ordered[at];
    if (!row) break;
    if (row.depth === depth - 1) {
      parentId = row.folder.id;
      break;
    }
    if (row.depth < depth) break;
  }
  return { depth, parentId: depth === 0 ? null : parentId, index };
}

export function placementOf<T extends TreeFolder>(
  rows: readonly FolderRow<T>[],
  activeId: string,
  projection: Projection,
): FolderPlacement {
  const ordered = rows.filter((row) => row.folder.id !== activeId);
  for (let at = projection.index - 1; at >= 0; at -= 1) {
    const row = ordered[at];
    if (!row || row.depth < projection.depth) break;
    if (row.depth === projection.depth && row.folder.parentId === projection.parentId) {
      return { parentId: projection.parentId, afterId: row.folder.id };
    }
  }
  const next = ordered[projection.index];
  if (next && next.depth === projection.depth && next.folder.parentId === projection.parentId) {
    return { parentId: projection.parentId, beforeId: next.folder.id };
  }
  return { parentId: projection.parentId };
}

export function siblingStep<T extends TreeFolder>(
  folders: readonly T[],
  folder: T,
  direction: -1 | 1,
): FolderPlacement | null {
  const siblings = childrenOf(folders, folder.parentId);
  const index = siblings.findIndex((sibling) => sibling.id === folder.id);
  const neighbor = siblings[index + direction];
  if (!neighbor) return null;
  return direction < 0
    ? { parentId: folder.parentId, beforeId: neighbor.id }
    : { parentId: folder.parentId, afterId: neighbor.id };
}

export function indent<T extends TreeFolder>(folders: readonly T[], folder: T): FolderPlacement | null {
  const siblings = childrenOf(folders, folder.parentId);
  const index = siblings.findIndex((sibling) => sibling.id === folder.id);
  const previous = siblings[index - 1];
  if (!previous) return null;
  const last = childrenOf(folders, previous.id).at(-1);
  return last ? { parentId: previous.id, afterId: last.id } : { parentId: previous.id };
}

export function outdent<T extends TreeFolder>(folders: readonly T[], folder: T): FolderPlacement | null {
  const parent = folders.find((candidate) => candidate.id === folder.parentId);
  if (!parent) return null;
  return { parentId: parent.parentId, afterId: parent.id };
}

export function samePlace<T extends TreeFolder>(
  folders: readonly T[],
  folder: T,
  placement: FolderPlacement,
): boolean {
  if (placement.parentId !== folder.parentId) return false;
  const siblings = childrenOf(folders, folder.parentId);
  const index = siblings.findIndex((sibling) => sibling.id === folder.id);
  if ("afterId" in placement) return siblings[index - 1]?.id === placement.afterId;
  if ("beforeId" in placement) return siblings[index + 1]?.id === placement.beforeId;
  return siblings.length === 1;
}

export function currentPlace<T extends TreeFolder>(folders: readonly T[], folder: T): FolderPlacement {
  const siblings = childrenOf(folders, folder.parentId);
  const index = siblings.findIndex((sibling) => sibling.id === folder.id);
  const previous = siblings[index - 1];
  const next = siblings[index + 1];
  if (previous) return { parentId: folder.parentId, afterId: previous.id };
  if (next) return { parentId: folder.parentId, beforeId: next.id };
  return { parentId: folder.parentId };
}
