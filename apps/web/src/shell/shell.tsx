import { createContext, useContext } from "react";
import type { ShellContext } from "./extensions.js";

export type CreateKind = "page" | "folder" | "whiteboard" | "link" | "blogPost" | "meeting";

export interface SpaceCreateTarget {
  spaceKey: string;
  name: string;
  knowledgeBase: boolean;
  kinds: readonly CreateKind[];
  create: (kind: CreateKind) => void;
}

export interface SettingsReturn {
  href: string;
  spaceKey: string | null;
}

export interface ShellState extends ShellContext {
  settingsReturn: SettingsReturn;
  notificationsOpen: boolean;
  sidebarCollapsed: boolean;
  mobileSidebarOpen: boolean;
  closeMobileSidebar(): void;
  suggestCollapsedSidebar(suggested: boolean): void;
  spaceCreateTarget: SpaceCreateTarget | null;
  setSpaceCreateTarget(target: SpaceCreateTarget | null): void;
  pendingCreate: { spaceKey: string; kind: CreateKind } | null;
  requestCreate(spaceKey: string, kind: CreateKind): void;
  clearPendingCreate(): void;
}

export const ShellStateContext = createContext<ShellState | null>(null);

export function useShell(): ShellState {
  const value = useContext(ShellStateContext);
  if (!value) throw new Error("useShell needs the app shell");
  return value;
}
