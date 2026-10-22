import {
  type ContentByLabelRequest,
  type ContentLabelSort,
  contentLabelSorts,
  DEFAULT_CONTENT_BY_LABEL_LIMIT,
  type LabeledContentKind,
  labeledContentKinds,
  MAX_CONTENT_BY_LABEL_LIMIT,
  MAX_LABEL_BLOCK_TITLE,
} from "@lunedo/editor-schema";
import { Checkbox, Field, Input, Notice, Select, SkeletonText } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { Tags } from "lucide-react";
import { type MouseEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { LoadError } from "../errors/failure.js";
import { translateKey } from "../i18n/translate.js";
import { useEditable, useOpenPath, usePageContext } from "./context.js";
import { flag, listOf, SpacesField, textOrNull } from "./properties.js";
import { LabelsField } from "./reports.js";

const LIMITS = [5, 10, 20, 50, 100];

export interface ContentByLabelDisplay {
  showLabels: boolean;
  showSpace: boolean;
  title: string;
  query: string | null;
}

export function contentByLabelFromAttrs(attrs: Record<string, unknown>): ContentByLabelRequest {
  const sort = String(attrs.sort ?? "modified");
  const limit = Number(attrs.limit);
  const kinds = listOf(attrs.kinds).filter((kind): kind is LabeledContentKind =>
    (labeledContentKinds as readonly string[]).includes(kind),
  );
  return {
    labels: listOf(attrs.labels),
    matchAll: flag(attrs.matchAll),
    spaceIds: listOf(attrs.spaceIds),
    kinds: kinds.length > 0 ? kinds : ["page", "blogPost"],
    sort: (contentLabelSorts as readonly string[]).includes(sort) ? (sort as ContentLabelSort) : "modified",
    reverse: flag(attrs.reverse),
    limit:
      Number.isInteger(limit) && limit >= 1 && limit <= MAX_CONTENT_BY_LABEL_LIMIT
        ? limit
        : DEFAULT_CONTENT_BY_LABEL_LIMIT,
    excerpts: flag(attrs.excerpts),
  };
}

export function contentByLabelDisplayFromAttrs(attrs: Record<string, unknown>): ContentByLabelDisplay {
  return {
    showLabels: attrs.showLabels !== false && attrs.showLabels !== "false",
    showSpace: attrs.showSpace !== false && attrs.showSpace !== "false",
    title: typeof attrs.title === "string" ? attrs.title : "",
    query: textOrNull(attrs.query),
  };
}

function Link({ href, children }: { href: string; children: string }) {
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

export function ContentByLabelList({
  request: list,
  display,
}: {
  request: ContentByLabelRequest;
  display: ContentByLabelDisplay;
}) {
  const { t } = useTranslation();
  const items = useQuery({
    queryKey: ["reports", "contentByLabel", list],
    enabled: list.labels.length > 0,
    throwOnError: false,
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/reports/content-by-label", {
          params: {
            query: {
              labels: list.labels.join(","),
              matchAll: list.matchAll ? "true" : "false",
              ...(list.spaceIds.length > 0 ? { spaceIds: list.spaceIds.join(",") } : {}),
              kinds: list.kinds.join(","),
              sort: list.sort,
              reverse: list.reverse ? "true" : "false",
              limit: list.limit,
              excerpts: list.excerpts ? "true" : "false",
            },
          },
        }),
      ),
  });
  if (list.labels.length === 0) {
    return <p className="text-sm text-text-muted">{t("editor.contentByLabel.chooseLabels")}</p>;
  }
  if (items.isPending) return <SkeletonText lines={3} />;
  if (items.isError) {
    return (
      <LoadError what={t("editor.contentByLabel.loadFailed")} error={items.error} onRetry={items.refetch} />
    );
  }
  if (items.data.length === 0)
    return <p className="text-sm text-text-muted">{t("editor.contentByLabel.empty")}</p>;
  return (
    <ul className="ld-content-by-label-items flex flex-col gap-2">
      {items.data.map((item) => {
        const meta = [
          ...(display.showSpace && item.space.name ? [item.space.name] : []),
          ...(display.showLabels && item.labels.length > 0 ? [item.labels.join(", ")] : []),
        ];
        return (
          <li key={item.id}>
            <Link href={item.path}>{item.title || t("editor.readView.untitledPage")}</Link>
            {meta.length > 0 ? (
              <span className="ml-2 text-sm text-text-muted">{meta.join(" · ")}</span>
            ) : null}
            {item.excerpt ? <p className="text-sm wrap-anywhere text-text-muted">{item.excerpt}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

function ContentByLabelSettings({
  list,
  display,
  currentSpaceId,
  onChange,
}: {
  list: ContentByLabelRequest;
  display: ContentByLabelDisplay;
  currentSpaceId: string | null;
  onChange: (changes: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(display.title);
  const kinds = list.kinds.length === 2 ? "all" : (list.kinds[0] ?? "all");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {display.query ? (
        <div className="sm:col-span-2">
          <Notice variant="warning" title={t("editor.propertiesReport.importedQueryTitle")}>
            {t("editor.propertiesReport.importedQuery", { query: display.query })}
          </Notice>
        </div>
      ) : null}
      <LabelsField
        labels={list.labels}
        spaceId={list.spaceIds[0] ?? currentSpaceId}
        label={t("editor.reports.labels")}
        hint={t("editor.contentByLabel.labelsHint")}
        onChange={(labels) => onChange({ labels })}
      />
      <SpacesField
        spaceIds={list.spaceIds}
        label={t("editor.reports.scope")}
        hint={t("editor.propertiesReport.spacesHint")}
        onChange={(spaceIds) => onChange({ spaceIds })}
      />
      <Field label={t("editor.contentByLabel.match")}>
        <Select
          value={list.matchAll ? "all" : "any"}
          onValueChange={(value) => onChange({ matchAll: value === "all" })}
          options={[
            { value: "any", label: t("editor.contentByLabel.matchAny") },
            { value: "all", label: t("editor.contentByLabel.matchAll") },
          ]}
        />
      </Field>
      <Field label={t("editor.contentByLabel.kinds")}>
        <Select
          value={kinds}
          onValueChange={(value) => onChange({ kinds: value === "all" ? ["page", "blogPost"] : [value] })}
          options={[
            { value: "all", label: t("editor.contentByLabel.kindsAll") },
            { value: "page", label: t("editor.contentByLabel.kindsPage") },
            { value: "blogPost", label: t("editor.contentByLabel.kindsBlogPost") },
          ]}
        />
      </Field>
      <Field label={t("editor.pageReport.sort")}>
        <Select
          value={list.sort}
          onValueChange={(value) => onChange({ sort: value })}
          options={contentLabelSorts.map((sort) => ({
            value: sort,
            label: translateKey(t, `editor.pageReport.sorts.${sort}`),
          }))}
        />
      </Field>
      <Field label={t("editor.pageReport.limit")}>
        <Select
          value={String(list.limit)}
          onValueChange={(value) => onChange({ limit: Number(value) })}
          options={[...new Set([...LIMITS, list.limit])]
            .sort((left, right) => left - right)
            .map((limit) => ({
              value: String(limit),
              label: t("editor.pageReport.limitValue", { count: limit }),
            }))}
        />
      </Field>
      <Field label={t("editor.contentByLabel.heading")} hint={t("editor.contentByLabel.headingHint")}>
        <Input
          value={title}
          maxLength={MAX_LABEL_BLOCK_TITLE}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => onChange({ title: title.trim() })}
        />
      </Field>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <Checkbox
          checked={list.reverse}
          onCheckedChange={(reverse) => onChange({ reverse })}
          label={t("editor.reports.reverse")}
        />
        <Checkbox
          checked={list.excerpts}
          onCheckedChange={(excerpts) => onChange({ excerpts })}
          label={t("editor.contentByLabel.excerpts")}
        />
        <Checkbox
          checked={display.showSpace}
          onCheckedChange={(showSpace) => onChange({ showSpace })}
          label={t("editor.contentByLabel.showSpace")}
        />
        <Checkbox
          checked={display.showLabels}
          onCheckedChange={(showLabels) => onChange({ showLabels })}
          label={t("editor.contentByLabel.showLabels")}
        />
      </div>
    </div>
  );
}

export function ContentByLabelView({ node, editor, updateAttributes, selected }: NodeViewProps) {
  const editable = useEditable(editor);
  const { t } = useTranslation();
  const page = usePageContext();
  const list = contentByLabelFromAttrs(node.attrs);
  const display = contentByLabelDisplayFromAttrs(node.attrs);
  return (
    <NodeViewWrapper
      className={`ld-content-by-label-block${selected ? " ld-node-selected" : ""}`}
      contentEditable={false}
      data-type="contentByLabel"
    >
      <section
        className="ld-content-by-label flex flex-col gap-3"
        aria-label={display.title || t("editor.contentByLabel.title")}
      >
        <h3 className="flex items-center gap-2 font-semibold">
          <Tags aria-hidden="true" className="size-icon-md" />
          {display.title || t("editor.contentByLabel.title")}
        </h3>
        {editable ? (
          <ContentByLabelSettings
            list={list}
            display={display}
            currentSpaceId={page?.spaceId ?? null}
            onChange={(changes) => updateAttributes(changes)}
          />
        ) : null}
        <ContentByLabelList request={list} display={display} />
      </section>
    </NodeViewWrapper>
  );
}

export function RelatedLabelsList({ pageId, labels }: { pageId: string; labels: readonly string[] }) {
  const { t } = useTranslation();
  const related = useQuery({
    queryKey: ["reports", "relatedLabels", pageId, labels],
    throwOnError: false,
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/pages/{pageId}/related-labels", {
          params: { path: { pageId }, query: labels.length > 0 ? { labels: labels.join(",") } : {} },
        }),
      ),
  });
  if (related.isPending) return <SkeletonText lines={1} />;
  if (related.isError) {
    return (
      <LoadError
        what={t("editor.relatedLabels.loadFailed")}
        error={related.error}
        onRetry={related.refetch}
      />
    );
  }
  if (related.data.length === 0)
    return <p className="text-sm text-text-muted">{t("editor.relatedLabels.empty")}</p>;
  return (
    <ul className="ld-label-list flex flex-wrap gap-2">
      {related.data.map((label) => (
        <li key={label.label}>
          <Link href={label.href}>{label.label}</Link>
        </li>
      ))}
    </ul>
  );
}

export function RelatedLabelsView({ node, editor, updateAttributes, selected }: NodeViewProps) {
  const editable = useEditable(editor);
  const { t } = useTranslation();
  const page = usePageContext();
  const labels = listOf(node.attrs.labels);
  const title =
    typeof node.attrs.title === "string" && node.attrs.title
      ? node.attrs.title
      : t("editor.relatedLabels.title");
  return (
    <NodeViewWrapper
      className={`ld-related-labels-block${selected ? " ld-node-selected" : ""}`}
      contentEditable={false}
      data-type="relatedLabels"
    >
      <section className="ld-related-labels flex flex-col gap-3" aria-label={title}>
        <h3 className="flex items-center gap-2 font-semibold">
          <Tags aria-hidden="true" className="size-icon-md" />
          {title}
        </h3>
        {editable ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <LabelsField
              labels={labels}
              spaceId={page?.spaceId ?? null}
              label={t("editor.reports.labels")}
              hint={t("editor.relatedLabels.labelsHint")}
              onChange={(next) => updateAttributes({ labels: next })}
            />
          </div>
        ) : null}
        {page ? <RelatedLabelsList pageId={page.pageId} labels={labels} /> : null}
      </section>
    </NodeViewWrapper>
  );
}
