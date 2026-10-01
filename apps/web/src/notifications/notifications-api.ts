import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "../api/client.js";
import { request } from "../api/request.js";

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
    source.addEventListener("notifications", onChange);
    return () => {
      source.removeEventListener("notifications", onChange);
      source.close();
    };
  }, [enabled, queryClient]);
}
