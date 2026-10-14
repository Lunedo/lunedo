import type { LucideIcon } from "lucide-react";
import { createRegistry } from "../shell/registry.js";
import type { NotificationItem } from "./notifications-api.js";

export interface NotificationLink {
  to: string;
  params?: Record<string, string>;
}

export interface NotificationType {
  id: string;
  icon: LucideIcon;
  link: (item: NotificationItem) => NotificationLink | null;
  dateTimeParams?: readonly string[];
}

export const notificationTypes = createRegistry<NotificationType>();
