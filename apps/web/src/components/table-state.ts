import { useMemo, useState } from "react";

export interface SortState {
  key: string;
  direction: "asc" | "desc";
}

export function useSorted<T>(
  rows: readonly T[],
  initial: SortState,
  value: (row: T, key: string) => string | number,
): { rows: T[]; sort: SortState; setSort: (sort: SortState) => void } {
  const [sort, setSort] = useState<SortState>(initial);
  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((left, right) => {
      const a = value(left, sort.key);
      const b = value(right, sort.key);
      const order =
        typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
      return sort.direction === "asc" ? order : -order;
    });
    return copy;
  }, [rows, sort, value]);
  return { rows: sorted, sort, setSort };
}

export function usePaged<T>(rows: readonly T[], size: number) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages - 1);
  return {
    rows: rows.slice(current * size, current * size + size),
    reset: () => setPage(0),
    pagination:
      rows.length > size
        ? {
            hasPrevious: current > 0,
            hasNext: current < pages - 1,
            onPrevious: () => setPage(current - 1),
            onNext: () => setPage(current + 1),
          }
        : undefined,
  };
}
