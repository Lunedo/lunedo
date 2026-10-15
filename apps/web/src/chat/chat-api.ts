import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client.js";
import type { paths } from "../api/generated/schema.js";
import { request } from "../api/request.js";

export type ChatOwner = { kind: "space"; spaceId: string } | { kind: "organization"; organizationId: string };

type Channels = paths["/api/v1/spaces/{spaceId}/chat-channels"];
type Channel = paths["/api/v1/spaces/{spaceId}/chat-channels/{channelId}"];

export type ChatChannelInput = NonNullable<Channels["post"]["requestBody"]>["content"]["application/json"];
export type ChatChannelChange = NonNullable<Channel["patch"]["requestBody"]>["content"]["application/json"];
export type ChatEventName = ChatChannelInput["events"][number];
export type ChatTarget = ChatChannelInput["target"];

export const chatKeys = {
  list: (owner: ChatOwner) =>
    ["chatChannels", owner.kind, owner.kind === "space" ? owner.spaceId : owner.organizationId] as const,
};

function listChannels(owner: ChatOwner) {
  return owner.kind === "space"
    ? request(() =>
        api.GET("/api/v1/spaces/{spaceId}/chat-channels", { params: { path: { spaceId: owner.spaceId } } }),
      )
    : request(() =>
        api.GET("/api/v1/organizations/{organizationId}/chat-channels", {
          params: { path: { organizationId: owner.organizationId } },
        }),
      );
}

export type ChatChannel = Awaited<ReturnType<typeof listChannels>>["items"][number];

export function useChatChannels(owner: ChatOwner, enabled = true) {
  return useQuery({
    queryKey: chatKeys.list(owner),
    queryFn: () => listChannels(owner),
    enabled,
    throwOnError: false,
  });
}

export function createChannel(owner: ChatOwner, input: ChatChannelInput) {
  const body = input;
  return owner.kind === "space"
    ? request(() =>
        api.POST("/api/v1/spaces/{spaceId}/chat-channels", {
          params: { path: { spaceId: owner.spaceId } },
          body,
        }),
      )
    : request(() =>
        api.POST("/api/v1/organizations/{organizationId}/chat-channels", {
          params: { path: { organizationId: owner.organizationId } },
          body,
        }),
      );
}

export function updateChannel(owner: ChatOwner, channelId: string, change: ChatChannelChange) {
  const body = change;
  return owner.kind === "space"
    ? request(() =>
        api.PATCH("/api/v1/spaces/{spaceId}/chat-channels/{channelId}", {
          params: { path: { spaceId: owner.spaceId, channelId } },
          body,
        }),
      )
    : request(() =>
        api.PATCH("/api/v1/organizations/{organizationId}/chat-channels/{channelId}", {
          params: { path: { organizationId: owner.organizationId, channelId } },
          body,
        }),
      );
}

export function testUnsaved(owner: ChatOwner, input: ChatChannelInput) {
  const body = input;
  return owner.kind === "space"
    ? request(() =>
        api.POST("/api/v1/spaces/{spaceId}/chat-channels/test", {
          params: { path: { spaceId: owner.spaceId } },
          body,
        }),
      )
    : request(() =>
        api.POST("/api/v1/organizations/{organizationId}/chat-channels/test", {
          params: { path: { organizationId: owner.organizationId } },
          body,
        }),
      );
}

export function testSaved(owner: ChatOwner, channelId: string) {
  return owner.kind === "space"
    ? request(() =>
        api.POST("/api/v1/spaces/{spaceId}/chat-channels/{channelId}/test", {
          params: { path: { spaceId: owner.spaceId, channelId } },
        }),
      )
    : request(() =>
        api.POST("/api/v1/organizations/{organizationId}/chat-channels/{channelId}/test", {
          params: { path: { organizationId: owner.organizationId, channelId } },
        }),
      );
}

export type ChatTestResult = Awaited<ReturnType<typeof testSaved>>;

export function removeChannel(owner: ChatOwner, channelId: string) {
  return owner.kind === "space"
    ? request(() =>
        api.DELETE("/api/v1/spaces/{spaceId}/chat-channels/{channelId}", {
          params: { path: { spaceId: owner.spaceId, channelId } },
        }),
      )
    : request(() =>
        api.DELETE("/api/v1/organizations/{organizationId}/chat-channels/{channelId}", {
          params: { path: { organizationId: owner.organizationId, channelId } },
        }),
      );
}

export function useRefreshChannels(owner: ChatOwner) {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: chatKeys.list(owner) });
}

export function useTestSaved(owner: ChatOwner) {
  const refresh = useRefreshChannels(owner);
  return useMutation({
    mutationFn: (channelId: string) => testSaved(owner, channelId),
    onSettled: () => refresh(),
  });
}
