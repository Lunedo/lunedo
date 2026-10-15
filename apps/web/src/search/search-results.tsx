import { Badge, Highlighted } from "@pagehall/ui";
import { Link } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import {
  ChevronRight,
  FileText,
  Flag,
  type LucideIcon,
  MessageSquare,
  Newspaper,
  Paperclip,
  Repeat,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { topicPath } from "../meetings/queries.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { itemSlug } from "../spaces/item-paths.js";
import { StatusBadge } from "../spaces/ownership/page-status.js";
import { blogPostPath, pagePath } from "../spaces/space-queries.js";
import type { SearchHit } from "./search-api.js";

export interface HitTarget {
  to: string;
  attachment?: string;
  hash?: string;
}

function itemPath(hit: SearchHit, itemId: string, title: string): string {
  const spaceKey = hit.space?.key ?? "";
  const slug = itemSlug(title);
  return hit.itemType === "blogPost"
    ? blogPostPath(spaceKey, itemId, slug)
    : pagePath(spaceKey, itemId, slug);
}

export function hitTarget(hit: SearchHit): HitTarget | null {
  const spaceKey = hit.space?.key;
  if (hit.type === "topic" || (hit.type === "decision" && hit.topic)) {
    const topicId = hit.topic?.id ?? hit.itemId;
    return spaceKey ? { to: topicPath(spaceKey, topicId) } : null;
  }
  const to = itemPath(hit, hit.itemId, hit.title);
  if (hit.type === "attachment") return { to, attachment: hit.id };
  if (hit.type === "comment" || hit.type === "decision" || !hit.anchor) return { to };
  return { to, hash: hit.anchor };
}

export function hitHref(hit: SearchHit): string | null {
  const target = hitTarget(hit);
  if (!target) return null;
  const query = target.attachment ? `?attachment=${encodeURIComponent(target.attachment)}` : "";
  const hash = target.hash ? `#${encodeURIComponent(target.hash)}` : "";
  return `${target.to}${query}${hash}`;
}

export function hitIcon(hit: Pick<SearchHit, "type">): LucideIcon {
  if (hit.type === "comment") return MessageSquare;
  if (hit.type === "blogPost") return Newspaper;
  if (hit.type === "attachment") return Paperclip;
  if (hit.type === "topic") return Repeat;
  if (hit.type === "decision") return Flag;
  return FileText;
}

export function typeLabel(t: TFunction, type: string): string {
  if (type === "comment") return t("search.types.comment");
  if (type === "blogPost") return t("search.types.blogPost");
  if (type === "attachment") return t("search.types.attachment");
  if (type === "topic") return t("search.types.topic");
  if (type === "decision") return t("search.types.decision");
  return t("search.types.page");
}

export function hitTitle(t: TFunction, hit: SearchHit): string {
  if (hit.type === "comment" || (hit.type === "topic" && hit.id !== hit.itemId)) {
    return t("search.commentOn", { title: hit.title });
  }
  if (hit.type === "attachment") {
    return t("search.attachmentOn", { name: hit.attachment?.name ?? hit.heading, title: hit.title });
  }
  if (hit.type === "decision") return t("search.decisionIn", { title: hit.title });
  return hit.heading && hit.heading !== hit.title ? `${hit.title} › ${hit.heading}` : hit.title;
}

export function spaceName(t: TFunction, space: NonNullable<SearchHit["space"]>): string {
  return space.name || (space.personal ? t("spaces.personal.label") : space.key);
}

export function hitPathEntries(t: TFunction, hit: SearchHit): { id: string; title: string }[] {
  if (hit.sharedWithYou || !hit.space) return [{ id: "shared", title: t("search.sharedWithYou") }];
  const entries = [{ id: hit.space.id, title: spaceName(t, hit.space) }, ...hit.path];
  if (hit.series && !entries.some((entry) => entry.id === hit.series?.id)) entries.push(hit.series);
  return entries;
}

export function hitPath(t: TFunction, hit: SearchHit): string[] {
  return hitPathEntries(t, hit).map((entry) => entry.title);
}

export function SearchResult({ hit }: { hit: SearchHit }) {
  const { t } = useTranslation();
  const format = useFormat();
  const Icon = hitIcon(hit);
  const path = hitPathEntries(t, hit);
  const title = hitTitle(t, hit);
  const target = hitTarget(hit);
  return (
    <article
      data-search-result=""
      tabIndex={-1}
      className="flex gap-3 border-b border-border py-4 outline-none"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-text-muted">
        <Icon aria-hidden="true" className="size-icon" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-text-muted">
          {path.map((part, index) => (
            <span key={part.id} className="flex min-w-0 items-center gap-1">
              {index > 0 ? <ChevronRight aria-hidden="true" className="size-icon-sm shrink-0" /> : null}
              <span className="truncate" title={part.title}>
                {part.title}
              </span>
            </span>
          ))}
        </p>
        <h3 className="text-content font-semibold">
          {target ? (
            <Link
              to={target.to}
              search={target.attachment ? { attachment: target.attachment } : {}}
              hash={target.hash}
              className="text-text hover:underline focus-visible:focus-ring"
            >
              {title}
            </Link>
          ) : (
            <span className="text-text">{title}</span>
          )}
        </h3>
        {target ? null : <p className="text-sm text-text-muted">{t("search.topicOutsideSpace")}</p>}
        {hit.excerpt.length > 0 ? (
          <p className="line-clamp-3 text-text-muted">
            <Highlighted parts={hit.excerpt} />
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-text-muted">
          {hit.status ? <StatusBadge status={hit.status} /> : null}
          {hit.archived ? <Badge>{t("search.archived")}</Badge> : null}
          <span>{typeLabel(t, hit.type)}</span>
          {hit.author ? <span>{hit.author.name}</span> : null}
          <span>{t("search.updated", { date: format.date(hit.updatedAt) })}</span>
          {hit.labels.slice(0, 3).map((label) => (
            <Badge key={label}>{label}</Badge>
          ))}
        </div>
      </div>
    </article>
  );
}
