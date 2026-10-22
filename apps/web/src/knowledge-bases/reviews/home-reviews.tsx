import { Badge, Button, Section } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CalendarCheck, Check, FilePen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadError } from "../../errors/failure.js";
import { itemHref } from "../../spaces/item-paths.js";
import { articleTypeIcon } from "../article-types.js";
import { homeReviewsQuery, reviewCountsQuery } from "./queries.js";
import { ReviewStatus, useReviewAction } from "./review-status.js";

export function DueForReview() {
  const { t } = useTranslation();
  const reviews = useQuery({ ...homeReviewsQuery(), throwOnError: false });
  const review = useReviewAction();
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const section = useRef<HTMLUListElement>(null);
  const [focusAfter, setFocusAfter] = useState<{ id: string; next: string | null } | null>(null);
  useEffect(() => {
    if (!focusAfter || review.busy) return;
    const target =
      buttons.current.get(focusAfter.id) ??
      (focusAfter.next ? buttons.current.get(focusAfter.next) : undefined) ??
      section.current;
    target?.focus();
    setFocusAfter(null);
  }, [focusAfter, review.busy]);
  if (reviews.isError) {
    return (
      <div className="md:col-span-2">
        <Section title={t("reviews.home.title")} icon={CalendarCheck}>
          <LoadError what={t("reviews.home.title")} error={reviews.error} onRetry={() => reviews.refetch()} />
        </Section>
      </div>
    );
  }
  const items = reviews.data?.items ?? [];
  if (items.length === 0) return null;
  const now = Date.now();
  return (
    <div className="md:col-span-2">
      <Section title={t("reviews.home.title")} icon={CalendarCheck}>
        <p className="px-4 py-2 text-sm text-text-muted">{t("reviews.home.description")}</p>
        <ul
          ref={section}
          tabIndex={-1}
          aria-label={t("reviews.home.title")}
          className="flex flex-col focus-visible:focus-ring"
        >
          {items.map((item, index) => {
            const Icon = articleTypeIcon(item.type);
            const href =
              itemHref({ id: item.id, kind: "page", title: item.title, link: null }, item.spaceKey) ?? "";
            return (
              <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2">
                <Icon aria-hidden="true" className="size-icon shrink-0 text-text-muted" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <Link
                    to={href}
                    className="truncate hover:underline focus-visible:focus-ring"
                    title={item.title}
                  >
                    {item.title}
                  </Link>
                  <span className="truncate text-xs text-text-muted" title={item.spaceName}>
                    {item.spaceName}
                  </span>
                  {item.sourceChangedAt ? (
                    <span className="inline-flex min-w-0 items-center gap-1 text-xs text-warning">
                      <FilePen aria-hidden="true" className="size-3 shrink-0" />
                      <span className="truncate">{t("reviews.list.sourceChangedHint")}</span>
                    </span>
                  ) : null}
                </span>
                <ReviewStatus timing={{ ...item, reviewedAt: null, publishedAt: null }} now={now} fixed />
                <Button
                  ref={(element) => {
                    if (element) buttons.current.set(item.id, element);
                    else buttons.current.delete(item.id);
                  }}
                  size="sm"
                  variant="secondary"
                  icon={Check}
                  loading={review.busy === item.id}
                  aria-label={t("reviews.list.markArticle", { title: item.title })}
                  onClick={() => {
                    const next = items[index + 1]?.id ?? items[index - 1]?.id ?? null;
                    void review.run(item.id, item.title).then(() => setFocusAfter({ id: item.id, next }));
                  }}
                >
                  {t("reviews.markReviewed")}
                </Button>
              </li>
            );
          })}
        </ul>
        {reviews.data && reviews.data.total > items.length ? (
          <p className="px-4 py-2 text-sm text-text-muted">
            {t("reviews.home.more", { count: reviews.data.total - items.length })}
          </p>
        ) : null}
      </Section>
    </div>
  );
}

export function ReviewNavLink({
  spaceId,
  spaceKey,
  active,
}: {
  spaceId: string;
  spaceKey: string;
  active: boolean;
}) {
  const { t } = useTranslation();
  const counts = useQuery({ ...reviewCountsQuery(spaceId), throwOnError: false });
  const due = counts.data?.due ?? 0;
  return (
    <Link
      to="/spaces/$spaceKey/reviews"
      params={{ spaceKey }}
      aria-current={active ? "page" : undefined}
      className={`flex h-row items-center gap-2 rounded-sm px-2 focus-visible:focus-ring ${active ? "bg-selected font-semibold text-selected-text" : "hover:bg-hover"}`}
    >
      <CalendarCheck aria-hidden="true" className="size-icon text-text-muted" />
      <span className="min-w-0 flex-1 truncate">{t("reviews.list.title")}</span>
      {due > 0 ? <Badge variant="warning">{t("reviews.list.dueBadge", { count: due })}</Badge> : null}
    </Link>
  );
}
