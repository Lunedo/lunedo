import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { preferenceKeys, type TablePageSize, useUpdatePreference } from "../preferences/preferences.js";
import { usePreferences } from "../preferences/preferences-provider.js";

export function usePageSize(): { pageSize: TablePageSize; setPageSize: (size: number) => void } {
  const preferences = usePreferences();
  const update = useUpdatePreference();
  return {
    pageSize: preferences.tablePageSize,
    setPageSize: (size) => update.mutate({ key: preferenceKeys.tablePageSize, value: size }),
  };
}

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

export function usePaged<T>(rows: readonly T[], fixedSize?: number) {
  const { pageSize, setPageSize } = usePageSize();
  const size = fixedSize ?? pageSize;
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages - 1);
  return {
    rows: rows.slice(current * size, current * size + size),
    reset: () => setPage(0),
    pagination: {
      hasPrevious: current > 0,
      hasNext: current < pages - 1,
      onPrevious: () => setPage(current - 1),
      onNext: () => setPage(current + 1),
      ...(fixedSize === undefined
        ? {
            pageSize: size,
            onPageSizeChange: (next: number) => {
              setPage(0);
              setPageSize(next);
            },
          }
        : {}),
    },
  };
}

export interface ServerPage<T> {
  items: T[];
  nextCursor: string | null;
}

export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useServerTable<T>(
  key: readonly unknown[],
  fetchPage: (search: string, cursor: string | null, limit: number) => Promise<ServerPage<T>>,
) {
  const { pageSize, setPageSize } = usePageSize();
  const [search, setSearchValue] = useState("");
  const query = useDebounced(search.trim());
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors.at(-1) ?? null;
  const result = useQuery({
    queryKey: [...key, "page", query, cursor, pageSize],
    queryFn: () => fetchPage(query, cursor, pageSize),
    placeholderData: keepPreviousData,
    throwOnError: false,
  });
  const setSearch = (value: string) => {
    setSearchValue(value);
    setCursors([null]);
  };
  const nextCursor = result.data?.nextCursor ?? null;
  return {
    rows: result.data?.items ?? [],
    query: result,
    search: { value: search, onChange: setSearch },
    pagination: {
      hasPrevious: cursors.length > 1,
      hasNext: nextCursor !== null,
      onPrevious: () => setCursors((current) => current.slice(0, -1)),
      onNext: () => {
        if (nextCursor) setCursors((current) => [...current, nextCursor]);
      },
      pageSize,
      onPageSizeChange: (next: number) => {
        setCursors([null]);
        setPageSize(next);
      },
    },
    reset: () => setCursors([null]),
  };
}
