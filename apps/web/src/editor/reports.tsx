import {
  DEFAULT_PAGE_REPORT_LIMIT,
  type DecisionReportOrder,
  type DecisionReportRequest,
  decisionReportOrders,
  MAX_FILTER_LABELS,
  MAX_FILTER_PAGES,
  MAX_PAGE_REPORT_LIMIT,
  type PageReportRequest,
  type PageReportSort,
  pageReportSorts,
} from "@pagehall/editor-schema";
import {
  Button,
  Checkbox,
  Combobox,
  type ComboboxItem,
  Field,
  Select,
  SkeletonText,
  Table,
} from "@pagehall/ui";
import { useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { FileStack, FlagTriangleRight } from "lucide-react";
import { type MouseEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { LoadError } from "../errors/failure.js";
import { translateKey } from "../i18n/translate.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { normalizeLabel } from "../spaces/page-labels.js";
import { itemQuery } from "../spaces/space-queries.js";
import { useEditable, useOpenPath, usePageContext } from "./context.js";

const LIMIT_CHOICES = [5, 10, 20, 50, 100];
const DECISION_PAGE = 50;

export function labelsOf(value: unknown): string[] {
  const list = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : [];
  return list.filter((label): label is string => typeof label === "string" && label.length > 0);
}

export function pageIdsOf(value: unknown): string[] {
  return labelsOf(value).filter((id) => /^[0-9a-f-]{36}$/.test(id));
}

function idOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function pageReportFromAttrs(attrs: Record<string, unknown>): PageReportRequest {
  const sort = String(attrs.sort ?? "modified");
  const limit = Number(attrs.limit);
  return {
    spaceId: idOrNull(attrs.spaceId),
    labels: labelsOf(attrs.labels),
    sort: (pageReportSorts as readonly string[]).includes(sort) ? (sort as PageReportSort) : "modified",
    reverse: attrs.reverse === true || attrs.reverse === "true",
    limit:
      Number.isInteger(limit) && limit >= 1 && limit <= MAX_PAGE_REPORT_LIMIT
        ? limit
        : DEFAULT_PAGE_REPORT_LIMIT,
  };
}

export function decisionReportFromAttrs(attrs: Record<string, unknown>): DecisionReportRequest {
  const order = String(attrs.order ?? "newest");
  return {
    spaceId: idOrNull(attrs.spaceId),
    labels: labelsOf(attrs.labels),
    parentId: idOrNull(attrs.parentId),
    order: (decisionReportOrders as readonly string[]).includes(order)
      ? (order as DecisionReportOrder)
      : "newest",
  };
}

function listParameter(values: readonly string[]): string | undefined {
  return values.length > 0 ? values.join(",") : undefined;
}

function pageLoader(spaceId: string | null) {
  return async (query: string) => {
    const items = await request(() =>
      api.GET("/api/v1/items", {
        params: { query: { q: query, kind: "page", limit: 20, ...(spaceId ? { spaceId } : {}) } },
      }),
    );
    return {
      items: items.map((item) => ({ value: item.id, label: item.title, description: item.spaceName })),
      nextCursor: null,
    };
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

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-text-muted">{text}</p>;
}

export function ScopeField({
  spaceId,
  currentSpaceId,
  onChange,
}: {
  spaceId: string | null;
  currentSpaceId: string | null;
  onChange: (spaceId: string | null) => void;
}) {
  const { t } = useTranslation();
  const other = spaceId !== null && spaceId !== currentSpaceId;
  return (
    <Field label={t("editor.reports.scope")}>
      <Select
        value={spaceId === null ? "all" : other ? "other" : "space"}
        onValueChange={(value) => {
          if (value === "all") onChange(null);
          else if (value === "space") onChange(currentSpaceId);
        }}
        options={[
          ...(currentSpaceId ? [{ value: "space", label: t("editor.reports.thisSpace") }] : []),
          ...(other ? [{ value: "other", label: t("editor.reports.otherSpace") }] : []),
          { value: "all", label: t("editor.reports.allSpaces") },
        ]}
      />
    </Field>
  );
}

export function LabelsField({
  labels,
  spaceId,
  label,
  hint,
  onChange,
}: {
  labels: readonly string[];
  spaceId: string | null;
  label: string;
  hint: string;
  onChange: (labels: string[]) => void;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  return (
    <Field label={label} hint={hint} error={error ?? undefined}>
      <Combobox
        multiple
        aria-label={label}
        placeholder={t("editor.reports.searchLabel")}
        emptyText={t("editor.reports.labelHint")}
        invalid={error !== null}
        value={labels}
        selectedItems={labels.map((value) => ({ value, label: value }))}
        load={async (query) => {
          const typed = normalizeLabel(query);
          const suggestions = spaceId
            ? await request(() =>
                api.GET("/api/v1/spaces/{spaceId}/labels", {
                  params: { path: { spaceId }, query: { q: typed } },
                }),
              )
            : [];
          const items: ComboboxItem[] = suggestions.map((value) => ({ value, label: value }));
          if (typed && !suggestions.includes(typed)) {
            items.push({ value: typed, label: typed, marker: t("editor.reports.newLabel") });
          }
          return { items };
        }}
        onValueChange={(next) => {
          if (next.length > MAX_FILTER_LABELS) {
            setError(t("editor.reports.tooManyLabels", { count: MAX_FILTER_LABELS }));
            return;
          }
          setError(null);
          onChange(next);
        }}
      />
    </Field>
  );
}

export function PagesField({
  pageIds,
  label,
  hint,
  onChange,
}: {
  pageIds: readonly string[];
  label: string;
  hint: string;
  onChange: (pageIds: string[]) => void;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const titles = useQueries({
    queries: pageIds.map((id) => ({ ...itemQuery(id), retry: false })),
  });
  return (
    <Field label={label} hint={hint} error={error ?? undefined}>
      <Combobox
        multiple
        aria-label={label}
        placeholder={t("editor.reports.searchPage")}
        invalid={error !== null}
        value={pageIds}
        selectedItems={pageIds.map((value, index) => ({
          value,
          label:
            titles[index]?.data?.title ?? (titles[index]?.isError ? t("editor.reports.hiddenPage") : "…"),
        }))}
        load={pageLoader(null)}
        onValueChange={(next) => {
          if (next.length > MAX_FILTER_PAGES) {
            setError(t("editor.reports.tooManyPages", { count: MAX_FILTER_PAGES }));
            return;
          }
          setError(null);
          onChange(next);
        }}
      />
    </Field>
  );
}

function ParentField({
  parentId,
  spaceId,
  onChange,
}: {
  parentId: string | null;
  spaceId: string | null;
  onChange: (parentId: string | null) => void;
}) {
  const { t } = useTranslation();
  const parent = useQuery({
    ...itemQuery(parentId ?? ""),
    enabled: parentId !== null,
    retry: false,
    throwOnError: false,
  });
  return (
    <Field label={t("editor.decisionReport.parent")} hint={t("editor.decisionReport.parentHint")}>
      <Combobox
        aria-label={t("editor.decisionReport.parent")}
        placeholder={t("editor.reports.searchPage")}
        value={parentId}
        selectedItem={
          parentId
            ? {
                value: parentId,
                label: parent.data?.title ?? (parent.isError ? t("editor.reports.hiddenPage") : ""),
              }
            : null
        }
        load={pageLoader(spaceId)}
        onValueChange={(value) => onChange(value)}
      />
    </Field>
  );
}

export function PageReportTable({ request: report }: { request: PageReportRequest }) {
  const { t } = useTranslation();
  const format = useFormat();
  const pages = useQuery({
    queryKey: ["reports", "pages", report],
    throwOnError: false,
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/reports/pages", {
          params: {
            query: {
              ...(report.spaceId ? { spaceId: report.spaceId } : {}),
              ...(report.labels.length > 0 ? { labels: listParameter(report.labels) } : {}),
              sort: report.sort,
              reverse: report.reverse ? "true" : "false",
              limit: report.limit,
            },
          },
        }),
      ),
  });
  if (pages.isPending) return <SkeletonText lines={3} />;
  if (pages.isError) {
    return <LoadError what={t("editor.pageReport.loadFailed")} error={pages.error} onRetry={pages.refetch} />;
  }
  if (pages.data.length === 0) return <Empty text={t("editor.pageReport.empty")} />;
  return (
    <Table
      caption={t("editor.pageReport.title")}
      rowKey={(row) => row.id}
      rows={pages.data}
      columns={[
        {
          key: "title",
          header: t("editor.pageReport.page"),
          cell: (row) => (
            <ReportLink href={row.path}>{row.title || t("editor.readView.untitledPage")}</ReportLink>
          ),
        },
        {
          key: "author",
          header: t("editor.pageReport.author"),
          hideBelow: "sm",
          cell: (row) =>
            row.author?.name ?? <span className="text-text-muted">{t("editor.mention.unknown")}</span>,
        },
        {
          key: "updated",
          header: t("editor.pageReport.updated"),
          align: "end",
          cell: (row) => <span className="whitespace-nowrap">{format.date(row.updatedAt)}</span>,
        },
      ]}
    />
  );
}

export function PageReportSettings({
  report,
  currentSpaceId,
  onChange,
}: {
  report: PageReportRequest;
  currentSpaceId: string | null;
  onChange: (changes: Partial<PageReportRequest>) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ScopeField
        spaceId={report.spaceId}
        currentSpaceId={currentSpaceId}
        onChange={(spaceId) => onChange({ spaceId })}
      />
      <LabelsField
        labels={report.labels}
        spaceId={report.spaceId ?? currentSpaceId}
        label={t("editor.reports.labels")}
        hint={t("editor.pageReport.labelsHint")}
        onChange={(labels) => onChange({ labels })}
      />
      <Field label={t("editor.pageReport.sort")}>
        <Select
          value={report.sort}
          onValueChange={(value) => onChange({ sort: value as PageReportSort })}
          options={pageReportSorts.map((sort) => ({
            value: sort,
            label: translateKey(t, `editor.pageReport.sorts.${sort}`),
          }))}
        />
      </Field>
      <Field label={t("editor.pageReport.limit")}>
        <Select
          value={String(report.limit)}
          onValueChange={(value) => onChange({ limit: Number(value) })}
          options={[...new Set([...LIMIT_CHOICES, report.limit])]
            .sort((left, right) => left - right)
            .map((limit) => ({
              value: String(limit),
              label: t("editor.pageReport.limitValue", { count: limit }),
            }))}
        />
      </Field>
      <div className="sm:col-span-2">
        <Checkbox
          checked={report.reverse}
          onCheckedChange={(reverse) => onChange({ reverse })}
          label={t("editor.reports.reverse")}
        />
      </div>
    </div>
  );
}

export function DecisionReportList({ request: report }: { request: DecisionReportRequest }) {
  const { t } = useTranslation();
  const format = useFormat();
  const decisions = useInfiniteQuery({
    queryKey: ["reports", "decisions", report],
    throwOnError: false,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      request(() =>
        api.GET("/api/v1/reports/decisions", {
          params: {
            query: {
              ...(report.spaceId ? { spaceId: report.spaceId } : {}),
              ...(report.labels.length > 0 ? { labels: listParameter(report.labels) } : {}),
              ...(report.parentId ? { parentId: report.parentId } : {}),
              order: report.order,
              limit: DECISION_PAGE,
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor,
  });
  if (decisions.isPending) return <SkeletonText lines={3} />;
  if (decisions.isError) {
    return (
      <LoadError
        what={t("editor.decisionReport.loadFailed")}
        error={decisions.error}
        onRetry={decisions.refetch}
      />
    );
  }
  const items = decisions.data.pages.flatMap((page) => page.items);
  if (items.length === 0) return <Empty text={t("editor.decisionReport.empty")} />;
  return (
    <div className="flex flex-col gap-2">
      <ul className="ph-decision-report-items">
        {items.map((decision) => (
          <li key={decision.id}>
            <p className="wrap-anywhere">{decision.text}</p>
            <p className="text-sm text-text-muted">
              <ReportLink href={decision.page.path}>
                {decision.page.title || t("editor.readView.untitledPage")}
              </ReportLink>
              {" · "}
              {format.date(decision.date)}
            </p>
          </li>
        ))}
      </ul>
      {decisions.hasNextPage ? (
        <div>
          <Button
            variant="secondary"
            loading={decisions.isFetchingNextPage}
            onClick={() => void decisions.fetchNextPage()}
          >
            {t("editor.decisionReport.more")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function DecisionReportSettings({
  report,
  currentSpaceId,
  onChange,
}: {
  report: DecisionReportRequest;
  currentSpaceId: string | null;
  onChange: (changes: Partial<DecisionReportRequest>) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ScopeField
        spaceId={report.spaceId}
        currentSpaceId={currentSpaceId}
        onChange={(spaceId) => onChange({ spaceId })}
      />
      <LabelsField
        labels={report.labels}
        spaceId={report.spaceId ?? currentSpaceId}
        label={t("editor.reports.labels")}
        hint={t("editor.decisionReport.labelsHint")}
        onChange={(labels) => onChange({ labels })}
      />
      <ParentField
        parentId={report.parentId}
        spaceId={report.spaceId}
        onChange={(parentId) => onChange({ parentId })}
      />
      <Field label={t("editor.decisionReport.order")}>
        <Select
          value={report.order}
          onValueChange={(value) => onChange({ order: value as DecisionReportOrder })}
          options={decisionReportOrders.map((order) => ({
            value: order,
            label: translateKey(t, `editor.decisionReport.orders.${order}`),
          }))}
        />
      </Field>
    </div>
  );
}

export function PageReportView({ node, editor, updateAttributes, selected }: NodeViewProps) {
  const editable = useEditable(editor);
  const { t } = useTranslation();
  const page = usePageContext();
  const report = pageReportFromAttrs(node.attrs);
  return (
    <NodeViewWrapper
      className={`ph-page-report-block${selected ? " ph-node-selected" : ""}`}
      contentEditable={false}
      data-type="pageReport"
    >
      <section className="ph-page-report flex flex-col gap-3" aria-label={t("editor.pageReport.title")}>
        <h3 className="flex items-center gap-2 font-semibold">
          <FileStack aria-hidden="true" className="size-icon-md" />
          {t("editor.pageReport.title")}
        </h3>
        {editable ? (
          <PageReportSettings
            report={report}
            currentSpaceId={page?.spaceId ?? null}
            onChange={(changes) => updateAttributes(changes)}
          />
        ) : null}
        <PageReportTable request={report} />
      </section>
    </NodeViewWrapper>
  );
}

export function DecisionReportView({ node, editor, updateAttributes, selected }: NodeViewProps) {
  const editable = useEditable(editor);
  const { t } = useTranslation();
  const page = usePageContext();
  const report = decisionReportFromAttrs(node.attrs);
  return (
    <NodeViewWrapper
      className={`ph-decision-report-block${selected ? " ph-node-selected" : ""}`}
      contentEditable={false}
      data-type="decisionReport"
    >
      <section
        className="ph-decision-report flex flex-col gap-3"
        aria-label={t("editor.decisionReport.title")}
      >
        <h3 className="flex items-center gap-2 font-semibold">
          <FlagTriangleRight aria-hidden="true" className="size-icon-md" />
          {t("editor.decisionReport.title")}
        </h3>
        {editable ? (
          <DecisionReportSettings
            report={report}
            currentSpaceId={page?.spaceId ?? null}
            onChange={(changes) => updateAttributes(changes)}
          />
        ) : null}
        <DecisionReportList request={report} />
      </section>
    </NodeViewWrapper>
  );
}
