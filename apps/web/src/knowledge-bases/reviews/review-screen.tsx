import {
  Button,
  buttonClassName,
  Checkbox,
  EmptyState,
  PageHeader,
  SegmentedControl,
  Skeleton,
} from "@lunedo/ui";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { CalendarCheck, Check, FilePen, Languages, SquarePen, UserRoundX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PersonAvatar } from "../../components/person-avatar.js";
import { LoadError } from "../../errors/failure.js";
import { translateKey } from "../../i18n/translate.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useDocumentTitle } from "../../screens/settings/settings-page.js";
import { contentLanguageLabel } from "../../search/content-language.js";
import { contentHref } from "../../spaces/item-paths.js";
import { TransferOwnerDialog } from "../../spaces/ownership/owner-line.js";
import { spaceDisplayName } from "../../spaces/space-badge.js";
import { useSpace } from "../../spaces/space-context.js";
import { articleTypeIcon } from "../article-types.js";
import { type ReviewFilter, type ReviewItem, reviewListQuery, reviewSettingsQuery } from "./queries.js";
import { reviewSearch } from "./review-search.js";
import { ReviewStatus, useReviewAction } from "./review-status.js";

const FILTERS: ReviewFilter[] = ["all", "due", "soon", "unowned", "translations"];

function Hints({ row }: { row: ReviewItem }) {
  const { t, i18n } = useTranslation();
  const path = row.categoryPath.map((category) => category.title).join(" › ");
  return (
    <>
      {path ? (
        <span className="truncate text-xs text-text-muted" title={path}>
          {path}
        </span>
      ) : null}
      {row.translationOutdated ? (
        <span className="inline-flex min-w-0 items-center gap-1 text-xs text-warning">
          <Languages aria-hidden="true" className="size-3 shrink-0" />
          <span className="truncate">
            {t("reviews.list.translationOutdatedHint", {
              language: contentLanguageLabel(t, row.language, i18n.language),
            })}
          </span>
        </span>
      ) : null}
      {row.sourceChangedAt ? (
        <span className="inline-flex min-w-0 items-center gap-1 text-xs text-warning">
          <FilePen aria-hidden="true" className="size-3 shrink-0" />
          <span className="truncate">{t("reviews.list.sourceChangedHint")}</span>
        </span>
      ) : null}
    </>
  );
}

function Owner({ row }: { row: ReviewItem }) {
  const { t } = useTranslation();
  if (row.owner) {
    const name = row.owner.name ?? t("ownership.someone");
    return (
      <span className="inline-flex min-w-0 items-center gap-1">
        <PersonAvatar id={row.owner.id} name={name} pictureRef={row.owner.pictureRef} size="sm" decorative />
        <span className="truncate" title={name}>
          {name}
        </span>
      </span>
    );
  }
  const text = row.formerOwner?.name
    ? t("reviews.list.ownerLeft", { name: row.formerOwner.name })
    : t("reviews.list.noOwner");
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <UserRoundX aria-hidden="true" className="size-icon-md shrink-0" />
      <span className="truncate" title={text}>
        {text}
      </span>
    </span>
  );
}

function ReviewRow({
  row,
  now,
  busy,
  onReview,
  onAssign,
  focusRef,
}: {
  row: ReviewItem;
  now: number;
  busy: boolean;
  onReview: (row: ReviewItem) => void;
  onAssign: (row: ReviewItem) => void;
  focusRef: (element: HTMLElement | null) => void;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const { space } = useSpace();
  const Icon = articleTypeIcon(row.type);
  const href = contentHref({ kind: "page", number: row.number, title: row.title }, space.key) ?? "";
  const reviewed = row.reviewedAt
    ? t("reviews.list.lastReviewedOn", { date: format.date(row.reviewedAt) })
    : row.publishedAt
      ? t("reviews.list.publishedOn", { date: format.date(row.publishedAt) })
      : t("reviews.list.neverReviewed");
  const interval = row.intervalMonths
    ? t("reviews.interval.months", { count: row.intervalMonths })
    : t("reviews.interval.off");
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="flex min-w-0 flex-1 basis-field items-start gap-2">
        <Icon aria-hidden="true" className="mt-0.5 size-icon-md shrink-0 text-text-muted" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Link
            to={href}
            className="truncate font-medium hover:underline focus-visible:focus-ring"
            title={row.title}
          >
            {row.title}
          </Link>
          <Hints row={row} />
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-muted">
            <Owner row={row} />
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{reviewed}</span>
            <span aria-hidden="true">·</span>
            <span>{interval}</span>
          </span>
        </div>
      </div>
      <ReviewStatus timing={row} now={now} fixed />
      <div className="flex flex-wrap items-center gap-2">
        {!row.owner && space.role === "admin" ? (
          <Button size="sm" variant="secondary" onClick={() => onAssign(row)}>
            {t("reviews.list.assignOwner")}
          </Button>
        ) : null}
        {row.publishedAt ? (
          <Button
            ref={focusRef}
            size="sm"
            variant="secondary"
            icon={Check}
            loading={busy}
            aria-label={t("reviews.list.markArticle", { title: row.title })}
            onClick={() => onReview(row)}
          >
            {t("reviews.markReviewed")}
          </Button>
        ) : null}
        <Link
          ref={row.publishedAt ? undefined : focusRef}
          to={href}
          search={{ edit: true }}
          className={buttonClassName({ variant: "outline", size: "sm" })}
          aria-label={t("reviews.list.editArticle", { title: row.title })}
        >
          <SquarePen aria-hidden="true" className="size-icon-md" />
          {t("reviews.list.edit")}
        </Link>
      </div>
    </li>
  );
}

export function ReviewScreen() {
  const { t } = useTranslation();
  const { space } = useSpace();
  const name = spaceDisplayName(t, space);
  useDocumentTitle(`${t("reviews.list.title")} · ${name}`);
  const navigate = useNavigate();
  const search = reviewSearch.parse(useSearch({ strict: false }));
  const filter = search.filter ?? "all";
  const mine = search.mine === true;
  const setSearch = (next: { filter?: ReviewFilter; mine?: boolean }) => {
    const merged = { filter, mine, ...next };
    void navigate({
      to: ".",
      search: {
        ...(merged.filter === "all" ? {} : { filter: merged.filter }),
        ...(merged.mine ? { mine: true } : {}),
      },
      replace: true,
    });
  };
  const settings = useQuery({ ...reviewSettingsQuery(space.id), throwOnError: false });
  const [assigning, setAssigning] = useState<ReviewItem | null>(null);
  const review = useReviewAction();
  const list = useInfiniteQuery({ ...reviewListQuery(space.id, filter, mine), throwOnError: false });
  const rows = list.data?.pages.flatMap((page) => page.items) ?? [];
  const counts = list.data?.pages[0]?.counts;
  const now = Date.now();

  const rowElements = useRef(new Map<string, HTMLElement>());
  const listElement = useRef<HTMLUListElement>(null);
  const [focusAfter, setFocusAfter] = useState<{ id: string; next: string | null } | null>(null);
  useEffect(() => {
    if (!focusAfter || review.busy) return;
    const target =
      rowElements.current.get(focusAfter.id) ??
      (focusAfter.next ? rowElements.current.get(focusAfter.next) : undefined) ??
      listElement.current;
    target?.focus();
    setFocusAfter(null);
  }, [focusAfter, review.busy]);
  const onReview = (row: ReviewItem) => {
    const index = rows.findIndex((entry) => entry.id === row.id);
    const next = rows[index + 1]?.id ?? rows[index - 1]?.id ?? null;
    void review.run(row.id, row.title).then(() => setFocusAfter({ id: row.id, next }));
  };

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
          onValueChange={(value) => setSearch({ filter: value as ReviewFilter })}
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
        <Checkbox
          checked={mine}
          onCheckedChange={(checked) => setSearch({ mine: checked })}
          label={t("reviews.list.mine")}
        />
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
        filter !== "all" || mine ? (
          <EmptyState
            icon={CalendarCheck}
            title={t("reviews.list.filteredTitle")}
            description={t("reviews.list.filteredDescription")}
            action={
              <Button variant="secondary" onClick={() => setSearch({ filter: "all", mine: false })}>
                {t("reviews.list.showAll")}
              </Button>
            }
          />
        ) : settings.data && settings.data.intervalMonths === null ? (
          <EmptyState
            icon={CalendarCheck}
            title={t("reviews.list.offTitle")}
            description={t("reviews.list.offDescription")}
            action={
              space.role === "admin" ? (
                <Link
                  to="/spaces/$spaceKey/settings/reviews"
                  params={{ spaceKey: space.key }}
                  className={buttonClassName({ variant: "primary" })}
                >
                  {t("reviews.list.openSettings")}
                </Link>
              ) : undefined
            }
          />
        ) : (
          <EmptyState
            icon={CalendarCheck}
            title={t("reviews.list.emptyTitle")}
            description={t("reviews.list.emptyDescription")}
          />
        )
      ) : null}
      {rows.length > 0 ? (
        <ul
          ref={listElement}
          tabIndex={-1}
          aria-label={t("reviews.list.title")}
          className="flex flex-col divide-y divide-border rounded-md border border-border bg-surface focus-visible:focus-ring"
        >
          {rows.map((row) => (
            <ReviewRow
              key={row.id}
              row={row}
              now={now}
              busy={review.busy === row.id}
              onReview={onReview}
              onAssign={setAssigning}
              focusRef={(element) => {
                if (element) rowElements.current.set(row.id, element);
                else rowElements.current.delete(row.id);
              }}
            />
          ))}
        </ul>
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
