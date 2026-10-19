import {
  Avatar,
  Button,
  Checkbox,
  EmptyState,
  PageHeader,
  SegmentedControl,
  Skeleton,
  Table,
  type TableColumn,
} from "@pagehall/ui";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CalendarCheck, Check, FilePen, SquarePen, UserRoundX } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadError } from "../../errors/failure.js";
import { translateKey } from "../../i18n/translate.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useDocumentTitle } from "../../screens/settings/settings-page.js";
import { itemHref } from "../../spaces/item-paths.js";
import { TransferOwnerDialog } from "../../spaces/ownership/owner-line.js";
import { spaceDisplayName } from "../../spaces/space-badge.js";
import { useSpace } from "../../spaces/space-context.js";
import { articleTypeIcon } from "../article-types.js";
import { type ReviewFilter, type ReviewItem, reviewListQuery } from "./queries.js";
import { ReviewStatus, useReviewAction } from "./review-status.js";

const FILTERS: ReviewFilter[] = ["all", "due", "soon", "unowned"];

function TitleCell({ row, spaceKey }: { row: ReviewItem; spaceKey: string }) {
  const { t } = useTranslation();
  const Icon = articleTypeIcon(row.type);
  const href = itemHref({ id: row.id, kind: "page", title: row.title, link: null }, spaceKey) ?? "";
  const path = row.categoryPath.map((category) => category.title).join(" › ");
  return (
    <span className="flex min-w-0 items-start gap-2">
      <Icon aria-hidden="true" className="mt-0.5 size-icon shrink-0 text-text-muted" />
      <span className="flex min-w-0 flex-col">
        <Link
          to={href}
          className="truncate font-medium hover:underline focus-visible:focus-ring"
          title={row.title}
        >
          {row.title}
        </Link>
        {row.state === "sourceChanged" ? (
          <span className="inline-flex min-w-0 items-center gap-1 text-xs text-text-muted">
            <FilePen aria-hidden="true" className="size-3 shrink-0" />
            <span className="truncate">{t("reviews.list.sourceChangedHint")}</span>
          </span>
        ) : path ? (
          <span className="truncate text-xs text-text-muted" title={path}>
            {path}
          </span>
        ) : null}
      </span>
    </span>
  );
}

function OwnerCell({ row, onAssign }: { row: ReviewItem; onAssign: (row: ReviewItem) => void }) {
  const { t } = useTranslation();
  const { space } = useSpace();
  if (row.owner) {
    const name = row.owner.name ?? t("ownership.someone");
    return (
      <span className="flex min-w-0 items-center gap-2">
        <Avatar name={name} size="sm" decorative />
        <span className="truncate" title={name}>
          {name}
        </span>
      </span>
    );
  }
  const former = row.formerOwner?.name;
  return (
    <span className="flex min-w-0 flex-col items-start gap-1">
      <span className="inline-flex items-center gap-2 text-text-muted">
        <UserRoundX aria-hidden="true" className="size-icon shrink-0" />
        <span className="truncate" title={former ? t("reviews.list.ownerLeft", { name: former }) : undefined}>
          {former ? t("reviews.list.ownerLeft", { name: former }) : t("reviews.list.noOwner")}
        </span>
      </span>
      {space.role === "admin" ? (
        <Button size="sm" variant="secondary" onClick={() => onAssign(row)}>
          {t("reviews.list.assignOwner")}
        </Button>
      ) : null}
    </span>
  );
}

export function ReviewScreen() {
  const { t } = useTranslation();
  const format = useFormat();
  const { space } = useSpace();
  const name = spaceDisplayName(t, space);
  useDocumentTitle(`${t("reviews.list.title")} · ${name}`);
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [mine, setMine] = useState(false);
  const [assigning, setAssigning] = useState<ReviewItem | null>(null);
  const review = useReviewAction();
  const list = useInfiniteQuery({ ...reviewListQuery(space.id, filter, mine), throwOnError: false });
  const rows = list.data?.pages.flatMap((page) => page.items) ?? [];
  const counts = list.data?.pages[0]?.counts;
  const now = Date.now();

  const columns: TableColumn<ReviewItem>[] = [
    {
      key: "title",
      header: t("reviews.list.article"),
      cell: (row) => <TitleCell row={row} spaceKey={space.key} />,
    },
    {
      key: "owner",
      header: t("reviews.list.owner"),
      cell: (row) => <OwnerCell row={row} onAssign={setAssigning} />,
      hideBelow: "md",
    },
    {
      key: "interval",
      header: t("reviews.list.interval"),
      cell: (row) =>
        row.intervalMonths ? (
          <span className="text-text-muted">
            {t("reviews.interval.months", { count: row.intervalMonths })}
          </span>
        ) : (
          <span className="text-text-muted">{t("reviews.interval.off")}</span>
        ),
      hideBelow: "md",
    },
    {
      key: "reviewed",
      header: t("reviews.list.lastReviewed"),
      cell: (row) => (
        <span className="text-text-muted tabular-nums">
          {row.reviewedAt
            ? format.date(row.reviewedAt)
            : row.publishedAt
              ? t("reviews.list.publishedOn", { date: format.date(row.publishedAt) })
              : t("reviews.list.never")}
        </span>
      ),
      hideBelow: "sm",
    },
    { key: "state", header: t("reviews.list.state"), cell: (row) => <ReviewStatus timing={row} now={now} /> },
    {
      key: "actions",
      header: <span className="sr-only">{t("reviews.list.actions")}</span>,
      align: "end",
      cell: (row) => {
        const href = itemHref({ id: row.id, kind: "page", title: row.title, link: null }, space.key) ?? "";
        return (
          <span className="flex flex-wrap justify-end gap-2">
            {row.publishedAt ? (
              <Button
                size="sm"
                variant="secondary"
                icon={Check}
                loading={review.busy === row.id}
                onClick={() => void review.run(row.id, row.title)}
              >
                {t("reviews.markReviewed")}
              </Button>
            ) : null}
            <Link
              to={href}
              search={{ edit: true }}
              className="inline-flex h-control-sm items-center gap-1 rounded-md px-2 text-sm font-medium hover:bg-hover focus-visible:focus-ring"
              aria-label={t("reviews.list.editArticle", { title: row.title })}
            >
              <SquarePen aria-hidden="true" className="size-icon" />
              {t("reviews.list.edit")}
            </Link>
          </span>
        );
      },
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-page flex-col gap-6 px-4 pt-6 pb-12 md:px-8">
      <PageHeader
        title={t("reviews.list.title")}
        description={t("reviews.list.description")}
        icon={CalendarCheck}
        breadcrumbs={[{ label: name, href: `/spaces/${space.key}` }, { label: t("reviews.list.title") }]}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          label={t("reviews.list.filter")}
          value={filter}
          onValueChange={(value) => setFilter(value as ReviewFilter)}
          options={FILTERS.map((value) => ({
            value,
            label: counts
              ? t("reviews.list.filterCount", {
                  label: translateKey(t, `reviews.list.filters.${value}`),
                  count: counts[value],
                })
              : translateKey(t, `reviews.list.filters.${value}`),
          }))}
        />
        <Checkbox checked={mine} onCheckedChange={setMine} label={t("reviews.list.mine")} />
      </div>
      {list.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-field w-full" />
          <Skeleton className="h-field w-full" />
        </div>
      ) : null}
      {list.isError ? (
        <LoadError what={t("reviews.list.loadFailed")} error={list.error} onRetry={() => list.refetch()} />
      ) : null}
      {list.data && rows.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title={t("reviews.list.emptyTitle")}
          description={t("reviews.list.emptyDescription")}
        />
      ) : null}
      {rows.length > 0 ? (
        <Table caption={t("reviews.list.title")} columns={columns} rows={rows} rowKey={(row) => row.id} />
      ) : null}
      {list.hasNextPage ? (
        <Button
          variant="secondary"
          loading={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
          className="self-start"
        >
          {t("reviews.list.more")}
        </Button>
      ) : null}
      <p className="text-sm text-text-muted">{t("reviews.list.hint")}</p>
      {assigning ? (
        <TransferOwnerDialog
          item={{ id: assigning.id, spaceId: space.id, title: assigning.title }}
          currentOwner={null}
          onClose={() => setAssigning(null)}
          onDone={() => {
            setAssigning(null);
            void list.refetch();
          }}
        />
      ) : null}
    </div>
  );
}
