import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  RotateCcw,
  Search,
} from "lucide-react";
import type { Key, KeyboardEvent, MouseEvent, ReactNode } from "react";
import { Button, IconButton } from "./button.js";
import { classNames } from "./class-names.js";
import { SkeletonText } from "./feedback.js";
import { controlClassName } from "./field.js";
import { Icon } from "./icon.js";
import { useUiLabels } from "./labels.js";
import { ScrollArea } from "./scroll-area.js";

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
  sticky?: boolean;
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
  rowLabel?: (row: T) => string;
}

const CONTROLS = "a, button, input, select, textarea, label, [role=menuitem], [role=checkbox], [role=switch]";

function fromControl(target: EventTarget, row: HTMLElement): boolean {
  const element = target as Partial<Element>;
  if (typeof element.closest !== "function") return false;
  if (!row.contains(target as Node)) return true;
  const control = element.closest(CONTROLS);
  return control !== null && row.contains(control);
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
  rowLabel,
}: TableProps<T>) {
  const labels = useUiLabels();
  const cellClass = (column: TableColumn<T>) =>
    classNames(
      "px-4",
      column.align === "end" ? "text-right" : "text-left",
      column.hideBelow && HIDDEN[column.hideBelow],
      column.sticky && "sticky right-0",
    );
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-md border border-border">
        <ScrollArea label={caption}>
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
                        column.sticky && "bg-surface-sunken",
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
                      "border-b border-border bg-surface last:border-b-0",
                      onRowClick &&
                        "cursor-pointer hover:bg-hover focus-visible:bg-hover focus-visible:focus-ring",
                    )}
                    {...(onRowClick
                      ? {
                          tabIndex: 0,
                          "data-row-action": "",
                          ...(rowLabel ? { "aria-label": rowLabel(row) } : {}),
                          onClick: (event: MouseEvent<HTMLTableRowElement>) => {
                            if (fromControl(event.target, event.currentTarget)) return;
                            onRowClick(row);
                          },
                          onKeyDown: (event: KeyboardEvent<HTMLTableRowElement>) => {
                            if (event.target !== event.currentTarget) return;
                            if (event.key !== "Enter" && event.key !== " ") return;
                            event.preventDefault();
                            onRowClick(row);
                          },
                        }
                      : {})}
                  >
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={classNames(
                          cellClass(column),
                          "py-2 align-middle",
                          column.sticky && "bg-inherit",
                        )}
                      >
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollArea>
      </div>
      {pagination && (pagination.hasPrevious || pagination.hasNext) && (
        <nav aria-label={labels.page} className="flex justify-end gap-2">
          {pagination.hasPrevious && (
            <IconButton
              label={labels.previousPage}
              icon={ChevronLeft}
              variant="outline"
              onClick={pagination.onPrevious}
            />
          )}
          {pagination.hasNext && (
            <IconButton
              label={labels.nextPage}
              icon={ChevronRight}
              variant="outline"
              onClick={pagination.onNext}
            />
          )}
        </nav>
      )}
    </div>
  );
}

export interface TableToolbarProps {
  search?: {
    value: string;
    onChange: (value: string) => void;
    label?: string;
    placeholder?: string;
  };
  filters?: ReactNode;
  filtersActive?: boolean;
  onResetFilters?: () => void;
  actions?: ReactNode;
}

export function TableToolbar({ search, filters, filtersActive, onResetFilters, actions }: TableToolbarProps) {
  const labels = useUiLabels();
  return (
    <div data-table-toolbar="" className="flex flex-wrap items-center gap-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {search ? (
          <div className="relative w-full sm:w-field">
            <Icon
              icon={Search}
              className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-text-muted"
            />
            <input
              type="search"
              value={search.value}
              aria-label={search.label ?? labels.search}
              placeholder={search.placeholder ?? labels.search}
              onChange={(event) => search.onChange(event.target.value)}
              className={classNames(controlClassName, "h-control-field pl-8")}
            />
          </div>
        ) : null}
        {filters}
        {filtersActive && onResetFilters ? (
          <Button variant="secondary" size="sm" icon={RotateCcw} onClick={onResetFilters}>
            {labels.resetFilters}
          </Button>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
