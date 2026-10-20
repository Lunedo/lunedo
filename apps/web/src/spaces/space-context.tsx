import { createContext, useContext } from "react";
import type { SpaceWithRole, TreeItem } from "./space-queries.js";

export interface SpaceContextValue {
  space: SpaceWithRole;
  canEdit: boolean;
  openMove: (item: Pick<TreeItem, "id" | "title" | "kind" | "spaceId" | "parentId">) => void;
  openCopy: (item: CopiedItem) => void;
  openCreate: (
    kind: "page" | "folder" | "link" | "whiteboard",
    parentId: string | null,
    title?: string,
  ) => void;
}

export type CopiedItem = Pick<TreeItem, "id" | "title" | "kind" | "spaceId" | "parentId" | "hasChildren">;

export const SpaceContext = createContext<SpaceContextValue | null>(null);

export function useSpace(): SpaceContextValue {
  const value = useContext(SpaceContext);
  if (!value) throw new Error("useSpace needs a space layout");
  return value;
}
