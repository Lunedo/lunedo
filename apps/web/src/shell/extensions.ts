import type { LucideIcon } from "lucide-react";
import type { ComponentType } from "react";
import { createRegistry } from "./registry.js";

export type NavigationSection = "account" | "organization" | "instance";

export interface ShellContext {
  organizationId: string | null;
  can(action: string): boolean;
  navigate(to: string, params?: Record<string, string>): void;
  openCommandPalette(): void;
  openSearch(): void;
  openShortcuts(): void;
  toggleNotifications(): void;
  toggleSidebar(): void;
  signOut(): void;
}

export interface RailItem {
  id: string;
  order: number;
  placement: "main" | "footer";
  component: ComponentType;
}

export interface NavigationItem {
  id: string;
  order: number;
  section: NavigationSection;
  icon: LucideIcon;
  labelKey: string;
  to: string;
  permission?: string;
  shortcut?: string[];
  visible?: (context: ShellContext) => boolean;
}

export interface Command {
  id: string;
  order?: number;
  group: "navigation" | "actions";
  labelKey: string;
  icon?: LucideIcon;
  keywords?: string[];
  shortcut?: string[];
  visible?: (context: ShellContext) => boolean;
  run: (context: ShellContext) => void;
}

export interface Shortcut {
  id: string;
  order?: number;
  keys: string[];
  group: "general" | "navigation" | "editor";
  labelKey: string;
  listOnly?: boolean;
  run: (context: ShellContext) => void;
}

export const railItems = createRegistry<RailItem>();
export const navigationItems = createRegistry<NavigationItem>();
export const commands = createRegistry<Command>();
export const shortcuts = createRegistry<Shortcut>();

export function isNavigationVisible(item: NavigationItem, context: ShellContext): boolean {
  if (item.section === "organization" && !context.organizationId) return false;
  if (item.permission && !context.can(item.permission)) return false;
  return item.visible ? item.visible(context) : true;
}
