import { type IncludeRequest, MAX_EXCERPT_NAME_LENGTH, MAX_INCLUDE_DEPTH } from "@pagehall/editor-schema";
import { Checkbox, Combobox, Field, Input, SkeletonText } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { NodeViewContent, type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { FileInput, Quote, TextQuote } from "lucide-react";
import { createContext, type MouseEvent, type ReactNode, useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { ApiError, request } from "../api/request.js";
import { LoadError } from "../errors/failure.js";
import { itemQuery } from "../spaces/space-queries.js";
import { useEditable, useOpenPath, usePageContext } from "./context.js";
import { flag, textOrNull } from "./properties.js";
import { PageReadView } from "./read-view.js";
import type { References } from "./references.js";

const IncludeChain = createContext<readonly string[]>([]);

export function includeFromAttrs(type: string, attrs: Record<string, unknown>): IncludeRequest {
  const excerpt = type === "includeExcerpt";
  return {
    pageId: textOrNull(attrs.pageId),
    sourceSpace: textOrNull(attrs.sourceSpace),
    sourceTitle: textOrNull(attrs.sourceTitle),
    excerpt,
    name: excerpt ? textOrNull(attrs.name) : null,
  };
}

function Note({ children }: { children: ReactNode }) {
  return <p className="ph-include-note text-sm text-text-muted">{children}</p>;
}

function TitleLink({ href, children }: { href: string; children: string }) {
  const open = useOpenPath();
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    open(href);
  };
  return (
    <a href={href} onClick={follow} className="font-semibold wrap-anywhere">
      {children}
    </a>
  );
}

export function notFound(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 403);
}

export function IncludedContent({
  include,
  hostId,
  panel,
  placeholders = false,
}: {
  include: IncludeRequest;
  hostId: string;
  panel: boolean;
  placeholders?: boolean;
}) {
  const { t } = useTranslation();
  const chain = useContext(IncludeChain);
  const ancestors = [...chain, hostId];
  const loop = include.pageId !== null && ancestors.includes(include.pageId);
  const tooDeep = ancestors.length > MAX_INCLUDE_DEPTH;
  const target = include.pageId !== null || include.sourceTitle !== null;
  const content = useQuery({
    queryKey: ["pages", hostId, "inclusion", include],
    enabled: target && !loop && !tooDeep,
    retry: (count, error) => !notFound(error) && count < 2,
    queryFn: () =>
      request(() =>
        api.GET("/api/v1/pages/{pageId}/inclusion", {
          params: {
            path: { pageId: hostId },
            query: {
              ...(include.pageId ? { targetId: include.pageId } : {}),
              ...(include.sourceTitle
                ? { sourceTitle: include.sourceTitle, sourceSpace: include.sourceSpace ?? "" }
                : {}),
              excerpt: include.excerpt ? "true" : "false",
              ...(include.name ? { name: include.name } : {}),
            },
          },
        }),
      ),
  });
  const hidden = (
    <>
      {placeholders ? (
        <Note>
          {include.pageId === null && include.sourceTitle
            ? t("editor.include.notImportedYet", { title: include.sourceTitle })
            : include.pageId === null
              ? t("editor.include.choosePage")
              : t("editor.include.restricted")}
        </Note>
      ) : null}
    </>
  );
  if (!target) return hidden;
  if (loop || (content.data && ancestors.includes(content.data.page.id)))
    return <Note>{t("editor.include.loop")}</Note>;
  if (tooDeep) return <Note>{t("editor.include.tooDeep")}</Note>;
  if (content.isPending) return <SkeletonText lines={2} />;
  if (content.isError) {
    if (notFound(content.error)) return hidden;
    return (
      <LoadError what={t("editor.include.loadFailed")} error={content.error} onRetry={content.refetch} />
    );
  }
  const { page, document, references, state } = content.data;
  if (state === "noExcerpt" || !document) return <Note>{t("editor.include.noExcerpt")}</Note>;
  const body = (
    <IncludeChain.Provider value={ancestors}>
      <PageReadView document={document} references={references as References} pageId={page.id} />
    </IncludeChain.Provider>
  );
  if (!panel) return body;
  return (
    <section
      className="ph-include-panel flex flex-col gap-2"
      aria-label={page.title || t("editor.readView.untitledPage")}
    >
      <TitleLink href={page.path}>{page.title || t("editor.readView.untitledPage")}</TitleLink>
      {body}
    </section>
  );
}

function pageLoader() {
  return async (query: string) => {
    const items = await request(() =>
      api.GET("/api/v1/items", { params: { query: { q: query, kind: "page", limit: 20 } } }),
    );
    return {
      items: items.map((item) => ({ value: item.id, label: item.title, description: item.spaceName })),
    };
  };
}

function IncludeSettings({
  type,
  attrs,
  onChange,
}: {
  type: string;
  attrs: Record<string, unknown>;
  onChange: (changes: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const pageId = textOrNull(attrs.pageId);
  const target = useQuery({ ...itemQuery(pageId ?? ""), enabled: pageId !== null, retry: false });
  const [name, setName] = useState(String(attrs.name ?? ""));
  const imported = textOrNull(attrs.sourceTitle);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field
        label={t("editor.include.page")}
        hint={
          imported && !pageId
            ? t("editor.include.importedHint", { title: imported })
            : t("editor.include.pageHint")
        }
      >
        <Combobox
          aria-label={t("editor.include.page")}
          placeholder={t("editor.reports.searchPage")}
          value={pageId}
          selectedItem={
            pageId
              ? {
                  value: pageId,
                  label: target.data?.title ?? (target.isError ? t("editor.reports.hiddenPage") : ""),
                }
              : null
          }
          load={pageLoader()}
          onValueChange={(value) => onChange({ pageId: value, sourceSpace: null, sourceTitle: null })}
        />
      </Field>
      {type === "includeExcerpt" ? (
        <>
          <Field label={t("editor.include.excerptName")} hint={t("editor.include.excerptNameHint")}>
            <Input
              value={name}
              maxLength={MAX_EXCERPT_NAME_LENGTH}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => onChange({ name: name.trim() || null })}
            />
          </Field>
          <div className="sm:col-span-2">
            <Checkbox
              checked={flag(attrs.panel)}
              onCheckedChange={(panel) => onChange({ panel })}
              label={t("editor.include.panel")}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}

export function IncludeView({ node, editor, updateAttributes, selected }: NodeViewProps) {
  const editable = useEditable(editor);
  const { t } = useTranslation();
  const page = usePageContext();
  const type = node.type.name;
  const include = includeFromAttrs(type, node.attrs);
  const title = t(type === "includeExcerpt" ? "editor.include.excerptTitle" : "editor.include.pageTitle");
  const Icon = type === "includeExcerpt" ? TextQuote : FileInput;
  return (
    <NodeViewWrapper
      className={`ph-include-block${selected ? " ph-node-selected" : ""}`}
      contentEditable={false}
      data-type={type}
    >
      <section className="flex flex-col gap-3" aria-label={title}>
        <h3 className="flex items-center gap-2 font-semibold">
          <Icon aria-hidden="true" className="size-icon-md" />
          {title}
        </h3>
        {editable ? (
          <IncludeSettings type={type} attrs={node.attrs} onChange={(changes) => updateAttributes(changes)} />
        ) : null}
        {page ? (
          <IncludedContent
            include={include}
            hostId={page.pageId}
            panel={type === "includeExcerpt" && flag(node.attrs.panel)}
            placeholders
          />
        ) : null}
      </section>
    </NodeViewWrapper>
  );
}

export function ExcerptView({ node, editor, updateAttributes }: NodeViewProps) {
  const editable = useEditable(editor);
  const { t } = useTranslation();
  const [name, setName] = useState(String(node.attrs.name ?? ""));
  const hidden = node.attrs.hidden === true;
  return (
    <NodeViewWrapper className="ph-excerpt-block" data-hidden={hidden ? "true" : undefined}>
      <div contentEditable={false} className="ph-block-header">
        <span className="flex items-center gap-2 font-semibold">
          <Quote aria-hidden="true" className="size-icon-md" />
          {t(hidden ? "editor.excerpt.hiddenTitle" : "editor.excerpt.title")}
        </span>
        {editable ? (
          <span className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2 text-sm">
              <span aria-hidden="true">{t("editor.excerpt.name")}</span>
              <Input
                aria-label={t("editor.excerpt.nameLabel")}
                className="w-auto"
                value={name}
                maxLength={MAX_EXCERPT_NAME_LENGTH}
                placeholder={t("editor.excerpt.namePlaceholder")}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => updateAttributes({ name: name.trim() || null })}
              />
            </span>
            <Checkbox
              checked={hidden}
              onCheckedChange={(value) => updateAttributes({ hidden: value })}
              label={t("editor.excerpt.hide")}
            />
          </span>
        ) : null}
      </div>
      {hidden ? (
        <p contentEditable={false} className="text-sm text-text-muted">
          {t("editor.excerpt.hiddenNote")}
        </p>
      ) : null}
      <NodeViewContent className="ph-excerpt-content" />
    </NodeViewWrapper>
  );
}
