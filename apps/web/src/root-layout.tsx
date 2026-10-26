import { useQueryClient } from "@tanstack/react-query";
import { Outlet, useLocation, useRouter } from "@tanstack/react-router";
import { useEffect, useLayoutEffect } from "react";
import { useMaintenanceUpdates } from "./api/maintenance.js";
import { setSignedOutHandler } from "./api/request.js";
import { PreferencesProvider } from "./preferences/preferences-provider.js";
import { ReauthenticationHost } from "./session/reauthentication.js";
import { currentLocation } from "./session/redirect.js";
import { signedOut } from "./session/sign-out.js";
import { InstanceMovedGuard } from "./shell/instance-moved.js";

const PUBLIC_PATHS = [
  "/sign-in",
  "/setup",
  "/reset-password",
  "/confirm-email",
  "/accept-invitation",
  "/register",
  "/complete-registration",
  "/s/",
];

export function RootLayout() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const location = useLocation();
  useMaintenanceUpdates();
  useLayoutEffect(() => document.getElementById("boot-shell")?.remove(), []);

  useEffect(() => {
    setSignedOutHandler(() => {
      const path = globalThis.location?.pathname ?? "/";
      if (PUBLIC_PATHS.some((prefix) => path.startsWith(prefix))) return;
      const redirect = currentLocation();
      signedOut();
      queryClient.clear();
      void router.navigate({ to: "/sign-in", search: { redirect, reason: "sessionEnded" } });
    });
    return () => setSignedOutHandler(null);
  }, [router, queryClient]);

  if (location.pathname.startsWith("/dev/")) return <Outlet />;

  return (
    <PreferencesProvider>
      <InstanceMovedGuard>
        <Outlet />
        <ReauthenticationHost />
      </InstanceMovedGuard>
    </PreferencesProvider>
  );
}
