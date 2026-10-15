import type { WatchState } from "@pagehall/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client.js";
import { request } from "../api/request.js";

export type WatchTarget = { type: "item"; id: string } | { type: "space"; id: string };

export const watchKeys = {
  all: ["watches"] as const,
  status: (target: WatchTarget) => ["watches", target.type, target.id] as const,
  list: ["watches", "list"] as const,
  delivery: ["notifications", "delivery"] as const,
};

function fetchStatus(target: WatchTarget) {
  return target.type === "item"
    ? request(() => api.GET("/api/v1/items/{itemId}/watch", { params: { path: { itemId: target.id } } }))
    : request(() => api.GET("/api/v1/spaces/{spaceId}/watch", { params: { path: { spaceId: target.id } } }));
}

export type WatchStatus = Awaited<ReturnType<typeof fetchStatus>>;

export function useWatchStatus(target: WatchTarget) {
  return useQuery({
    queryKey: watchKeys.status(target),
    queryFn: () => fetchStatus(target),
    throwOnError: false,
  });
}

export interface WatchChange {
  state: WatchState | null;
  keepActionable?: boolean;
}

export function changeWatch(target: WatchTarget, change: WatchChange) {
  if (change.state === null) {
    return target.type === "item"
      ? request(() => api.DELETE("/api/v1/items/{itemId}/watch", { params: { path: { itemId: target.id } } }))
      : request(() =>
          api.DELETE("/api/v1/spaces/{spaceId}/watch", { params: { path: { spaceId: target.id } } }),
        );
  }
  const body = {
    state: change.state,
    ...(change.keepActionable === undefined ? {} : { keepActionable: change.keepActionable }),
  };
  return target.type === "item"
    ? request(() =>
        api.PUT("/api/v1/items/{itemId}/watch", { params: { path: { itemId: target.id } }, body }),
      )
    : request(() =>
        api.PUT("/api/v1/spaces/{spaceId}/watch", { params: { path: { spaceId: target.id } }, body }),
      );
}

export function useChangeWatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ target, change }: { target: WatchTarget; change: WatchChange }) =>
      changeWatch(target, change),
    onSuccess: (status, { target }) => queryClient.setQueryData(watchKeys.status(target), status),
    onSettled: () => queryClient.invalidateQueries({ queryKey: watchKeys.all }),
  });
}

export function useWatchedList() {
  return useQuery({
    queryKey: watchKeys.list,
    queryFn: () => request(() => api.GET("/api/v1/account/watches")),
    throwOnError: false,
  });
}

export type WatchedEntry = NonNullable<ReturnType<typeof useWatchedList>["data"]>["items"][number];

export function useNotificationDelivery() {
  return useQuery({
    queryKey: watchKeys.delivery,
    queryFn: () => request(() => api.GET("/api/v1/account/notification-delivery")),
    staleTime: 60_000,
    throwOnError: false,
  });
}
