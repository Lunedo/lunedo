import { isIsoDate, type RenderContext, renderHtml } from "@pagehall/editor-schema";
import { useToast } from "@pagehall/ui";
import type { TFunction } from "i18next";
import { type MouseEvent, useLayoutEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { Formatter } from "../format/format.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { useOpenPath } from "./context.js";
import { followTitleLink, pagePath, type References, rememberReferences } from "./references.js";
import "./editor.css";

export const FOLLOW_PATH = "/follow-link";

export function readViewContext(references: References, t: TFunction, format: Formatter): RenderContext {
  return {
    mention: (id) => {
      const name = references.people[id];
      return name ? { name } : null;
    },
    pageLink: (link) => {
      if (link.pageId) {
        const page = references.pages[link.pageId];
        if (!page) return null;
        return page.accessible
          ? { href: pagePath(page.spaceKey, link.pageId, page.title), title: page.title, accessible: true }
          : { href: "", title: "", accessible: false };
      }
      const query = new URLSearchParams({ space: link.spaceId ?? "", title: link.title ?? "" });
      return { href: `${FOLLOW_PATH}?${query.toString()}`, title: link.title ?? "", accessible: true };
    },
    formatDate: (iso) => (isIsoDate(iso) ? format.date(`${iso}T12:00:00Z`) : iso),
    labels: {
      noAccess: t("editor.pageLink.noAccess"),
      untitledPage: t("editor.readView.untitledPage"),
      unknownPerson: t("editor.mention.unknown"),
      unsupportedMacro: t("editor.readView.unsupportedMacro"),
      tableOfContents: t("editor.toc.title"),
      file: t("editor.readView.file"),
      image: t("editor.readView.image"),
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

export function PageReadView({
  document: content,
  references,
  pageId,
}: {
  document: unknown;
  references: References;
  pageId: string;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const open = useOpenPath();
  const { toast } = useToast();
  const container = useRef<HTMLDivElement>(null);
  const html = useMemo(() => {
    try {
      return renderHtml(content, readViewContext(references, t, format));
    } catch {
      return null;
    }
  }, [content, references, t, format]);

  useLayoutEffect(() => {
    rememberReferences(references);
  }, [references]);

  useLayoutEffect(() => {
    if (container.current && html !== null) applyWidths(container.current);
  }, [html]);

  const onClick = async (event: MouseEvent<HTMLDivElement>) => {
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
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

  if (html === null) {
    return (
      <p role="alert" className="text-danger">
        {t("editor.readView.invalid")}
      </p>
    );
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: clicks come from the links inside, which are keyboard operable
    // biome-ignore lint/a11y/useKeyWithClickEvents: Enter on a link inside fires this click
    <div
      ref={container}
      className="ph-content ph-read-view"
      onClick={(event) => void onClick(event)}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: the shared renderer escapes all content of the validated document
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
