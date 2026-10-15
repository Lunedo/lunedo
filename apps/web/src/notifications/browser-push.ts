import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { onSignOut } from "../session/sign-out.js";
import { watchKeys } from "./watching-api.js";

const WORKER = "/push-worker.js";

export const pushKeys = { status: ["notifications", "push"] as const };

export class PushPermissionError extends Error {
  override name = "PushPermissionError";
  readonly permission: NotificationPermission;

  constructor(permission: NotificationPermission) {
    super(`The browser answered ${permission}`);
    this.permission = permission;
  }
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "="));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function localSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration("/");
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export async function forgetLocalSubscription(): Promise<void> {
  const subscription = await localSubscription().catch(() => null);
  await subscription?.unsubscribe().catch(() => false);
}

onSignOut(() => void forgetLocalSubscription());

async function subscribe(publicKey: string) {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new PushPermissionError(permission);
  await navigator.serviceWorker.register(WORKER, { scope: "/" });
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  await existing?.unsubscribe();
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(publicKey),
  });
  const json = subscription.toJSON();
  return request(() =>
    api.POST("/api/v1/account/push/devices", {
      body: {
        endpoint: subscription.endpoint,
        keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
      },
    }),
  );
}

export function usePushStatus() {
  return useQuery({
    queryKey: pushKeys.status,
    queryFn: () => request(() => api.GET("/api/v1/account/push")),
    throwOnError: false,
  });
}

export type PushDevice = NonNullable<ReturnType<typeof usePushStatus>["data"]>["devices"][number];

export function useEnablePush() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (publicKey: string) => subscribe(publicKey),
    onSettled: () => queryClient.invalidateQueries({ queryKey: pushKeys.status }),
  });
}

export function useRemovePushDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (device: PushDevice) => {
      if (device.current) await forgetLocalSubscription();
      await request(() =>
        api.DELETE("/api/v1/account/push/devices/{deviceId}", { params: { path: { deviceId: device.id } } }),
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: pushKeys.status });
      void queryClient.invalidateQueries({ queryKey: watchKeys.delivery });
    },
  });
}
