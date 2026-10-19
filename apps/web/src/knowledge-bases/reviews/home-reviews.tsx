import { Badge, Button, Section } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CalendarCheck, Check } from "lucide-react";
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
        <ul className="flex flex-col">
          {items.map((item) => {
            const Icon = articleTypeIcon(item.type);
            const href =
              itemHref({ id: item.id, kind: "page", title: item.title, link: null }, item.spaceKey) ?? "";
            return (
              <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1">
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
                </span>
                <ReviewStatus timing={{ ...item, reviewedAt: null, publishedAt: null }} now={now} />
                <Button
                  size="sm"
                  variant="secondary"
                  icon={Check}
                  loading={review.busy === item.id}
                  onClick={() => void review.run(item.id, item.title)}
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
