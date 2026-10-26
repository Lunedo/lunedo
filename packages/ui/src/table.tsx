import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  RotateCcw,
  Search,
} from "lucide-react";
import { Fragment, type Key, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Button, IconButton } from "./button.js";
import { classNames } from "./class-names.js";
import { Checkbox, Select } from "./controls.js";
import { SkeletonText } from "./feedback.js";
import { controlClassName } from "./field.js";
import { WIDE_HIT_AREA } from "./hit-area.js";
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
  sticky?: boolean;
  grow?: boolean;
}

export interface TablePagination {
  hasPrevious: boolean;
  hasNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
  pageSize?: number;
  pageSizes?: readonly number[];
  onPageSizeChange?: (size: number) => void;
}

export interface TableGroup {
  key: string;
  label: ReactNode;
  count?: number;
}

export interface TableSelection<T> {
  selected: ReadonlySet<Key>;
  onChange: (selected: Set<Key>) => void;
  rowLabel: (row: T) => string;
  bulkBar?: (selected: ReadonlySet<Key>) => ReactNode;
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
  groupOf?: (row: T) => TableGroup;
  selection?: TableSelection<T>;
  framed?: boolean;
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
  sm: "hidden @card:table-cell",
  md: "hidden @column:table-cell",
};

function ariaSort(sort: TableSort | undefined, key: string): "ascending" | "descending" | "none" {
  if (sort?.key !== key) return "none";
  return sort.direction === "asc" ? "ascending" : "descending";
}

export const PAGE_SIZES = [25, 50, 100] as const;

function hasPages(pagination: TablePagination | undefined): pagination is TablePagination {
  return pagination !== undefined && (pagination.hasPrevious || pagination.hasNext);
}

export function TablePager({ pagination }: { pagination: TablePagination }) {
  const labels = useUiLabels();
  const sizes = pagination.pageSizes ?? PAGE_SIZES;
  return (
    <nav
      aria-label={labels.page}
      data-table-pager=""
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border bg-sidebar px-3 py-2 text-sm text-text-muted"
    >
      {pagination.onPageSizeChange && pagination.pageSize !== undefined ? (
        <span className="flex items-center gap-2">
          <span aria-hidden="true" className="whitespace-nowrap">
            {labels.rowsPerPage}
          </span>
          <Select
            aria-label={labels.rowsPerPage}
            value={String(pagination.pageSize)}
            options={sizes.map((size) => ({ value: String(size), label: String(size) }))}
            onValueChange={(value) => pagination.onPageSizeChange?.(Number(value))}
            className="w-auto"
          />
        </span>
      ) : null}
      <span className="ml-auto flex gap-2">
        <Button
          variant="outline"
          size="sm"
          icon={ChevronLeft}
          onClick={pagination.onPrevious}
          disabled={!pagination.hasPrevious}
        >
          {labels.previous}
        </Button>
        <Button variant="outline" size="sm" onClick={pagination.onNext} disabled={!pagination.hasNext}>
          {labels.next}
          <Icon icon={ChevronRight} size="sm" />
        </Button>
      </span>
    </nav>
  );
}

export function TablePageArrows({ pagination }: { pagination: TablePagination }) {
  const labels = useUiLabels();
  if (!hasPages(pagination)) return null;
  return (
    <span data-table-arrows="" className="flex items-center gap-1">
      <IconButton
        label={labels.previousPage}
        icon={ChevronLeft}
        variant="outline"
        size="sm"
        disabled={!pagination.hasPrevious}
        onClick={pagination.onPrevious}
      />
      <IconButton
        label={labels.nextPage}
        icon={ChevronRight}
        variant="outline"
        size="sm"
        disabled={!pagination.hasNext}
        onClick={pagination.onNext}
      />
    </span>
  );
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
  groupOf,
  selection,
  framed = true,
}: TableProps<T>) {
  const labels = useUiLabels();
  const keys = rows.map(rowKey);
  const selectedHere = selection ? keys.filter((key) => selection.selected.has(key)).length : 0;
  const allSelected = keys.length > 0 && selectedHere === keys.length;
  const span = columns.length + (selection ? 1 : 0);
  const cellClass = (column: TableColumn<T>) =>
    classNames(
      "px-3",
      !selection && "first:pl-3",
      column.align === "end" ? "text-right" : "text-left",
      column.hideBelow && HIDDEN[column.hideBelow],
      column.sticky && "sticky right-0",
      column.grow && "@card:w-full @card:max-w-0",
    );
  const toggle = (key: Key, on: boolean) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (on) next.add(key);
    else next.delete(key);
    selection.onChange(next);
  };
  const toggleAll = (on: boolean) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    for (const key of keys) {
      if (on) next.add(key);
      else next.delete(key);
    }
    selection.onChange(next);
  };
  const bulk =
    selection?.bulkBar && selection.selected.size > 0 ? selection.bulkBar(selection.selected) : null;
  const showPager =
    pagination !== undefined &&
    (pagination.hasPrevious ||
      pagination.hasNext ||
      (pagination.onPageSizeChange !== undefined &&
        rows.length >= Math.min(...(pagination.pageSizes ?? PAGE_SIZES))));
  return (
    <div
      data-table-frame=""
      className={classNames(
        "@container flex flex-col",
        framed ? "rounded-lg border border-border max-sm:overflow-x-auto sm:overflow-x-clip" : "overflow-x-auto",
      )}
    >
      {bulk ? (
        <section
          data-table-bulk=""
          aria-label={labels.selection}
          className="flex min-h-control-lg flex-wrap items-center gap-2 border-b border-border bg-accent-soft px-3 py-1 font-semibold text-accent"
        >
          {bulk}
        </section>
      ) : null}
      <table className="w-full border-separate border-spacing-0" aria-busy={loading || undefined}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {selection ? (
              <th
                scope="col"
                className="sticky top-0 z-10 h-control-field w-control-lg border-b border-border bg-sidebar pl-3"
              >
                <Checkbox
                  aria-label={labels.selectAll}
                  checked={allSelected ? true : selectedHere > 0 ? "mixed" : false}
                  disabled={keys.length === 0}
                  onCheckedChange={toggleAll}
                />
              </th>
            ) : null}
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
                    "sticky top-0 z-10 h-control-field border-b border-border bg-sidebar text-xs font-medium whitespace-nowrap text-text-muted",
                  )}
                >
                  {column.sortable && onSortChange ? (
                    <button
                      type="button"
                      onClick={() => onSortChange({ key: column.key, direction: next })}
                      className={classNames(
                        WIDE_HIT_AREA,
                        "-mx-1 inline-flex items-center gap-1 rounded-sm px-1 hover:text-text focus-visible:focus-ring",
                      )}
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
              <td colSpan={span} className="p-4">
                <span className="sr-only">{labels.loading}</span>
                <SkeletonText lines={3} />
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={span} className="p-4 text-text-muted">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row, index) => {
              const key = rowKey(row);
              const group = groupOf?.(row);
              const previous = index > 0 ? rows[index - 1] : undefined;
              const startsGroup =
                group !== undefined && (previous === undefined || groupOf?.(previous).key !== group.key);
              const selected = selection?.selected.has(key) ?? false;
              const last = index === rows.length - 1;
              const border = last ? "" : "border-b border-border";
              return (
                <Fragment key={key}>
                  {startsGroup ? (
                    <tr data-table-group={group.key}>
                      <th
                        scope="colgroup"
                        colSpan={span}
                        className="border-b border-border px-3 pt-4 pb-2 text-left text-xs font-semibold tracking-label text-text-muted uppercase"
                      >
                        {group.label}
                        {group.count !== undefined ? (
                          <span className="ml-2 font-normal tabular-nums">{group.count}</span>
                        ) : null}
                      </th>
                    </tr>
                  ) : null}
                  <tr
                    data-selected={selected || undefined}
                    className={classNames(
                      "group/row hover:bg-hover data-selected:bg-selected",
                      onRowClick && "cursor-pointer focus-visible:bg-hover focus-visible:focus-ring",
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
                    {selection ? (
                      <td className={classNames("h-control-lg w-control-lg pl-3 align-middle", border)}>
                        <Checkbox
                          aria-label={selection.rowLabel(row)}
                          checked={selected}
                          onCheckedChange={(on) => toggle(key, on)}
                        />
                      </td>
                    ) : null}
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={classNames(
                          cellClass(column),
                          "h-control-lg py-1 align-middle",
                          border,
                          column.sticky && "bg-inherit",
                        )}
                      >
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
      {pagination && showPager ? <TablePager pagination={pagination} /> : null}
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
  pagination?: TablePagination | undefined;
}

export function TableToolbar({
  search,
  filters,
  filtersActive,
  onResetFilters,
  actions,
  pagination,
}: TableToolbarProps) {
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
      {actions || pagination ? (
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {pagination ? <TablePageArrows pagination={pagination} /> : null}
        </div>
      ) : null}
    </div>
  );
}
