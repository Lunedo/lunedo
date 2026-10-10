import {
  type ChildPageSort,
  type ChildPagesRequest,
  childPageSorts,
  MAX_CHILD_PAGE_DEPTH,
  MAX_FILE_TYPES,
  matchesFileTypes,
} from "@pagehall/editor-schema";
import { Checkbox, Combobox, type ComboboxLoader, Field, Input, Select, SkeletonText } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { type NodeViewProps, NodeViewWrapper } from "@tiptap/react";
import { Files, FolderTree } from "lucide-react";
import { type KeyboardEvent, type MouseEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { ApiError, request } from "../api/request.js";
import { LoadError } from "../errors/failure.js";
import { attachmentsQuery, contentUrl } from "../files/attachments-api.js";
import { useAttachmentPreview } from "../files/preview-host.js";
import { translateKey } from "../i18n/translate.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { childrenQuery, itemQuery, type TreeItem } from "../spaces/space-queries.js";
import { useEditable, useOpenPath, usePageContext } from "./context.js";
import { pagePath } from "./references.js";

const pageLoader: ComboboxLoader = async (query) => {
  const items = await request(() =>
    api.GET("/api/v1/items", { params: { query: { q: query, kind: "page", limit: 20 } } }),
  );
  return {
    items: items.map((item) => ({ value: item.id, label: item.title, description: item.spaceName })),
    nextCursor: null,
  };
};

const DEPTH_CHOICES = [1, 2, 3, 4, 5];

function hidden(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 403 || error.status === 404);
}

export function childPagesFromAttrs(attrs: Record<string, unknown>): ChildPagesRequest {
  const depth = Number(attrs.depth);
  const sort = String(attrs.sort ?? "tree");
  return {
    pageId: typeof attrs.pageId === "string" && attrs.pageId.length > 0 ? attrs.pageId : null,
    depth: Number.isInteger(depth) && depth >= 1 && depth <= MAX_CHILD_PAGE_DEPTH ? depth : null,
    sort: (childPageSorts as readonly string[]).includes(sort) ? (sort as ChildPageSort) : "tree",
    reverse: attrs.reverse === true || attrs.reverse === "true",
  };
}

export function fileTypesOf(value: unknown): string[] {
  if (typeof value === "string") return value.split(",").filter((type) => /^[a-z0-9]{1,16}$/.test(type));
  return Array.isArray(value) ? value.filter((type): type is string => typeof type === "string") : [];
}

export function parseFileTypes(input: string): string[] | null {
  const types: string[] = [];
  for (const part of input.split(/[\s,;]+/)) {
    const value = part.replace(/^\*?\./, "").toLowerCase();
    if (value.length === 0) continue;
    if (!/^[a-z0-9]{1,16}$/.test(value)) return null;
    if (!types.includes(value)) types.push(value);
  }
  return types.length <= MAX_FILE_TYPES ? types : null;
}

function sortedPages(items: readonly TreeItem[], request: ChildPagesRequest): TreeItem[] {
  const pages = items.filter((item) => item.kind === "page");
  const key = (item: TreeItem) =>
    request.sort === "created" ? item.createdAt : request.sort === "modified" ? item.contentUpdatedAt : "";
  const sorted =
    request.sort === "title"
      ? [...pages].sort((left, right) => left.title.localeCompare(right.title))
      : request.sort === "tree"
        ? pages
        : [...pages].sort((left, right) => key(left).localeCompare(key(right)));
  return request.reverse ? [...sorted].reverse() : sorted;
}

function PageAnchor({ href, children }: { href: string; children: string }) {
  const open = useOpenPath();
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    open(href);
  };
  return (
    <a href={href} onClick={follow}>
      {children}
    </a>
  );
}

function ChildLevel({
  spaceId,
  spaceKey,
  parentId,
  level,
  request,
}: {
  spaceId: string;
  spaceKey: string;
  parentId: string;
  level: number;
  request: ChildPagesRequest;
}) {
  const { t } = useTranslation();
  const children = useQuery({ ...childrenQuery(spaceId, parentId), retry: false });
  if (children.isPending) return level === 1 ? <SkeletonText lines={2} /> : null;
  if (children.isError) {
    if (hidden(children.error)) return level === 1 ? <Empty text={t("editor.childPages.empty")} /> : null;
    return (
      <LoadError what={t("editor.childPages.loadFailed")} error={children.error} onRetry={children.refetch} />
    );
  }
  const pages = sortedPages(children.data, request);
  if (pages.length === 0) return level === 1 ? <Empty text={t("editor.childPages.empty")} /> : null;
  const maxDepth = request.depth ?? MAX_CHILD_PAGE_DEPTH;
  return (
    <ul>
      {pages.map((page) => (
        <li key={page.id}>
          <PageAnchor href={pagePath(spaceKey, page.id, page.title)}>
            {page.title || t("editor.readView.untitledPage")}
          </PageAnchor>
          {page.hasChildren && level < maxDepth ? (
            <ChildLevel
              spaceId={spaceId}
              spaceKey={spaceKey}
              parentId={page.id}
              level={level + 1}
              request={request}
            />
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-text-muted">{text}</p>;
}

export function ChildPagesList({
  request,
  currentPageId,
}: {
  request: ChildPagesRequest;
  currentPageId: string | null;
}) {
  const { t } = useTranslation();
  const rootId = request.pageId ?? currentPageId;
  const root = useQuery({ ...itemQuery(rootId ?? ""), enabled: rootId !== null, retry: false });
  if (!rootId) return <Empty text={t("editor.childPages.ofThisPageLater")} />;
  if (root.isPending) return <SkeletonText lines={2} />;
  if (root.isError) {
    if (hidden(root.error)) return <Empty text={t("editor.childPages.empty")} />;
    return <LoadError what={t("editor.childPages.loadFailed")} error={root.error} onRetry={root.refetch} />;
  }
  if (!root.data.spaceAccess) return <Empty text={t("editor.childPages.empty")} />;
  return (
    <ChildLevel
      spaceId={root.data.spaceId}
      spaceKey={root.data.spaceKey}
      parentId={rootId}
      level={1}
      request={request}
    />
  );
}

export function AttachmentList({
  pageId,
  fileTypes,
}: {
  pageId: string | null;
  fileTypes: readonly string[];
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const preview = useAttachmentPreview();
  const attachments = useQuery({ ...attachmentsQuery(pageId ?? ""), enabled: pageId !== null, retry: false });
  if (!pageId) return <Empty text={t("editor.attachmentList.ofThisPageLater")} />;
  if (attachments.isPending) return <SkeletonText lines={2} />;
  if (attachments.isError) {
    if (hidden(attachments.error)) return <Empty text={t("editor.attachmentList.empty")} />;
    return (
      <LoadError
        what={t("editor.attachmentList.loadFailed")}
        error={attachments.error}
        onRetry={attachments.refetch}
      />
    );
  }
  const listed = attachments.data.filter((attachment) => matchesFileTypes(attachment.name, fileTypes));
  if (listed.length === 0) {
    return (
      <Empty
        text={fileTypes.length > 0 ? t("editor.attachmentList.noneOfType") : t("editor.attachmentList.empty")}
      />
    );
  }
  return (
    <ul>
      {listed.map((attachment) => (
        <li key={attachment.id}>
          <a
            href={contentUrl(attachment.id)}
            className="min-w-0 wrap-anywhere"
            onClick={(event) => {
              if (!preview || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
              event.preventDefault();
              event.stopPropagation();
              preview.open(attachment.id);
            }}
          >
            {attachment.name}
          </a>
          <span className="ml-2 text-sm text-text-muted">
            {t("editor.attachmentList.details", {
              size: format.bytes(attachment.size),
              version: attachment.version,
            })}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ChildPagesSettings({
  request,
  onChange,
}: {
  request: ChildPagesRequest;
  onChange: (changes: Partial<ChildPagesRequest>) => void;
}) {
  const { t } = useTranslation();
  const [choosing, setChoosing] = useState(false);
  const target = useQuery({
    ...itemQuery(request.pageId ?? ""),
    enabled: request.pageId !== null,
    retry: false,
  });
  const scope = request.pageId || choosing ? "other" : "this";
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t("editor.childPages.scope")}>
        <Select
          value={scope}
          onValueChange={(value) => {
            setChoosing(value === "other");
            if (value === "this") onChange({ pageId: null });
          }}
          options={[
            { value: "this", label: t("editor.childPages.thisPage") },
            { value: "other", label: t("editor.childPages.otherPage") },
          ]}
        />
      </Field>
      {scope === "other" ? (
        <Field label={t("editor.childPages.page")}>
          <Combobox
            aria-label={t("editor.childPages.page")}
            placeholder={t("editor.childPages.searchPage")}
            value={request.pageId}
            selectedItem={request.pageId ? { value: request.pageId, label: target.data?.title ?? "" } : null}
            load={pageLoader}
            onValueChange={(value) => onChange({ pageId: value })}
          />
        </Field>
      ) : null}
      <Field label={t("editor.childPages.depth")}>
        <Select
          value={request.depth === null ? "all" : String(request.depth)}
          onValueChange={(value) => onChange({ depth: value === "all" ? null : Number(value) })}
          options={[
            ...[...new Set([...DEPTH_CHOICES, ...(request.depth === null ? [] : [request.depth])])]
              .sort((left, right) => left - right)
              .map((depth) => ({
                value: String(depth),
                label: t("editor.childPages.levels", { count: depth }),
              })),
            { value: "all", label: t("editor.childPages.allLevels") },
          ]}
        />
      </Field>
      <Field label={t("editor.childPages.sort")}>
        <Select
          value={request.sort}
          onValueChange={(value) => onChange({ sort: value as ChildPageSort })}
          options={childPageSorts.map((sort) => ({
            value: sort,
            label: translateKey(t, `editor.childPages.sorts.${sort}`),
          }))}
        />
      </Field>
      <div className="sm:col-span-2">
        <Checkbox
          checked={request.reverse}
          onCheckedChange={(reverse) => onChange({ reverse })}
          label={t("editor.childPages.reverse")}
        />
      </div>
    </div>
  );
}

export function FileTypesField({
  fileTypes,
  onChange,
}: {
  fileTypes: readonly string[];
  onChange: (fileTypes: string[]) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const parsed = parseFileTypes(draft);
    if (!parsed) {
      setError(t("editor.attachmentList.fileTypesInvalid", { count: MAX_FILE_TYPES }));
      return;
    }
    setError(null);
    setDraft(null);
    onChange(parsed);
  };
  return (
    <Field
      label={t("editor.attachmentList.fileTypes")}
      hint={t("editor.attachmentList.fileTypesHint")}
      error={error ?? undefined}
    >
      <Input
        value={draft ?? fileTypes.join(", ")}
        invalid={error !== null}
        onChange={(event) => {
          setDraft(event.target.value);
          if (error !== null && parseFileTypes(event.target.value)) setError(null);
        }}
        onBlur={commit}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
      />
    </Field>
  );
}

export function ChildPagesView({ node, editor, updateAttributes, selected }: NodeViewProps) {
  const editable = useEditable(editor);
  const { t } = useTranslation();
  const page = usePageContext();
  const request = childPagesFromAttrs(node.attrs);
  return (
    <NodeViewWrapper
      className={`ph-child-pages-block${selected ? " ph-node-selected" : ""}`}
      contentEditable={false}
      data-type="childPages"
    >
      <section className="ph-child-pages flex flex-col gap-3" aria-label={t("editor.childPages.title")}>
        <h3 className="flex items-center gap-2 font-semibold">
          <FolderTree aria-hidden="true" className="size-icon-md" />
          {t("editor.childPages.title")}
        </h3>
        {editable ? (
          <ChildPagesSettings request={request} onChange={(changes) => updateAttributes(changes)} />
        ) : null}
        <ChildPagesList request={request} currentPageId={page?.pageId ?? null} />
      </section>
    </NodeViewWrapper>
  );
}

export function AttachmentListView({ node, editor, updateAttributes, selected }: NodeViewProps) {
  const editable = useEditable(editor);
  const { t } = useTranslation();
  const page = usePageContext();
  const fileTypes = fileTypesOf(node.attrs.fileTypes);
  return (
    <NodeViewWrapper
      className={`ph-attachment-list-block${selected ? " ph-node-selected" : ""}`}
      contentEditable={false}
      data-type="attachmentList"
    >
      <section
        className="ph-attachment-list flex flex-col gap-3"
        aria-label={t("editor.attachmentList.title")}
      >
        <h3 className="flex items-center gap-2 font-semibold">
          <Files aria-hidden="true" className="size-icon-md" />
          {t("editor.attachmentList.title")}
        </h3>
        {editable ? (
          <FileTypesField fileTypes={fileTypes} onChange={(next) => updateAttributes({ fileTypes: next })} />
        ) : null}
        <AttachmentList pageId={page?.pageId ?? null} fileTypes={fileTypes} />
      </section>
    </NodeViewWrapper>
  );
}
