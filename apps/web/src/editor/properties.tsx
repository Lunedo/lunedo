import {
  DEFAULT_PROPERTIES_REPORT_PAGE_SIZE,
  MAX_FILTER_SPACES,
  MAX_PROPERTIES_REPORT_COLUMNS,
  MAX_PROPERTIES_REPORT_PAGE_SIZE,
  MAX_PROPERTY_KEY_LENGTH,
  MAX_PROPERTY_SET_ID_LENGTH,
  type NodeJson,
  type PropertiesReportRequest,
} from "@pagehall/editor-schema";
import {
  Checkbox,
  Combobox,
  type ComboboxItem,
  Field,
  IconButton,
  Input,
  Notice,
  Select,
  SkeletonText,
  Table,
  type TableSort,
} from "@pagehall/ui";
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { NodeViewContent, type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { ListPlus, Table2, TableProperties, Trash2 } from "lucide-react";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { LoadError } from "../errors/failure.js";
import { useEditable, useOpenPath, usePageContext } from "./context.js";
import type { References } from "./references.js";
import { RenderedBlocks } from "./rendered-blocks.js";
import { reportKey, useReportPage } from "./report-page.js";
import { LabelsField, labelsOf } from "./reports.js";

const PAGE_SIZES = [10, 20, 30, 50, 100];
const NO_REFERENCES: References = { people: {}, pages: {}, topics: {} };

export interface PropertiesReportDisplay {
  firstColumn: string;
  showCreator: boolean;
  showLabels: boolean;
  query: string | null;
}

function listOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  if (typeof value !== "string" || value.length === 0) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return labelsOf(value);
  }
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function flag(value: unknown): boolean {
  return value === true || value === "true";
}

export { flag, listOf, textOrNull };

export function propertiesReportFromAttrs(attrs: Record<string, unknown>): PropertiesReportRequest {
  const pageSize = Number(attrs.pageSize);
  return {
    spaceIds: listOf(attrs.spaceIds),
    labels: listOf(attrs.labels),
    setId: textOrNull(attrs.setId),
    columns: listOf(attrs.columns),
    sortBy: textOrNull(attrs.sortBy),
    reverse: flag(attrs.reverse),
    pageSize:
      Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= MAX_PROPERTIES_REPORT_PAGE_SIZE
        ? pageSize
        : DEFAULT_PROPERTIES_REPORT_PAGE_SIZE,
  };
}

export function propertiesDisplayFromAttrs(attrs: Record<string, unknown>): PropertiesReportDisplay {
  return {
    firstColumn: typeof attrs.firstColumn === "string" ? attrs.firstColumn : "",
    showCreator: flag(attrs.showCreator),
    showLabels: flag(attrs.showLabels),
    query: textOrNull(attrs.query),
  };
}

function ReportLink({ href, children }: { href: string; children: string }) {
  const open = useOpenPath();
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    open(href);
  };
  return (
    <a href={href} onClick={follow} className="wrap-anywhere">
      {children}
    </a>
  );
}

export function SpacesField({
  spaceIds,
  label,
  hint,
  onChange,
}: {
  spaceIds: readonly string[];
  label: string;
  hint: string;
  onChange: (spaceIds: string[]) => void;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const names = useQueries({
    queries: spaceIds.map((spaceId) => ({
      queryKey: ["spaces", spaceId],
      queryFn: () => request(() => api.GET("/api/v1/spaces/{spaceId}", { params: { path: { spaceId } } })),
      retry: false,
    })),
  });
  return (
    <Field label={label} hint={hint} error={error ?? undefined}>
      <Combobox
        multiple
        aria-label={label}
        placeholder={t("editor.reports.searchSpace")}
        invalid={error !== null}
        value={spaceIds}
        selectedItems={spaceIds.map((value, index) => ({
          value,
          label: names[index]?.data?.name ?? (names[index]?.isError ? t("editor.reports.hiddenSpace") : "…"),
        }))}
        load={async (query) => {
          const spaces = await request(() =>
            api.GET("/api/v1/spaces", { params: { query: { q: query, limit: 20 } } }),
          );
          const items: ComboboxItem[] = spaces.items.map((space) => ({
            value: space.id,
            label: space.name,
            description: space.key,
          }));
          return { items };
        }}
        onValueChange={(next) => {
          if (next.length > MAX_FILTER_SPACES) {
            setError(t("editor.reports.tooManySpaces", { count: MAX_FILTER_SPACES }));
            return;
          }
          setError(null);
          onChange(next);
        }}
      />
    </Field>
  );
}

function listParameter(values: readonly string[]): string | undefined {
  return values.length > 0 ? values.join(",") : undefined;
}

const TITLE = "title";

function sortOf(report: PropertiesReportRequest): TableSort {
  return {
    key: report.sortBy === null ? TITLE : `column:${report.sortBy}`,
    direction: report.reverse ? "desc" : "asc",
  };
}

export function PropertiesReportTable({
  report,
  display,
}: {
  report: PropertiesReportRequest;
  display: PropertiesReportDisplay;
}) {
  const { t } = useTranslation();
  const [sort, setSort] = useState<TableSort>(() => sortOf(report));
  const [page, setPage] = useReportPage(reportKey(report));
  const offset = (page - 1) * report.pageSize;
  const settings = JSON.stringify({
    sort: sortOf(report),
    filters: [report.spaceIds, report.labels, report.setId, report.columns, report.pageSize],
  });
  const shown = useRef(settings);
  useEffect(() => {
    if (shown.current === settings) return;
    shown.current = settings;
    setSort((JSON.parse(settings) as { sort: TableSort }).sort);
    setPage(1);
  }, [settings, setPage]);
  const sortBy = sort.key === TITLE ? null : sort.key.slice("column:".length);
  const result = useQuery({
    queryKey: ["reports", "properties", report, sort, offset],
    placeholderData: keepPreviousData,
    throwOnError: false,
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/reports/properties", {
          params: {
            query: {
              ...(report.spaceIds.length > 0 ? { spaceIds: listParameter(report.spaceIds) } : {}),
              ...(report.labels.length > 0 ? { labels: listParameter(report.labels) } : {}),
              ...(report.setId ? { setId: report.setId } : {}),
              ...(report.columns.length > 0 ? { columns: listParameter(report.columns) } : {}),
              ...(sortBy ? { sortBy } : {}),
              reverse: sort.direction === "desc" ? "true" : "false",
              pageSize: report.pageSize,
              offset,
            },
          },
        }),
      ),
  });
  const total = result.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / report.pageSize));
  useEffect(() => {
    if (total > 0 && page > pages) setPage(pages);
  }, [total, page, pages, setPage]);
  if (result.isPending) return <SkeletonText lines={3} />;
  if (result.isError) {
    return (
      <LoadError
        what={t("editor.propertiesReport.loadFailed")}
        error={result.error}
        onRetry={result.refetch}
      />
    );
  }
  const data = result.data;
  if (data.total === 0)
    return <p className="text-sm text-text-muted">{t("editor.propertiesReport.empty")}</p>;
  const references = data.references as References;
  const first = data.rows.length > 0 ? offset + 1 : 0;
  return (
    <div className="flex flex-col gap-2">
      <Table
        caption={t("editor.propertiesReport.title")}
        rowKey={(row) => row.page.id}
        rows={data.rows}
        sort={sort}
        onSortChange={(next) => {
          setSort(next);
          setPage(1);
        }}
        loading={result.isFetching}
        columns={[
          {
            key: TITLE,
            header: display.firstColumn || t("editor.pageReport.page"),
            sortable: true,
            cell: (row) => (
              <ReportLink href={row.page.path}>
                {row.page.title || t("editor.readView.untitledPage")}
              </ReportLink>
            ),
          },
          ...data.columns.map((column, index) => ({
            key: `column:${column}`,
            header: <span className="wrap-anywhere">{column}</span>,
            sortable: true,
            cell: (row: (typeof data.rows)[number]) => {
              const cell = row.cells[index];
              return cell ? (
                <RenderedBlocks blocks={cell as NodeJson[]} references={references ?? NO_REFERENCES} />
              ) : null;
            },
          })),
          ...(display.showCreator
            ? [
                {
                  key: "creator",
                  header: t("editor.propertiesReport.creator"),
                  cell: (row: (typeof data.rows)[number]) =>
                    row.creator?.name ?? (
                      <span className="text-text-muted">{t("editor.mention.unknown")}</span>
                    ),
                },
              ]
            : []),
          ...(display.showLabels
            ? [
                {
                  key: "labels",
                  header: t("editor.propertiesReport.labels"),
                  cell: (row: (typeof data.rows)[number]) => row.labels.join(", "),
                },
              ]
            : []),
        ]}
        pagination={
          data.total > report.pageSize
            ? {
                hasPrevious: offset > 0,
                hasNext: offset + report.pageSize < data.total,
                onPrevious: () => setPage(Math.max(1, page - 1)),
                onNext: () => setPage(page + 1),
              }
            : undefined
        }
      />
      {data.total > report.pageSize ? (
        <p className="text-sm text-text-muted" aria-live="polite">
          {t("editor.propertiesReport.range", { first, last: offset + data.rows.length, total: data.total })}
        </p>
      ) : null}
    </div>
  );
}

export function PropertiesReportSettings({
  report,
  display,
  currentSpaceId,
  keys,
  onChange,
}: {
  report: PropertiesReportRequest;
  display: PropertiesReportDisplay;
  currentSpaceId: string | null;
  keys: readonly string[];
  onChange: (changes: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const [columnError, setColumnError] = useState<string | null>(null);
  const [setId, setSetId] = useState(report.setId ?? "");
  const [firstColumn, setFirstColumn] = useState(display.firstColumn);
  const columnItems = (values: readonly string[]) => values.map((value) => ({ value, label: value }));
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {display.query ? (
        <div className="sm:col-span-2">
          <Notice variant="warning" title={t("editor.propertiesReport.importedQueryTitle")}>
            {t("editor.propertiesReport.importedQuery", { query: display.query })}
          </Notice>
        </div>
      ) : null}
      <SpacesField
        spaceIds={report.spaceIds}
        label={t("editor.reports.scope")}
        hint={t("editor.propertiesReport.spacesHint")}
        onChange={(spaceIds) => onChange({ spaceIds })}
      />
      <LabelsField
        labels={report.labels}
        spaceId={report.spaceIds[0] ?? currentSpaceId}
        label={t("editor.reports.labels")}
        hint={t("editor.propertiesReport.labelsHint")}
        onChange={(labels) => onChange({ labels })}
      />
      <Field
        label={t("editor.propertiesReport.columns")}
        hint={t("editor.propertiesReport.columnsHint")}
        error={columnError ?? undefined}
      >
        <Combobox
          multiple
          aria-label={t("editor.propertiesReport.columns")}
          placeholder={t("editor.propertiesReport.searchColumn")}
          invalid={columnError !== null}
          value={report.columns}
          selectedItems={columnItems(report.columns)}
          load={async (query) => {
            const typed = query
              .replace(/\s+/g, " ")
              .trim()
              .replaceAll(",", " ")
              .slice(0, MAX_PROPERTY_KEY_LENGTH);
            const matching = keys.filter((key) => key.toLowerCase().includes(typed.toLowerCase()));
            const items = columnItems(matching);
            if (typed && !keys.some((key) => key.toLowerCase() === typed.toLowerCase())) {
              items.unshift({ value: typed, label: typed });
            }
            return { items };
          }}
          onValueChange={(next) => {
            if (next.length > MAX_PROPERTIES_REPORT_COLUMNS) {
              setColumnError(
                t("editor.propertiesReport.tooManyColumns", { count: MAX_PROPERTIES_REPORT_COLUMNS }),
              );
              return;
            }
            setColumnError(null);
            onChange({ columns: next });
          }}
        />
      </Field>
      <Field label={t("editor.propertiesReport.sort")}>
        <Select
          value={report.sortBy ?? TITLE}
          onValueChange={(value) => onChange({ sortBy: value === TITLE ? null : value })}
          options={[
            { value: TITLE, label: t("editor.propertiesReport.byTitle") },
            ...[...new Set([...report.columns, ...keys, ...(report.sortBy ? [report.sortBy] : [])])].map(
              (key) => ({
                value: key,
                label: key,
              }),
            ),
          ]}
        />
      </Field>
      <Field label={t("editor.propertiesReport.pageSize")}>
        <Select
          value={String(report.pageSize)}
          onValueChange={(value) => onChange({ pageSize: Number(value) })}
          options={[...new Set([...PAGE_SIZES, report.pageSize])]
            .sort((left, right) => left - right)
            .map((size) => ({
              value: String(size),
              label: t("editor.propertiesReport.pageSizeValue", { count: size }),
            }))}
        />
      </Field>
      <Field
        label={t("editor.propertiesReport.firstColumn")}
        hint={t("editor.propertiesReport.firstColumnHint")}
      >
        <Input
          value={firstColumn}
          maxLength={MAX_PROPERTY_KEY_LENGTH}
          placeholder={t("editor.pageReport.page")}
          onChange={(event) => setFirstColumn(event.target.value)}
          onBlur={() => onChange({ firstColumn: firstColumn.trim() })}
        />
      </Field>
      <Field label={t("editor.propertiesReport.setId")} hint={t("editor.propertiesReport.setIdHint")}>
        <Input
          value={setId}
          maxLength={MAX_PROPERTY_SET_ID_LENGTH}
          onChange={(event) => setSetId(event.target.value)}
          onBlur={() => onChange({ setId: setId.trim() || null })}
        />
      </Field>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <Checkbox
          checked={report.reverse}
          onCheckedChange={(reverse) => onChange({ reverse })}
          label={t("editor.reports.reverse")}
        />
        <Checkbox
          checked={display.showCreator}
          onCheckedChange={(showCreator) => onChange({ showCreator })}
          label={t("editor.propertiesReport.showCreator")}
        />
        <Checkbox
          checked={display.showLabels}
          onCheckedChange={(showLabels) => onChange({ showLabels })}
          label={t("editor.propertiesReport.showLabels")}
        />
      </div>
    </div>
  );
}

function useReportKeys(report: PropertiesReportRequest, enabled: boolean): string[] {
  const keys = useQuery({
    queryKey: ["reports", "properties", "keys", report.spaceIds, report.labels, report.setId],
    enabled,
    throwOnError: false,
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/reports/properties", {
          params: {
            query: {
              ...(report.spaceIds.length > 0 ? { spaceIds: listParameter(report.spaceIds) } : {}),
              ...(report.labels.length > 0 ? { labels: listParameter(report.labels) } : {}),
              ...(report.setId ? { setId: report.setId } : {}),
              pageSize: 1,
            },
          },
        }),
      ),
  });
  return keys.data?.keys ?? [];
}

export function PropertiesReportView({ node, editor, updateAttributes, selected }: NodeViewProps) {
  const editable = useEditable(editor);
  const { t } = useTranslation();
  const page = usePageContext();
  const report = propertiesReportFromAttrs(node.attrs);
  const display = propertiesDisplayFromAttrs(node.attrs);
  const keys = useReportKeys(report, editable);
  return (
    <NodeViewWrapper
      className={`ph-properties-report-block${selected ? " ph-node-selected" : ""}`}
      contentEditable={false}
      data-type="propertiesReport"
    >
      <section
        className="ph-properties-report flex flex-col gap-3"
        aria-label={t("editor.propertiesReport.title")}
      >
        <h3 className="flex items-center gap-2 font-semibold">
          <Table2 aria-hidden="true" className="size-icon-md" />
          {t("editor.propertiesReport.title")}
        </h3>
        {editable ? (
          <PropertiesReportSettings
            report={report}
            display={display}
            keys={keys}
            currentSpaceId={page?.spaceId ?? null}
            onChange={(changes) => updateAttributes(changes)}
          />
        ) : null}
        <PropertiesReportTable report={report} display={display} />
        <p className="text-sm text-text-muted">{t("editor.propertiesReport.readableOnly")}</p>
      </section>
    </NodeViewWrapper>
  );
}

export function emptyProperty(key = ""): NodeJson {
  return {
    type: "pageProperty",
    content: [
      { type: "pagePropertyKey", ...(key ? { content: [{ type: "text", text: key }] } : {}) },
      { type: "pagePropertyValue", content: [{ type: "paragraph" }] },
    ],
  };
}

export function PagePropertiesView({ node, editor, updateAttributes, getPos }: NodeViewProps) {
  const editable = useEditable(editor);
  const { t } = useTranslation();
  const [setId, setSetId] = useState(String(node.attrs.setId ?? ""));
  useEffect(() => setSetId(String(node.attrs.setId ?? "")), [node.attrs.setId]);
  const hidden = node.attrs.hidden === true;
  const addRow = () => {
    const position = getPos();
    if (typeof position !== "number") return;
    const end = position + node.nodeSize - 1;
    editor
      .chain()
      .insertContentAt(end, emptyProperty())
      .setTextSelection(end + 2)
      .focus()
      .run();
  };
  return (
    <NodeViewWrapper className="ph-page-properties-block" data-hidden={hidden ? "true" : undefined}>
      <div contentEditable={false} className="ph-block-header">
        <span className="flex items-center gap-2 font-semibold">
          <TableProperties aria-hidden="true" className="size-icon-md" />
          {t("editor.pageProperties.title")}
        </span>
        {hidden ? (
          <span className="text-sm text-text-muted">{t("editor.pageProperties.hiddenNote")}</span>
        ) : null}
        {editable ? (
          <span className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2 text-sm">
              <span aria-hidden="true">{t("editor.pageProperties.setId")}</span>
              <Input
                aria-label={t("editor.pageProperties.setIdLabel")}
                className="w-auto"
                value={setId}
                maxLength={MAX_PROPERTY_SET_ID_LENGTH}
                placeholder={t("editor.pageProperties.setIdPlaceholder")}
                onChange={(event) => setSetId(event.target.value)}
                onBlur={() => updateAttributes({ setId: setId.trim() || null })}
              />
            </span>
            <Checkbox
              checked={hidden}
              onCheckedChange={(value) => updateAttributes({ hidden: value })}
              label={t("editor.pageProperties.hide")}
            />
          </span>
        ) : null}
      </div>
      <div contentEditable={false} className="ph-page-properties-head" aria-hidden="true">
        <span>{t("editor.pageProperties.name")}</span>
        <span>{t("editor.pageProperties.value")}</span>
      </div>
      <NodeViewContent className="ph-page-properties-rows" />
      {editable ? (
        <div contentEditable={false}>
          <button type="button" className="ph-inline-button" onClick={addRow}>
            <ListPlus aria-hidden="true" className="size-icon-sm" />
            {t("editor.pageProperties.addRow")}
          </button>
        </div>
      ) : null}
    </NodeViewWrapper>
  );
}

export function PagePropertyView({ node, editor, getPos }: NodeViewProps) {
  const editable = useEditable(editor);
  const { t } = useTranslation();
  const name = node.firstChild?.textContent.trim() ?? "";
  const remove = () => {
    const position = getPos();
    if (typeof position !== "number") return;
    const resolved = editor.state.doc.resolve(position);
    if (resolved.parent.childCount <= 1) {
      const start = resolved.before();
      editor
        .chain()
        .deleteRange({ from: start, to: start + resolved.parent.nodeSize })
        .focus()
        .run();
      return;
    }
    editor
      .chain()
      .deleteRange({ from: position, to: position + node.nodeSize })
      .focus()
      .run();
  };
  return (
    <NodeViewWrapper className="ph-page-property">
      <NodeViewContent className="ph-page-property-cells" />
      {editable ? (
        <span
          contentEditable={false}
          className="ph-page-property-actions flex size-hit shrink-0 items-center justify-center"
        >
          <IconButton
            icon={Trash2}
            size="md"
            label={
              name ? t("editor.pageProperties.removeNamed", { name }) : t("editor.pageProperties.remove")
            }
            onClick={remove}
          />
        </span>
      ) : null}
    </NodeViewWrapper>
  );
}
