import {
  type EmbedService,
  isIsoDate,
  type RenderContext,
  renderHtml,
  resolveEmbed,
  type TextAnchor,
} from "@lunedo/editor-schema";
import { Button, useToast } from "@lunedo/ui";
import type { TFunction } from "i18next";
import { MessageSquarePlus } from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { CommentHighlights } from "../collaboration/comment-highlights.js";
import { ThreadCounters } from "../collaboration/inline-threads.js";
import { reportFilters, TaskReport } from "../collaboration/task-report.js";
import { ReferencedDiagram } from "../diagrams/referenced-diagram.js";
import type { AttachmentUrl } from "../files/attachment-source.js";
import { contentUrl } from "../files/attachments-api.js";
import { useAttachmentPreview } from "../files/preview-host.js";
import type { Formatter } from "../format/format.js";
import { NamedIcon } from "../knowledge-bases/icons.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { useOpenPath } from "./context.js";
import { anchorFromSelection } from "./dom-anchor.js";
import {
  EmbedFrame,
  embedReferrerPolicy,
  InlineFilePreview,
  useEmbedServices,
  WhiteboardBlock,
} from "./embedded-blocks.js";
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
import { followTitleLink, type References, referenceHref, rememberReferences } from "./references.js";
import {
  DecisionReportList,
  decisionReportFromAttrs,
  PageReportTable,
  pageReportFromAttrs,
} from "./reports.js";
import { markScrollEdges } from "./scroll-edges.js";
import {
  ACCORDION_QUERY,
  enhanceTabs,
  handleTabsClick,
  handleTabsKey,
  setTabsMode,
} from "./tabs-behavior.js";
import { TemplateButton, templateButtonFromAttrs } from "./template-button.js";
import "./editor.css";
import { MEDIA, mediaOf } from "./media.js";

export const FOLLOW_PATH = "/follow-link";

export function readViewContext(
  references: References,
  t: TFunction,
  format: Formatter,
  attachmentUrl: AttachmentUrl = (id, version, size) =>
    contentUrl(id, { ...(version === undefined ? {} : { version }), ...(size ? { size } : {}) }),
  options: { embedServices?: readonly EmbedService[] | null; numberHeadings?: boolean } = {},
): RenderContext {
  const services = options.embedServices;
  return {
    ...(services ? { embed: (url: string) => resolveEmbed(url, services) } : {}),
    ...(options.numberHeadings ? { numberHeadings: true } : {}),
    attachment: (id, version) => ({
      href: attachmentUrl(id, version),
      display: attachmentUrl(id, version, "display"),
      ...(references.tooLargeImages?.includes(id) ? { tooLarge: true } : {}),
    }),
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
          ? { href: referenceHref(page), title: page.title, accessible: true }
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
      openFullSize: t("editor.readView.openFullSize"),
      imageTooLarge: t("editor.readView.imageTooLarge"),
      drawing: t("editor.drawing.label"),
      drawio: t("editor.drawio.label"),
      drawioReference: t("editor.drawioReference.label"),
      mermaid: t("editor.mermaid.label"),
      plantuml: t("editor.plantuml.label"),
      diagramSource: t("editor.diagram.source"),
      diagramNotRendered: t("editor.diagram.notRendered", { name: "{name}" }),
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
      restrictedContent: t("editor.readView.restrictedContent"),
      includeLoop: t("editor.include.loop"),
      includeTooDeep: t("editor.include.tooDeep"),
      noExcerpt: t("editor.include.noExcerpt"),
      roadmap: t("editor.roadmap.title"),
      roadmapReadOnly: t("editor.roadmap.readOnly"),
      roadmapAsList: t("editor.roadmap.asList"),
      embed: t("editor.embed.label"),
      embedNotAllowed: t("editor.embed.notAllowed"),
      embedFrom: t("editor.embed.from", { service: "{service}" }),
      whiteboard: t("editor.whiteboard.label"),
      chooseWhiteboard: t("editor.whiteboard.choose"),
      filePreview: t("editor.filePreview.label"),
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
  for (const column of Array.from(root.querySelectorAll<HTMLElement>(".ld-column[data-width]"))) {
    column.style.setProperty("--column-width", `${Number(column.dataset.width)}%`);
  }
  for (const image of Array.from(root.querySelectorAll<HTMLElement>(".ld-image[data-width]"))) {
    image.style.setProperty("--image-width", `${Number(image.dataset.width)}%`);
  }
  for (const table of Array.from(root.querySelectorAll<HTMLTableElement>(".ld-table table"))) {
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
  url?: AttachmentUrl;
  onOpen?: (id: string, siblings?: readonly string[]) => void;
}

export interface ReadViewCollaboration {
  taskStatuses?: ReadonlyMap<string, boolean>;
  canToggleTask?: (task: { id: string; assignee: string | null }) => boolean;
  onToggleTask?: (taskId: string, done: boolean) => void;
  openThreads?: readonly string[];
  activeThread?: string | null;
  onThreadClick?: (threadId: string) => void;
  onCommentSelection?: (anchor: TextAnchor) => void;
  onMarkedThreads?: (threadIds: string[]) => void;
  spaceId?: string | null;
}

const NO_COLLABORATION: ReadViewCollaboration = {};

export function PageReadView({
  document: content,
  references,
  pageId,
  collaboration = NO_COLLABORATION,
  attachments,
  numberHeadings = false,
  embedServices: givenEmbedServices,
}: {
  document: unknown;
  references: References;
  pageId: string;
  collaboration?: ReadViewCollaboration;
  attachments?: ReadViewAttachments;
  numberHeadings?: boolean;
  embedServices?: readonly EmbedService[];
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
  const [diagramReferences, setDiagramReferences] = useState<HTMLElement[]>([]);
  const [embeds, setEmbeds] = useState<HTMLElement[]>([]);
  const [whiteboards, setWhiteboards] = useState<HTMLElement[]>([]);
  const [filePreviews, setFilePreviews] = useState<HTMLElement[]>([]);
  const [sectionIcons, setSectionIcons] = useState<HTMLElement[]>([]);
  const organizationEmbedServices = useEmbedServices();
  const embedServices = givenEmbedServices ?? organizationEmbedServices;
  const [selection, setSelection] = useState<{ anchor: TextAnchor; top: number; left: number } | null>(null);
  const { taskStatuses, canToggleTask, onToggleTask, openThreads = [], activeThread = null } = collaboration;
  const html = useMemo(() => {
    try {
      return renderHtml(
        content,
        readViewContext(references, t, format, attachmentUrl, { embedServices, numberHeadings }),
      );
    } catch {
      return null;
    }
  }, [content, references, t, format, attachmentUrl, embedServices, numberHeadings]);

  const scrollLabel = useRef("");
  scrollLabel.current = t("editor.roadmap.scrollRegion");

  useLayoutEffect(() => {
    rememberReferences(references);
  }, [references]);

  const canOpen = Boolean(openAttachment);
  useLayoutEffect(() => {
    const root = container.current;
    if (!root || html === null || !canOpen) return;
    for (const figure of Array.from(root.querySelectorAll<HTMLElement>(".ld-image[data-attachment-id]"))) {
      const image = figure.querySelector("img");
      const label = t("files.lightbox.open", { name: image?.alt || t("editor.readView.image") });
      const link = figure.querySelector<HTMLAnchorElement>(":scope > .ld-image-full");
      if (link) {
        link.setAttribute("aria-label", label);
        link.removeAttribute("title");
      } else if (image && image.parentElement === figure) {
        image.tabIndex = 0;
        image.setAttribute("role", "button");
        image.setAttribute("aria-label", label);
      }
    }
  }, [html, canOpen, t]);

  useLayoutEffect(() => {
    const root = container.current;
    if (!root || html === null) return;
    applyWidths(root);
    const stopEdges = markScrollEdges(root, scrollLabel.current);
    const placeholders = (selector: string) => {
      const found = Array.from(root.querySelectorAll<HTMLElement>(selector));
      for (const element of found) element.replaceChildren();
      return found;
    };
    setReports(placeholders(".ld-task-report"));
    setChildPages(placeholders(".ld-child-pages"));
    setAttachmentLists(placeholders(".ld-attachment-list"));
    setPageReports(placeholders(".ld-page-report"));
    setDecisionReports(placeholders(".ld-decision-report"));
    setTemplateButtons(placeholders(".ld-template-button"));
    setPropertiesReports(placeholders(".ld-properties-report"));
    setLabelLists(placeholders(".ld-content-by-label"));
    setRelatedLabels(placeholders(".ld-related-labels"));
    setIncludes(placeholders(".ld-include"));
    setDiagramReferences(placeholders(".ld-diagram-reference"));
    setEmbeds(placeholders(".ld-embed-frame[data-src]"));
    setWhiteboards(placeholders(".ld-whiteboard[data-whiteboard-id]"));
    setSectionIcons(
      Array.from(root.querySelectorAll<HTMLElement>(".ld-section[data-icon] > h2")).map((heading) => {
        const slot = document.createElement("span");
        slot.className = "ld-section-icon-slot";
        heading.prepend(slot);
        return slot;
      }),
    );
    setFilePreviews(
      Array.from(root.querySelectorAll<HTMLElement>(".ld-file[data-preview]")).map((file) => {
        const slot = document.createElement("div");
        slot.className = "ld-file-preview-slot";
        file.append(slot);
        return slot;
      }),
    );
    const narrow = globalThis.matchMedia?.(ACCORDION_QUERY);
    const tabs = enhanceTabs(root, narrow?.matches ?? false);
    if (!narrow || tabs.length === 0) return stopEdges;
    const change = () => {
      for (const element of tabs) setTabsMode(element, narrow.matches);
    };
    narrow.addEventListener("change", change);
    return () => {
      narrow.removeEventListener("change", change);
      stopEdges();
    };
  }, [html]);

  useLayoutEffect(() => {
    const root = container.current;
    if (!root || html === null) return;
    for (const input of Array.from(
      root.querySelectorAll<HTMLInputElement>(".ld-task-item[data-task-id] > input"),
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
      const id = target.closest<HTMLElement>(".ld-task-item")?.dataset.taskId;
      if (id) onToggleTask?.(id, target.checked);
      return;
    }
    if (handleTabsClick(target)) return;
    if (target.closest(".ld-file-preview-slot")) return;
    const media = target.closest<HTMLElement>(MEDIA);
    if (media && openAttachment && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
      event.preventDefault();
      const root = container.current;
      openAttachment(media.dataset.attachmentId ?? "", root ? mediaOf(root) : []);
      return;
    }
    const thread = target.closest<HTMLElement>("[data-thread-id]")?.dataset.threadId;
    const link = target.closest<HTMLAnchorElement>("a[href]");
    if (thread && !link && openThreads.includes(thread)) collaboration.onThreadClick?.(thread);
    if (
      !link ||
      link.target === "_blank" ||
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

  const onThreadClick = collaboration.onThreadClick;
  const threadLabel = useRef(t);
  threadLabel.current = t;
  useLayoutEffect(() => {
    const root = container.current;
    if (!root || html === null || !onThreadClick) return;
    const marks = Array.from(root.querySelectorAll<HTMLElement>("[data-thread-id]")).filter((mark) =>
      openThreads.includes(mark.dataset.threadId ?? ""),
    );
    for (const mark of marks) {
      mark.tabIndex = 0;
      mark.setAttribute("role", "button");
      mark.setAttribute(
        "aria-label",
        threadLabel.current("comments.openThread", { quote: mark.textContent ?? "" }),
      );
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const mark = (event.target as HTMLElement).closest<HTMLElement>("[data-thread-id]");
      const id = mark?.dataset.threadId;
      if (!id || !openThreads.includes(id) || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      onThreadClick(id);
    };
    root.addEventListener("keydown", onKeyDown);
    return () => {
      root.removeEventListener("keydown", onKeyDown);
      for (const mark of marks) {
        mark.removeAttribute("tabindex");
        mark.removeAttribute("role");
        mark.removeAttribute("aria-label");
      }
    };
  }, [html, openThreads, onThreadClick]);

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
      <div
        ref={container}
        className="ld-content ld-read-view"
        data-comment-scope={scope}
        onClick={(event) => void onClick(event)}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          const image = (event.target as HTMLElement).closest<HTMLElement>(
            ".ld-image[data-attachment-id] > img",
          );
          if (image && openAttachment && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            const root = container.current;
            openAttachment(image.parentElement?.dataset.attachmentId ?? "", root ? mediaOf(root) : []);
            return;
          }
          handleTabsKey(event);
        }}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: the shared renderer escapes all content of the validated document
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {onThreadClick && openThreads.length > 0 ? (
        <ThreadCounters
          openThreads={openThreads}
          onOpen={onThreadClick}
          {...(collaboration.onMarkedThreads ? { onMarked: collaboration.onMarkedThreads } : {})}
        />
      ) : null}
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
              element.classList.contains("ld-include-excerpt") ? "includeExcerpt" : "includePage",
              element.dataset,
            )}
            hostId={pageId}
            panel={element.dataset.panel === "true"}
          />,
          element,
        ),
      )}
      {diagramReferences.map((element) =>
        createPortal(
          <ReferencedDiagram
            pageId={element.dataset.pageId ?? null}
            diagramId={element.dataset.diagramRef ?? null}
            name={element.dataset.name ?? ""}
            framed
          />,
          element,
        ),
      )}
      {embeds.map((element) =>
        createPortal(
          <EmbedFrame
            src={element.dataset.src ?? ""}
            referrerPolicy={embedReferrerPolicy(element.dataset.referrerPolicy)}
            title={element.dataset.title ?? ""}
            height={element.dataset.height ? Number(element.dataset.height) : null}
          />,
          element,
        ),
      )}
      {whiteboards.map((element) =>
        createPortal(<WhiteboardBlock whiteboardId={element.dataset.whiteboardId ?? null} />, element),
      )}
      {sectionIcons.map((element) =>
        createPortal(
          <NamedIcon
            name={(element.parentElement?.parentElement as HTMLElement | null)?.dataset.icon}
            className="ld-section-icon"
          />,
          element,
        ),
      )}
      {filePreviews.map((element) => {
        const file = element.parentElement as HTMLElement;
        return createPortal(
          <InlineFilePreview
            attachmentId={file.dataset.attachmentId ?? ""}
            height={file.dataset.height ? Number(file.dataset.height) : null}
            zoom={file.dataset.zoom ? Number(file.dataset.zoom) : null}
            onHidden={() => {
              file.hidden = true;
            }}
          />,
          element,
        );
      })}
      {templateButtons.map((element) =>
        createPortal(
          <TemplateButton button={templateButtonFromAttrs(element.dataset)} parentId={pageId} />,
          element,
        ),
      )}
    </div>
  );
}
