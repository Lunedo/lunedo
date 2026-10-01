import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import type { Key, ReactNode } from "react";
import { IconButton } from "./button.js";
import { classNames } from "./class-names.js";
import { SkeletonText } from "./feedback.js";
import { Icon } from "./icon.js";
import { useUiLabels } from "./labels.js";

export type SortDirection = "asc" | "desc";

export interface TableSort {
  key: string;
  direction: SortDirection;
}

export interface TableColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  sortable?: boolean;
  align?: "start" | "end";
  hideBelow?: "sm" | "md";
}

export interface TablePagination {
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

export interface TableProps<T> {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => Key;
  caption: string;
  sort?: TableSort;
  onSortChange?: (sort: TableSort) => void;
  empty?: ReactNode;
  loading?: boolean;
  pagination?: TablePagination;
  onRowClick?: (row: T) => void;
}

const HIDDEN: Record<"sm" | "md", string> = {
  sm: "hidden sm:table-cell",
  md: "hidden md:table-cell",
};

function ariaSort(sort: TableSort | undefined, key: string): "ascending" | "descending" | "none" {
  if (sort?.key !== key) return "none";
  return sort.direction === "asc" ? "ascending" : "descending";
}

export function Table<T>({
  columns,
  rows,
  rowKey,
  caption,
  sort,
  onSortChange,
  empty,
  loading = false,
  pagination,
  onRowClick,
}: TableProps<T>) {
  const labels = useUiLabels();
  const cellClass = (column: TableColumn<T>) =>
    classNames(
      "px-4",
      column.align === "end" ? "text-right" : "text-left",
      column.hideBelow && HIDDEN[column.hideBelow],
    );
  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse" aria-busy={loading || undefined}>
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-surface-sunken">
            <tr>
              {columns.map((column) => {
                const state = ariaSort(sort, column.key);
                const next: SortDirection = state === "ascending" ? "desc" : "asc";
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={column.sortable ? state : undefined}
                    className={classNames(
                      cellClass(column),
                      "h-control-field border-b border-border text-sm font-semibold whitespace-nowrap text-text-muted",
                    )}
                  >
                    {column.sortable && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => onSortChange({ key: column.key, direction: next })}
                        className="-mx-1 inline-flex items-center gap-1 rounded-sm px-1 hover:text-text focus-visible:focus-ring"
                      >
                        {column.header}
                        <Icon
                          size="sm"
                          icon={
                            state === "ascending"
                              ? ArrowUp
                              : state === "descending"
                                ? ArrowDown
                                : ChevronsUpDown
                          }
                        />
                        <span className="sr-only">
                          {next === "asc" ? labels.sortAscending : labels.sortDescending}
                        </span>
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="p-4">
                  <span className="sr-only">{labels.loading}</span>
                  <SkeletonText lines={3} />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="p-4 text-text-muted">
                  {empty}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={rowKey(row)}
                  className={classNames(
                    "border-b border-border last:border-b-0",
                    onRowClick && "cursor-pointer hover:bg-hover",
                  )}
                  {...(onRowClick ? { onClick: () => onRowClick(row) } : {})}
                >
                  {columns.map((column) => (
                    <td key={column.key} className={classNames(cellClass(column), "py-2 align-middle")}>
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {pagination && (pagination.hasPrevious || pagination.hasNext) && (
        <nav aria-label={labels.page} className="flex justify-end gap-2">
          <IconButton
            label={labels.previousPage}
            icon={ChevronLeft}
            variant="outline"
            disabled={!pagination.hasPrevious}
            onClick={pagination.onPrevious}
          />
          <IconButton
            label={labels.nextPage}
            icon={ChevronRight}
            variant="outline"
            disabled={!pagination.hasNext}
            onClick={pagination.onNext}
          />
        </nav>
      )}
    </div>
  );
}
