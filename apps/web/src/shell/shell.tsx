import { createContext, useContext } from "react";
import type { ShellContext } from "./extensions.js";

export interface ShellState extends ShellContext {
  notificationsOpen: boolean;
  sidebarCollapsed: boolean;
}

export const ShellStateContext = createContext<ShellState | null>(null);

export function useShell(): ShellState {
  const value = useContext(ShellStateContext);
  if (!value) throw new Error("useShell needs the app shell");
  return value;
}
