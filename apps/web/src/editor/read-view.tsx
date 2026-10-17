import { isIsoDate, type RenderContext, renderHtml, type TextAnchor } from "@pagehall/editor-schema";
import { Button, useToast } from "@pagehall/ui";
import type { TFunction } from "i18next";
import { MessageSquarePlus } from "lucide-react";
import { type MouseEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { CommentHighlights } from "../collaboration/comment-highlights.js";
import { reportFilters, TaskReport } from "../collaboration/task-report.js";
import { contentUrl } from "../files/attachments-api.js";
import { useAttachmentPreview } from "../files/preview-host.js";
import type { Formatter } from "../format/format.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { useOpenPath } from "./context.js";
import { anchorFromSelection } from "./dom-anchor.js";
import { IncludedContent, includeFromAttrs } from "./includes.js";
import {
  ContentByLabelList,
  contentByLabelDisplayFromAttrs,
  contentByLabelFromAttrs,
  RelatedLabelsList,
} from "./label-blocks.js";
import { AttachmentList, ChildPagesList, childPagesFromAttrs, fileTypesOf } from "./listings.js";
import {
  listOf,
  PropertiesReportTable,
  propertiesDisplayFromAttrs,
  propertiesReportFromAttrs,
} from "./properties.js";
import { followTitleLink, pagePath, type References, rememberReferences } from "./references.js";
import {
  DecisionReportList,
  decisionReportFromAttrs,
  PageReportTable,
  pageReportFromAttrs,
} from "./reports.js";
import { TemplateButton, templateButtonFromAttrs } from "./template-button.js";
import "./editor.css";

export const FOLLOW_PATH = "/follow-link";

export function readViewContext(
  references: References,
  t: TFunction,
  format: Formatter,
  attachmentUrl: (id: string, version?: number) => string = (id, version) =>
    contentUrl(id, version === undefined ? {} : { version }),
): RenderContext {
  return {
    attachment: (id, version) => ({ href: attachmentUrl(id, version) }),
    mention: (id) => {
      const name = references.people[id];
      return name ? { name } : null;
    },
    topic: (id) => references.topics?.[id] ?? null,
    pageLink: (link) => {
      if (link.pageId) {
        const page = references.pages[link.pageId];
        if (!page) return null;
        if (page.inTrash) return { href: "", title: page.title, accessible: false, inTrash: true };
        return page.accessible
          ? { href: pagePath(page.spaceKey, link.pageId, page.title), title: page.title, accessible: true }
          : { href: "", title: "", accessible: false };
      }
      const query = new URLSearchParams({ space: link.spaceId ?? "", title: link.title ?? "" });
      return { href: `${FOLLOW_PATH}?${query.toString()}`, title: link.title ?? "", accessible: true };
    },
    formatDate: (iso) => (isIsoDate(iso) ? format.date(`${iso}T12:00:00Z`) : iso),
    formatMonth: (iso) => (isIsoDate(iso) ? format.month(`${iso}T12:00:00Z`) : iso),
    labels: {
      noAccess: t("editor.pageLink.noAccess"),
      inTrash: t("editor.pageLink.inTrash"),
      taskDone: t("editor.readView.taskDone"),
      taskOpen: t("editor.readView.taskOpen"),
      untitledPage: t("editor.readView.untitledPage"),
      unknownPerson: t("editor.mention.unknown"),
      unsupportedMacro: t("editor.readView.unsupportedMacro"),
      taskReport: t("tasks.report.title"),
      decision: t("editor.decision.label"),
      unknownTopic: t("editor.topicUpdate.unknown"),
      tableOfContents: t("editor.toc.title"),
      file: t("editor.readView.file"),
      image: t("editor.readView.image"),
      drawing: t("editor.drawing.label"),
      childPages: t("editor.childPages.title"),
      noChildPages: t("editor.childPages.empty"),
      attachmentList: t("editor.attachmentList.title"),
      noAttachments: t("editor.attachmentList.empty"),
      pageReport: t("editor.pageReport.title"),
      noReportedPages: t("editor.pageReport.empty"),
      decisionReport: t("editor.decisionReport.title"),
      noReportedDecisions: t("editor.decisionReport.empty"),
      reportTitle: t("editor.pageReport.page"),
      reportAuthor: t("editor.pageReport.author"),
      reportUpdated: t("editor.pageReport.updated"),
      templateButton: t("editor.templateButton.defaultLabel"),
      pageProperties: t("editor.pageProperties.title"),
      propertiesReport: t("editor.propertiesReport.title"),
      noReportedProperties: t("editor.propertiesReport.empty"),
      propertiesReportCreator: t("editor.propertiesReport.creator"),
      propertiesReportLabels: t("editor.propertiesReport.labels"),
      contentByLabel: t("editor.contentByLabel.title"),
      noLabeledContent: t("editor.contentByLabel.empty"),
      relatedLabels: t("editor.relatedLabels.title"),
      noRelatedLabels: t("editor.relatedLabels.empty"),
      excerpt: t("editor.excerpt.title"),
      hiddenExcerpt: t("editor.excerpt.hiddenTitle"),
      includedPage: t("editor.include.pageTitle"),
      includedExcerpt: t("editor.include.excerptTitle"),
      restrictedContent: t("editor.include.restricted"),
      includeLoop: t("editor.include.loop"),
      includeTooDeep: t("editor.include.tooDeep"),
      noExcerpt: t("editor.include.noExcerpt"),
      roadmap: t("editor.roadmap.title"),
      roadmapReadOnly: t("editor.roadmap.readOnly"),
      roadmapAsList: t("editor.roadmap.asList"),
      callout: {
        info: t("editor.callout.info"),
        tip: t("editor.callout.tip"),
        note: t("editor.callout.note"),
        warning: t("editor.callout.warning"),
        error: t("editor.callout.error"),
      },
    },
  };
}

export function applyWidths(root: HTMLElement): void {
  for (const column of Array.from(root.querySelectorAll<HTMLElement>(".ph-column[data-width]"))) {
    column.style.setProperty("--column-width", `${Number(column.dataset.width)}%`);
  }
  for (const table of Array.from(root.querySelectorAll<HTMLTableElement>(".ph-table table"))) {
    const firstRow = table.rows[0];
    if (!firstRow) continue;
    const widths: (number | null)[] = [];
    for (const cell of Array.from(firstRow.cells)) {
      const values = (cell.dataset.colwidth ?? "").split(",").map((value) => Number(value));
      for (let index = 0; index < cell.colSpan; index += 1) {
        const width = values[index];
        widths.push(width && Number.isFinite(width) ? width : null);
      }
    }
    if (widths.every((width) => width === null)) continue;
    const group = document.createElement("colgroup");
    for (const width of widths) {
      const col = document.createElement("col");
      if (width) col.style.width = `${width}px`;
      group.append(col);
    }
    table.prepend(group);
  }
}

export interface ReadViewAttachments {
  url?: (id: string, version?: number) => string;
  onOpen?: (id: string) => void;
}

export interface ReadViewCollaboration {
  taskStatuses?: ReadonlyMap<string, boolean>;
  canToggleTask?: (task: { id: string; assignee: string | null }) => boolean;
  onToggleTask?: (taskId: string, done: boolean) => void;
  openThreads?: readonly string[];
  activeThread?: string | null;
  onThreadClick?: (threadId: string) => void;
  onCommentSelection?: (anchor: TextAnchor) => void;
  spaceId?: string | null;
}

const NO_COLLABORATION: ReadViewCollaboration = {};

export function PageReadView({
  document: content,
  references,
  pageId,
  collaboration = NO_COLLABORATION,
  attachments,
}: {
  document: unknown;
  references: References;
  pageId: string;
  collaboration?: ReadViewCollaboration;
  attachments?: ReadViewAttachments;
}) {
  const preview = useAttachmentPreview();
  const openAttachment = attachments?.onOpen ?? preview?.open;
  const attachmentUrl = attachments?.url;
  const { t } = useTranslation();
  const format = useFormat();
  const open = useOpenPath();
  const { toast } = useToast();
  const container = useRef<HTMLDivElement>(null);
  const [reports, setReports] = useState<HTMLElement[]>([]);
  const [childPages, setChildPages] = useState<HTMLElement[]>([]);
  const [attachmentLists, setAttachmentLists] = useState<HTMLElement[]>([]);
  const [pageReports, setPageReports] = useState<HTMLElement[]>([]);
  const [decisionReports, setDecisionReports] = useState<HTMLElement[]>([]);
  const [templateButtons, setTemplateButtons] = useState<HTMLElement[]>([]);
  const [propertiesReports, setPropertiesReports] = useState<HTMLElement[]>([]);
  const [labelLists, setLabelLists] = useState<HTMLElement[]>([]);
  const [relatedLabels, setRelatedLabels] = useState<HTMLElement[]>([]);
  const [includes, setIncludes] = useState<HTMLElement[]>([]);
  const [selection, setSelection] = useState<{ anchor: TextAnchor; top: number; left: number } | null>(null);
  const { taskStatuses, canToggleTask, onToggleTask, openThreads = [], activeThread = null } = collaboration;
  const html = useMemo(() => {
    try {
      return renderHtml(content, readViewContext(references, t, format, attachmentUrl));
    } catch {
      return null;
    }
  }, [content, references, t, format, attachmentUrl]);

  useLayoutEffect(() => {
    rememberReferences(references);
  }, [references]);

  useLayoutEffect(() => {
    const root = container.current;
    if (!root || html === null) return;
    applyWidths(root);
    const placeholders = (selector: string) => {
      const found = Array.from(root.querySelectorAll<HTMLElement>(selector));
      for (const element of found) element.replaceChildren();
      return found;
    };
    setReports(placeholders(".ph-task-report"));
    setChildPages(placeholders(".ph-child-pages"));
    setAttachmentLists(placeholders(".ph-attachment-list"));
    setPageReports(placeholders(".ph-page-report"));
    setDecisionReports(placeholders(".ph-decision-report"));
    setTemplateButtons(placeholders(".ph-template-button"));
    setPropertiesReports(placeholders(".ph-properties-report"));
    setLabelLists(placeholders(".ph-content-by-label"));
    setRelatedLabels(placeholders(".ph-related-labels"));
    setIncludes(placeholders(".ph-include"));
  }, [html]);

  useLayoutEffect(() => {
    const root = container.current;
    if (!root || html === null) return;
    for (const input of Array.from(
      root.querySelectorAll<HTMLInputElement>(".ph-task-item[data-task-id] > input"),
    )) {
      const item = input.parentElement as HTMLElement;
      const id = item.dataset.taskId ?? "";
      const text = item.querySelector(":scope > div")?.textContent?.trim() ?? "";
      const done = taskStatuses?.get(id) ?? false;
      const allowed =
        onToggleTask !== undefined &&
        (canToggleTask?.({ id, assignee: item.dataset.assignee ?? null }) ?? false);
      input.checked = done;
      item.dataset.checked = done ? "true" : "false";
      input.disabled = !allowed;
      input.setAttribute(
        "aria-label",
        allowed
          ? t(done ? "tasks.markOpen" : "tasks.markDone", { task: text })
          : t(done ? "editor.readView.taskDone" : "editor.readView.taskOpen"),
      );
    }
  }, [html, taskStatuses, canToggleTask, onToggleTask, t]);

  const onClick = async (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.type === "checkbox") {
      const id = target.closest<HTMLElement>(".ph-task-item")?.dataset.taskId;
      if (id) onToggleTask?.(id, target.checked);
      return;
    }
    const file = target.closest<HTMLElement>(".ph-file[data-attachment-id]");
    if (file && openAttachment && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
      event.preventDefault();
      openAttachment(file.dataset.attachmentId ?? "");
      return;
    }
    const thread = target.closest<HTMLElement>("[data-thread-id]")?.dataset.threadId;
    const link = target.closest<HTMLAnchorElement>("a[href]");
    if (thread && !link && openThreads.includes(thread)) collaboration.onThreadClick?.(thread);
    if (
      !link ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey
    ) {
      return;
    }
    const href = link.getAttribute("href") ?? "";
    if (!href.startsWith("/")) return;
    event.preventDefault();
    if (!href.startsWith(FOLLOW_PATH)) {
      open(href);
      return;
    }
    const query = new URL(href, globalThis.location.origin).searchParams;
    try {
      open(
        await followTitleLink(pageId, { spaceId: query.get("space") ?? "", title: query.get("title") ?? "" }),
      );
    } catch {
      toast({
        variant: "error",
        title: t("editor.pageLink.followFailed"),
        description: t("editor.pageLink.followFailedDescription"),
      });
    }
  };

  const onCommentSelection = collaboration.onCommentSelection;
  useEffect(() => {
    if (!onCommentSelection) return;
    const track = () => {
      const root = container.current;
      const found = root ? anchorFromSelection(root) : null;
      if (!root || !found) {
        setSelection(null);
        return;
      }
      const bounds = root.getBoundingClientRect();
      setSelection({
        anchor: found.anchor,
        top: found.rect.bottom - bounds.top,
        left: Math.max(0, found.rect.left - bounds.left),
      });
    };
    document.addEventListener("selectionchange", track);
    return () => document.removeEventListener("selectionchange", track);
  }, [onCommentSelection]);

  if (html === null) {
    return (
      <p role="alert" className="text-danger">
        {t("editor.readView.invalid")}
      </p>
    );
  }
  const scope = `read-${pageId}`;
  return (
    <div className="relative">
      <CommentHighlights scope={`[data-comment-scope="${scope}"]`} open={openThreads} active={activeThread} />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: clicks come from the links and checkboxes inside, which are keyboard operable */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the links and checkboxes inside handle their own keyboard input */}
      <div
        ref={container}
        className="ph-content ph-read-view"
        data-comment-scope={scope}
        onClick={(event) => void onClick(event)}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: the shared renderer escapes all content of the validated document
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {selection && onCommentSelection ? (
        <div className="absolute z-10" style={{ top: selection.top, left: selection.left }}>
          <Button
            size="sm"
            variant="secondary"
            icon={MessageSquarePlus}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              onCommentSelection(selection.anchor);
              setSelection(null);
            }}
          >
            {t("comments.commentOnSelection")}
          </Button>
        </div>
      ) : null}
      {reports.map((element) =>
        createPortal(
          <TaskReport
            filters={reportFilters(element.dataset)}
            currentSpaceId={collaboration.spaceId ?? null}
          />,
          element,
        ),
      )}
      {childPages.map((element) =>
        createPortal(
          <ChildPagesList request={childPagesFromAttrs(element.dataset)} currentPageId={pageId} />,
          element,
        ),
      )}
      {attachmentLists.map((element) =>
        createPortal(
          <AttachmentList pageId={pageId} fileTypes={fileTypesOf(element.dataset.fileTypes ?? "")} />,
          element,
        ),
      )}
      {pageReports.map((element) =>
        createPortal(<PageReportTable request={pageReportFromAttrs(element.dataset)} />, element),
      )}
      {decisionReports.map((element) =>
        createPortal(<DecisionReportList request={decisionReportFromAttrs(element.dataset)} />, element),
      )}
      {propertiesReports.map((element) =>
        createPortal(
          <PropertiesReportTable
            report={propertiesReportFromAttrs(element.dataset)}
            display={propertiesDisplayFromAttrs(element.dataset)}
          />,
          element,
        ),
      )}
      {labelLists.map((element) =>
        createPortal(
          <>
            {element.dataset.title ? <h3 className="font-semibold">{element.dataset.title}</h3> : null}
            <ContentByLabelList
              request={contentByLabelFromAttrs(element.dataset)}
              display={contentByLabelDisplayFromAttrs(element.dataset)}
            />
          </>,
          element,
        ),
      )}
      {relatedLabels.map((element) =>
        createPortal(
          <>
            <h3 className="font-semibold">{element.dataset.title || t("editor.relatedLabels.title")}</h3>
            <RelatedLabelsList pageId={pageId} labels={listOf(element.dataset.labels)} />
          </>,
          element,
        ),
      )}
      {includes.map((element) =>
        createPortal(
          <IncludedContent
            include={includeFromAttrs(
              element.classList.contains("ph-include-excerpt") ? "includeExcerpt" : "includePage",
              element.dataset,
            )}
            hostId={pageId}
            panel={element.dataset.panel === "true"}
          />,
          element,
        ),
      )}
      {templateButtons.map((element) =>
        createPortal(
          <TemplateButton button={templateButtonFromAttrs(element.dataset)} parentId={pageId} />,
          element,
        ),
      )}
    </div>
  );
}
