import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useReducer, useState } from "react";

export function reportKey(value: unknown): string {
  let hash = 0x811c9dc5;
  for (const character of JSON.stringify(value)) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

function pagesOf(search: unknown): Record<string, number> {
  const reports = (search as { reports?: unknown } | null)?.reports;
  return reports !== null && typeof reports === "object" ? (reports as Record<string, number>) : {};
}

export function useReportPage(key: string): [number, (page: number) => void] {
  const router = useRouter({ warn: false });
  const [local, setLocal] = useState(1);
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  useEffect(() => router?.subscribe("onResolved", refresh), [router]);
  const page = router ? (pagesOf(router.state.location.search)[key] ?? 1) : local;
  const setPage = useCallback(
    (next: number) => {
      if (!router) {
        setLocal(next);
        return;
      }
      const current = pagesOf(router.state.location.search);
      if ((current[key] ?? 1) === next) return;
      const reports = { ...current };
      if (next > 1) reports[key] = next;
      else delete reports[key];
      void router.navigate({
        to: ".",
        search: (previous: Record<string, unknown>) => ({
          ...previous,
          reports: Object.keys(reports).length > 0 ? reports : undefined,
        }),
        resetScroll: false,
      });
    },
    [router, key],
  );
  return [page, setPage];
}
