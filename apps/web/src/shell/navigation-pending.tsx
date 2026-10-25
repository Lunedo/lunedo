import { Skeleton } from "@lunedo/ui";
import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export const PROGRESS_DELAY_MS = 150;
export const PENDING_MS = 600;
export const PENDING_MIN_MS = 300;

const LINES = ["w-3/4", "w-2/3", "w-5/6", "w-1/2", "w-3/4", "w-2/3"];

export function NavigationProgress() {
  const { t } = useTranslation();
  const pending = useRouterState({ select: (state) => state.status === "pending" });
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!pending) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), PROGRESS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pending]);
  if (!shown) return null;
  return (
    <div
      role="progressbar"
      aria-label={t("navigation.loadingScreen")}
      data-navigation-progress=""
      className="pointer-events-none absolute inset-x-0 top-0 z-10 h-1 overflow-hidden bg-surface-sunken"
    >
      <div className="h-full w-full animate-pulse bg-accent motion-reduce:animate-none" />
    </div>
  );
}

export function ContentPending({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <main
      id="main"
      aria-busy="true"
      aria-label={label ?? t("navigation.loadingScreen")}
      data-content-pending=""
      className="min-w-0 flex-1 overflow-hidden"
    >
      <div aria-hidden="true" className="mx-auto flex w-full max-w-content flex-col gap-3 px-4 pt-6 md:px-8">
        <Skeleton className="h-control w-1/3" />
        <Skeleton className="h-3 w-1/4" />
        <div className="flex flex-col gap-3 pt-4">
          {LINES.map((width, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity besides their position
            <Skeleton key={index} className={width} />
          ))}
        </div>
      </div>
    </main>
  );
}

export function PagePending() {
  return <div aria-busy="true" className="h-full bg-bg" />;
}

const withoutTrailingSlash = (path: string) => (path.length > 1 ? path.replace(/\/$/, "") : path);

export function useShownLocation() {
  return useRouterState({
    select: (state) => {
      const shown = state.matches.at(-1)?.pathname;
      if (
        shown !== undefined &&
        withoutTrailingSlash(shown) === withoutTrailingSlash(state.location.pathname)
      ) {
        return state.location;
      }
      return state.resolvedLocation ?? state.location;
    },
  });
}
