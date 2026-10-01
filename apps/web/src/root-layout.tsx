import { useQueryClient } from "@tanstack/react-query";
import { Outlet, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { setSignedOutHandler } from "./api/request.js";
import { PreferencesProvider } from "./preferences/preferences-provider.js";
import { ReauthenticationHost } from "./session/reauthentication.js";
import { currentLocation } from "./session/redirect.js";

const PUBLIC_PATHS = [
  "/sign-in",
  "/setup",
  "/reset-password",
  "/confirm-email",
  "/accept-invitation",
  "/register",
  "/complete-registration",
];

export function RootLayout() {
  const router = useRouter();
  const queryClient = useQueryClient();

  useEffect(() => {
    setSignedOutHandler(() => {
      const path = globalThis.location?.pathname ?? "/";
      if (PUBLIC_PATHS.some((prefix) => path.startsWith(prefix))) return;
      const redirect = currentLocation();
      queryClient.clear();
      void router.navigate({ to: "/sign-in", search: { redirect, reason: "sessionEnded" } });
    });
    return () => setSignedOutHandler(null);
  }, [router, queryClient]);

  return (
    <PreferencesProvider>
      <Outlet />
      <ReauthenticationHost />
    </PreferencesProvider>
  );
}
