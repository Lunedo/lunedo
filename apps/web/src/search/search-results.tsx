import { Badge, Highlighted } from "@pagehall/ui";
import { Link } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { ChevronRight, FileText, type LucideIcon, MessageSquare, Newspaper } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFormat } from "../preferences/preferences-provider.js";
import { itemSlug } from "../spaces/item-paths.js";
import { StatusBadge } from "../spaces/ownership/page-status.js";
import { blogPostPath, pagePath } from "../spaces/space-queries.js";
import type { SearchHit } from "./search-api.js";

export function hitHref(hit: SearchHit): string {
  const spaceKey = hit.space?.key ?? "";
  const slug = itemSlug(hit.title);
  const path =
    hit.type === "blogPost" ? blogPostPath(spaceKey, hit.itemId, slug) : pagePath(spaceKey, hit.itemId, slug);
  return hit.type !== "comment" && hit.anchor ? `${path}#${encodeURIComponent(hit.anchor)}` : path;
}

export function hitIcon(hit: Pick<SearchHit, "type">): LucideIcon {
  if (hit.type === "comment") return MessageSquare;
  if (hit.type === "blogPost") return Newspaper;
  return FileText;
}

export function typeLabel(t: TFunction, type: string): string {
  if (type === "comment") return t("search.types.comment");
  if (type === "blogPost") return t("search.types.blogPost");
  return t("search.types.page");
}

export function hitTitle(t: TFunction, hit: SearchHit): string {
  if (hit.type === "comment") return t("search.commentOn", { title: hit.title });
  return hit.heading && hit.heading !== hit.title ? `${hit.title} › ${hit.heading}` : hit.title;
}

export function spaceName(t: TFunction, space: NonNullable<SearchHit["space"]>): string {
  return space.name || (space.personal ? t("spaces.personal.label") : space.key);
}

export function hitPathEntries(t: TFunction, hit: SearchHit): { id: string; title: string }[] {
  if (hit.sharedWithYou || !hit.space) return [{ id: "shared", title: t("search.sharedWithYou") }];
  return [{ id: hit.space.id, title: spaceName(t, hit.space) }, ...hit.path];
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
  return (
    <article className="flex gap-3 border-b border-border py-4">
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
          <Link to={hitHref(hit)} className="text-text hover:underline focus-visible:focus-ring">
            {title}
          </Link>
        </h3>
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
