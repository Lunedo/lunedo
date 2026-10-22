import {
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "../api/client.js";
import { identityKeys } from "../api/identity-queries.js";
import { instanceKeys } from "../api/instance-queries.js";
import { maintenanceChanged } from "../api/maintenance.js";
import { organizationKeys } from "../api/organization-queries.js";
import { queryKeys } from "../api/queries.js";
import { request } from "../api/request.js";
import { importChanged, importKeys } from "../imports/imports-api.js";
import { announcementsChanged } from "../shell/announcement-banners.js";
import { isSpaceChangeEvent, type SpaceChangeEvent, spacesChanged } from "../spaces/space-queries.js";

export const notificationKeys = {
  all: ["notifications"] as const,
  unread: ["notifications", "unread"] as const,
  list: (unreadOnly: boolean) => ["notifications", "list", unreadOnly] as const,
};

export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unread,
    queryFn: async () => (await request(() => api.GET("/api/v1/notifications/unread-count"))).count,
    staleTime: 60_000,
    throwOnError: false,
  });
}

export function useNotificationList(unreadOnly: boolean) {
  return useInfiniteQuery({
    queryKey: notificationKeys.list(unreadOnly),
    throwOnError: false,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      request(() =>
        api.GET("/api/v1/notifications", {
          params: {
            query: {
              limit: 30,
              ...(pageParam ? { cursor: pageParam } : {}),
              ...(unreadOnly ? { unread: "true" as const } : {}),
            },
          },
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

export type NotificationItem = NonNullable<
  ReturnType<typeof useNotificationList>["data"]
>["pages"][number]["items"][number];

export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request(() =>
        api.POST("/api/v1/notifications/{notificationId}/read", { params: { path: { notificationId: id } } }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (before: string) =>
      request(() => api.POST("/api/v1/notifications/read-all", { body: { before } })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

export interface SettingsEvent {
  key: string;
  level: "instance" | "organization" | "user";
  organizationId: string | null;
}

export function settingsChanged(queryClient: QueryClient, event: SettingsEvent): void {
  void queryClient.invalidateQueries({ queryKey: queryKeys.preferences });
  if (event.level === "instance") {
    void queryClient.invalidateQueries({ queryKey: instanceKeys.settings });
    void queryClient.invalidateQueries({ queryKey: queryKeys.instanceInfo });
    void queryClient.invalidateQueries({ queryKey: ["organization"] });
    void queryClient.invalidateQueries({ queryKey: queryKeys.organizations });
  }
  if (event.level === "organization" && event.organizationId) {
    void queryClient.invalidateQueries({ queryKey: organizationKeys.settings(event.organizationId) });
    void queryClient.invalidateQueries({ queryKey: organizationKeys.organization(event.organizationId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.organizations });
  }
}

export function syncRunChanged(queryClient: QueryClient, providerId: string): void {
  void queryClient.invalidateQueries({ queryKey: identityKeys.provider(providerId) });
  void queryClient.invalidateQueries({ queryKey: identityKeys.ownIdentities });
  void queryClient.invalidateQueries({ queryKey: instanceKeys.accounts });
  void queryClient.invalidateQueries({ queryKey: ["organization"] });
  void queryClient.invalidateQueries({ queryKey: ["group"] });
}

export interface ChangeEvent {
  scope: "instance" | "organization";
  organizationId: string | null;
  target: string;
}

type QueryKey = readonly unknown[];

const INSTANCE_TARGET_KEYS: Record<string, QueryKey[]> = {
  account: [instanceKeys.accounts, ["organization"], ["group"], ["serviceAccount"]],
  invitation: [instanceKeys.accounts, ["organization"]],
  organization: [instanceKeys.organizations, queryKeys.organizations, instanceKeys.accounts],
  role: [instanceKeys.roles, instanceKeys.assignments, instanceKeys.accounts],
  roleAssignment: [instanceKeys.assignments, instanceKeys.accounts],
  identityProvider: [identityKeys.providers, identityKeys.drafts],
  mappingRule: [identityKeys.providers],
  breakGlassAccess: [instanceKeys.breakGlass],
  apiToken: [["organization"], ["serviceAccount"]],
};

const PROVIDER_TARGETS = new Set(["identityProvider", "mappingRule"]);

const ORGANIZATION_WIDE_TARGETS = new Set(["account", "invitation", "organization", "roleAssignment"]);

export function changeKeys(event: ChangeEvent): QueryKey[] {
  const keys: QueryKey[] = [["audit"]];
  if (event.scope === "instance") return [...keys, ...(INSTANCE_TARGET_KEYS[event.target] ?? [])];
  if (!event.organizationId) return keys;
  keys.push(organizationKeys.organization(event.organizationId), ["group"], ["serviceAccount"]);
  if (PROVIDER_TARGETS.has(event.target)) keys.push(...(INSTANCE_TARGET_KEYS[event.target] ?? []));
  if (event.target === "organization") keys.push(importKeys.folder(event.organizationId));
  if (ORGANIZATION_WIDE_TARGETS.has(event.target)) {
    keys.push(instanceKeys.accounts, instanceKeys.organizations, queryKeys.organizations);
  }
  return keys;
}

export function objectsChanged(queryClient: QueryClient, events: ChangeEvent[]): void {
  const seen = new Set<string>();
  for (const event of events) {
    for (const queryKey of changeKeys(event)) {
      const id = JSON.stringify(queryKey);
      if (seen.has(id)) continue;
      seen.add(id);
      void queryClient.invalidateQueries({ queryKey });
    }
  }
}

const CHANGE_BATCH_MS = 150;

function isChangeEvent(value: unknown): value is ChangeEvent {
  if (typeof value !== "object" || value === null) return false;
  const event = value as Partial<ChangeEvent>;
  return (
    (event.scope === "instance" || event.scope === "organization") &&
    (event.organizationId === null || typeof event.organizationId === "string") &&
    typeof event.target === "string"
  );
}

export function useNotificationStream(enabled: boolean): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled || typeof EventSource === "undefined") return;
    const source = new EventSource("/api/v1/notifications/stream", { withCredentials: true });
    const onChange = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as { unreadCount?: number };
        if (typeof data.unreadCount === "number")
          queryClient.setQueryData(notificationKeys.unread, data.unreadCount);
      } catch {
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ["notifications", "list"] });
    };
    const onSettings = (event: MessageEvent<string>) => {
      try {
        settingsChanged(queryClient, JSON.parse(event.data) as SettingsEvent);
      } catch {
        return;
      }
    };
    const onSyncRuns = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as { providerId?: unknown };
        if (typeof data.providerId !== "string") return;
        syncRunChanged(queryClient, data.providerId);
      } catch {
        return;
      }
    };
    let pending: ChangeEvent[] = [];
    let flush: ReturnType<typeof setTimeout> | undefined;
    const onObjects = (event: MessageEvent<string>) => {
      try {
        const data: unknown = JSON.parse(event.data);
        if (!isChangeEvent(data)) return;
        pending.push(data);
      } catch {
        return;
      }
      flush ??= setTimeout(() => {
        flush = undefined;
        const events = pending;
        pending = [];
        objectsChanged(queryClient, events);
      }, CHANGE_BATCH_MS);
    };
    let pendingSpaces: SpaceChangeEvent[] = [];
    let flushSpaces: ReturnType<typeof setTimeout> | undefined;
    const onSpaces = (event: MessageEvent<string>) => {
      try {
        const data: unknown = JSON.parse(event.data);
        if (!isSpaceChangeEvent(data)) return;
        pendingSpaces.push(data);
      } catch {
        return;
      }
      flushSpaces ??= setTimeout(() => {
        flushSpaces = undefined;
        const events = pendingSpaces;
        pendingSpaces = [];
        spacesChanged(queryClient, events);
      }, CHANGE_BATCH_MS);
    };
    const onImports = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as { importId?: unknown; organizationId?: unknown };
        if (typeof data.importId !== "string" || typeof data.organizationId !== "string") return;
        importChanged(queryClient, { importId: data.importId, organizationId: data.organizationId });
      } catch {
        return;
      }
    };
    const onAnnouncements = () => announcementsChanged(queryClient);
    const onMaintenance = () => maintenanceChanged(queryClient);
    source.addEventListener("notifications", onChange);
    source.addEventListener("announcements", onAnnouncements);
    source.addEventListener("maintenance", onMaintenance);
    source.addEventListener("imports", onImports);
    source.addEventListener("spaces", onSpaces);
    source.addEventListener("changes", onObjects);
    source.addEventListener("settings", onSettings);
    source.addEventListener("syncRuns", onSyncRuns);
    return () => {
      source.removeEventListener("notifications", onChange);
      source.removeEventListener("settings", onSettings);
      source.removeEventListener("syncRuns", onSyncRuns);
      source.removeEventListener("changes", onObjects);
      source.removeEventListener("spaces", onSpaces);
      source.removeEventListener("imports", onImports);
      source.removeEventListener("announcements", onAnnouncements);
      source.removeEventListener("maintenance", onMaintenance);
      if (flush) clearTimeout(flush);
      if (flushSpaces) clearTimeout(flushSpaces);
      source.close();
    };
  }, [enabled, queryClient]);
}
