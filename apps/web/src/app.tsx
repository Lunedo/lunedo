import { ToastProvider, TooltipProvider, type UiLabels, UiProvider } from "@lunedo/ui";
import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import type { i18n } from "i18next";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { I18nextProvider, useTranslation } from "react-i18next";
import { createQueryClient } from "./api/query-client.js";
import { createAppRouter } from "./router.js";

function TranslatedUi({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const labels = useMemo<UiLabels>(
    () => ({
      close: t("ui.close"),
      sortAscending: t("ui.sortAscending"),
      sortDescending: t("ui.sortDescending"),
      notSorted: t("ui.notSorted"),
      previousPage: t("ui.previousPage"),
      nextPage: t("ui.nextPage"),
      loading: t("ui.loading"),
      dismiss: t("ui.dismiss"),
      showPassword: t("ui.showPassword"),
      hidePassword: t("ui.hidePassword"),
      clear: t("ui.clear"),
      required: t("ui.required"),
      optional: t("ui.optional"),
      page: t("ui.page"),
      breadcrumbs: t("ui.breadcrumbs"),
      notifications: t("ui.notifications"),
      decrease: t("ui.decrease"),
      increase: t("ui.increase"),
      resetToDefault: t("ui.resetToDefault"),
      saving: t("ui.saving"),
      saved: t("ui.saved"),
      retry: t("ui.retry"),
      copy: t("ui.copy"),
      copied: t("ui.copied"),
      documentation: t("ui.documentation"),
      durationUnit: t("ui.durationUnit"),
      minutes: t("ui.minutes"),
      hours: t("ui.hours"),
      days: t("ui.days"),
      defaultMarker: t("ui.defaultMarker"),
      custom: t("ui.custom"),
      apply: t("ui.apply"),
      cancel: t("ui.cancel"),
      durationRange: t("ui.durationRange", { minimum: "{minimum}", maximum: "{maximum}" }),
      noMatches: t("ui.noMatches"),
      loadMore: t("ui.loadMore"),
      removeItem: t("ui.removeItem", { item: "{item}" }),
      search: t("ui.search"),
      resetFilters: t("ui.resetFilters"),
      suggested: t("ui.suggested"),
      allTimeZones: t("ui.allTimeZones"),
      browserTimeZone: t("ui.browserTimeZone"),
      undo: t("ui.undo"),
      secondsLeft: t("ui.secondsLeft", { seconds: "{seconds}" }),
    }),
    [t],
  );
  return (
    <UiProvider labels={labels}>
      <TooltipProvider>
        <ToastProvider>{children}</ToastProvider>
      </TooltipProvider>
    </UiProvider>
  );
}

export function App({ i18n, queryClient: providedClient }: { i18n: i18n; queryClient?: QueryClient }) {
  const [queryClient] = useState(() => providedClient ?? createQueryClient());
  const [router] = useState(() => createAppRouter(queryClient));
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) void queryClient.invalidateQueries();
    };
    globalThis.addEventListener("pageshow", restored);
    return () => globalThis.removeEventListener("pageshow", restored);
  }, [queryClient]);
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <TranslatedUi>
          <RouterProvider router={router} />
        </TranslatedUi>
      </QueryClientProvider>
    </I18nextProvider>
  );
}
export { createQueryClient };
