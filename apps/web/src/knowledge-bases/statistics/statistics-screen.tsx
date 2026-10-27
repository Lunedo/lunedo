import {
  Button,
  Drawer,
  EmptyState,
  PageHeader,
  SegmentedControl,
  Skeleton,
  Table,
  type TableColumn,
  useToast,
} from "@lunedo/ui";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ChartColumn, FilePlus, MessageSquareText, SearchX, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { ActionFailure, LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { translateKey } from "../../i18n/translate.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useDocumentTitle } from "../../screens/settings/settings-page.js";
import { contentHref } from "../../spaces/item-paths.js";
import { spaceDisplayName } from "../../spaces/space-badge.js";
import { useSpace } from "../../spaces/space-context.js";
import {
  type FeedbackNote,
  feedbackQuery,
  type ReadArticle,
  type SearchTerm,
  STATISTICS_PERIODS,
  type StatisticsPeriod,
  statisticsKeys,
  statisticsQuery,
  type UnhelpfulArticle,
} from "./queries.js";
import { statisticsSearch } from "./statistics-search.js";

type Article = UnhelpfulArticle["article"];

function suggestedTitle(term: string): string {
  return term.charAt(0).toLocaleUpperCase() + term.slice(1);
}

function share(part: number, total: number): number {
  return total > 0 ? part / total : 0;
}

function Tile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-md border border-border bg-surface p-4">
      <span className="text-sm text-text-muted">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      <span className="text-sm text-text-muted">{detail}</span>
    </div>
  );
}

function Block({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        {description ? <p className="text-sm text-text-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function ArticleCell({ article, spaceKey }: { article: Article; spaceKey: string }) {
  const href = contentHref({ kind: "page", number: article.number, title: article.title }, spaceKey) ?? "";
  const path = article.categoryPath.map((category) => category.title).join(" › ");
  return (
    <span className="flex min-w-0 flex-col">
      <Link
        to={href}
        className="truncate font-medium hover:underline focus-visible:focus-ring"
        title={article.title}
      >
        {article.title}
      </Link>
      {path ? (
        <span className="truncate text-xs text-text-muted" title={path}>
          {path}
        </span>
      ) : null}
    </span>
  );
}

function Count({ children }: { children: ReactNode }) {
  return <span className="tabular-nums">{children}</span>;
}

function Note({ note, spaceId, canDelete }: { note: FeedbackNote; spaceId: string; canDelete: boolean }) {
  const { t } = useTranslation();
  const format = useFormat();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await request(() =>
        api.DELETE("/api/v1/spaces/{spaceId}/statistics/feedback/{feedbackId}", {
          params: { path: { spaceId, feedbackId: note.id } },
        }),
      );
      await queryClient.invalidateQueries({ queryKey: statisticsKeys.all(spaceId) });
      toast({ title: t("statistics.feedback.deleted"), variant: "success" });
    } catch (failure) {
      setError(problemMessage(t, failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="flex flex-col gap-2 py-3">
      <span className="text-xs text-text-muted">{format.date(`${note.day}T12:00:00Z`)}</span>
      <p className="whitespace-pre-wrap break-words">{note.text}</p>
      {error ? <ActionFailure title={t("statistics.feedback.deleteFailed")} message={error} /> : null}
      {canDelete && !confirming ? (
        <Button
          size="sm"
          variant="secondary"
          icon={Trash2}
          className="self-start"
          onClick={() => setConfirming(true)}
        >
          {t("statistics.feedback.delete")}
        </Button>
      ) : null}
      {confirming ? (
        <div className="flex flex-col gap-2 rounded-md border border-border p-3">
          <p className="text-sm">{t("statistics.feedback.confirm")}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="danger" icon={Trash2} loading={busy} onClick={() => void remove()}>
              {t("statistics.feedback.deleteConfirm")}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirming(false)}>
              {t("statistics.feedback.keep")}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function FeedbackPanel({
  spaceId,
  article,
  period,
  onClose,
}: {
  spaceId: string;
  article: Article;
  period: StatisticsPeriod;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { space } = useSpace();
  const notes = useInfiniteQuery({ ...feedbackQuery(spaceId, article.id, period), throwOnError: false });
  const items = notes.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Drawer
      open
      side="right"
      size="panel"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("statistics.feedback.title", { title: article.title })}
    >
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm text-text-muted">{t("statistics.feedback.description")}</p>
        {notes.isPending ? <Skeleton className="h-field w-full" /> : null}
        {notes.isError ? (
          <LoadError
            what={t("statistics.feedback.loadFailed")}
            error={notes.error}
            onRetry={() => notes.refetch()}
          />
        ) : null}
        {notes.data && items.length === 0 ? (
          <p className="text-sm text-text-muted">{t("statistics.feedback.none")}</p>
        ) : null}
        <ul className="flex flex-col divide-y divide-border">
          {items.map((note) => (
            <Note key={note.id} note={note} spaceId={spaceId} canDelete={space.role === "admin"} />
          ))}
        </ul>
        {notes.hasNextPage ? (
          <Button
            variant="secondary"
            className="self-start"
            loading={notes.isFetchingNextPage}
            onClick={() => void notes.fetchNextPage()}
          >
            {t("statistics.feedback.more")}
          </Button>
        ) : null}
      </div>
    </Drawer>
  );
}

export function StatisticsScreen() {
  const { t } = useTranslation();
  const format = useFormat();
  const { space, canEdit, openCreate } = useSpace();
  const name = spaceDisplayName(t, space);
  useDocumentTitle(`${t("statistics.title")} · ${name}`);
  const navigate = useNavigate();
  const search = statisticsSearch.parse(useSearch({ strict: false }));
  const period: StatisticsPeriod = search.period ?? "30d";
  const statistics = useQuery({ ...statisticsQuery(space.id, period), throwOnError: false });
  const [reading, setReading] = useState<Article | null>(null);
  const data = statistics.data;
  const percent = (value: number) => format.percent(value);

  const termColumns = (zero: boolean): TableColumn<SearchTerm>[] => [
    {
      key: "term",
      header: t("statistics.terms.term"),
      grow: true,
      cell: (row) => (
        <span className="block truncate font-mono text-sm" title={row.term}>
          {row.term}
        </span>
      ),
    },
    {
      key: "searches",
      header: t("statistics.terms.searches"),
      align: "end",
      cell: (row) => <Count>{format.number(row.searches)}</Count>,
    },
    zero
      ? {
          key: "last",
          header: t("statistics.terms.last"),
          cell: (row) => <span className="text-text-muted">{format.date(row.lastSearchedAt)}</span>,
          hideBelow: "sm",
        }
      : {
          key: "zero",
          header: t("statistics.terms.withoutResults"),
          align: "end",
          cell: (row) => <Count>{format.number(row.zeroResults)}</Count>,
          hideBelow: "sm",
        },
    ...(zero && canEdit
      ? [
          {
            key: "create",
            header: <span className="sr-only">{t("statistics.terms.actions")}</span>,
            align: "end" as const,
            cell: (row: SearchTerm) => (
              <Button
                size="sm"
                variant="secondary"
                icon={FilePlus}
                aria-label={t("statistics.terms.createFor", { term: row.term })}
                onClick={() => openCreate("page", null, suggestedTitle(row.term))}
              >
                {t("statistics.terms.create")}
              </Button>
            ),
          },
        ]
      : []),
  ];

  const unhelpfulColumns: TableColumn<UnhelpfulArticle>[] = [
    {
      key: "article",
      header: t("statistics.articles.article"),
      grow: true,
      cell: (row) => <ArticleCell article={row.article} spaceKey={space.key} />,
    },
    {
      key: "unhelpful",
      header: t("statistics.articles.unhelpful"),
      align: "end",
      cell: (row) => (
        <span className="flex flex-col items-end">
          <Count>{percent(share(row.unhelpful, row.helpful + row.unhelpful))}</Count>
          <span className="text-xs whitespace-nowrap text-text-muted tabular-nums">
            {t("statistics.articles.ofRatings", {
              count: row.helpful + row.unhelpful,
              no: format.number(row.unhelpful),
            })}
          </span>
        </span>
      ),
    },
    {
      key: "feedback",
      header: t("statistics.articles.feedback"),
      align: "end",
      cell: (row) =>
        row.feedback > 0 ? (
          <Button
            size="sm"
            variant="secondary"
            icon={MessageSquareText}
            aria-label={t("statistics.articles.readFeedbackFor", {
              count: row.feedback,
              title: row.article.title,
            })}
            onClick={() => setReading(row.article)}
          >
            {t("statistics.articles.readFeedback", { count: row.feedback })}
          </Button>
        ) : (
          <span className="text-text-muted">{t("statistics.articles.noFeedback")}</span>
        ),
    },
  ];

  const readColumns: TableColumn<ReadArticle>[] = [
    {
      key: "article",
      header: t("statistics.articles.article"),
      grow: true,
      cell: (row) => <ArticleCell article={row.article} spaceKey={space.key} />,
    },
    {
      key: "views",
      header: t("statistics.articles.views"),
      align: "end",
      cell: (row) => <Count>{format.number(row.views)}</Count>,
    },
  ];

  const openArticle = (article: Article) => {
    const href = contentHref({ kind: "page", number: article.number, title: article.title }, space.key);
    if (href) void navigate({ to: href });
  };
  const ratings = data ? data.ratings.helpful + data.ratings.unhelpful : 0;
  const empty =
    data && data.searches.total === 0 && ratings === 0 && data.views === 0 && data.unhelpful.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-page flex-col gap-6 px-4 pt-6 pb-12 md:px-8">
      <PageHeader
        title={t("statistics.title")}
        description={t("statistics.description")}
        icon={ChartColumn}
        breadcrumbs={[{ label: name, href: `/spaces/${space.key}` }, { label: t("statistics.title") }]}
      />
      <SegmentedControl
        label={t("statistics.period")}
        value={period}
        onValueChange={(value) =>
          void navigate({
            to: ".",
            search: value === "30d" ? {} : { period: value as StatisticsPeriod },
            replace: true,
          })
        }
        options={STATISTICS_PERIODS.map((value) => ({
          value,
          label: translateKey(t, `statistics.periods.${value}`),
        }))}
      />
      {statistics.isPending ? (
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : null}
      {statistics.isError ? (
        <LoadError
          what={t("statistics.loadFailed")}
          error={statistics.error}
          onRetry={() => statistics.refetch()}
        />
      ) : null}
      {data && empty ? (
        <EmptyState
          icon={ChartColumn}
          title={t("statistics.emptyTitle")}
          description={t("statistics.emptyDescription")}
          action={
            period === "12m" ? undefined : (
              <Button
                variant="secondary"
                onClick={() => void navigate({ to: ".", search: { period: "12m" } })}
              >
                {t("statistics.showYear")}
              </Button>
            )
          }
        />
      ) : null}
      {data && !empty ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Tile
              label={t("statistics.tiles.searches")}
              value={format.number(data.searches.total)}
              detail={t("statistics.tiles.views", { count: data.views })}
            />
            <Tile
              label={t("statistics.tiles.zeroResults")}
              value={percent(share(data.searches.zeroResults, data.searches.total))}
              detail={t("statistics.tiles.zeroResultsDetail", { count: data.searches.zeroResults })}
            />
            <Tile
              label={t("statistics.tiles.helpful")}
              value={ratings > 0 ? percent(share(data.ratings.helpful, ratings)) : "–"}
              detail={t("statistics.tiles.ratings", { count: ratings })}
            />
          </div>
          <Block title={t("statistics.zero.title")} description={t("statistics.zero.description")}>
            {data.zeroResultTerms.length > 0 ? (
              <Table
                caption={t("statistics.zero.title")}
                columns={termColumns(true)}
                rows={data.zeroResultTerms}
                rowKey={(row) => row.term}
                rowLabel={(row) => row.term}
              />
            ) : (
              <EmptyState
                icon={SearchX}
                title={t("statistics.zero.emptyTitle")}
                description={t("statistics.terms.threshold")}
              />
            )}
          </Block>
          <div className="grid gap-6 lg:grid-cols-2">
            <Block title={t("statistics.top.title")} description={t("statistics.terms.threshold")}>
              {data.topTerms.length > 0 ? (
                <Table
                  caption={t("statistics.top.title")}
                  columns={termColumns(false)}
                  rows={data.topTerms}
                  rowKey={(row) => row.term}
                  rowLabel={(row) => row.term}
                />
              ) : (
                <p className="text-sm text-text-muted">{t("statistics.top.empty")}</p>
              )}
            </Block>
            <Block
              title={t("statistics.unhelpful.title")}
              description={t("statistics.unhelpful.description")}
            >
              {data.unhelpful.length > 0 ? (
                <Table
                  caption={t("statistics.unhelpful.title")}
                  columns={unhelpfulColumns}
                  rows={data.unhelpful}
                  rowKey={(row) => row.article.id}
                  rowLabel={(row) => row.article.title}
                  onRowClick={(row) => openArticle(row.article)}
                />
              ) : (
                <p className="text-sm text-text-muted">{t("statistics.unhelpful.empty")}</p>
              )}
            </Block>
          </div>
          <Block title={t("statistics.read.title")}>
            {data.mostRead.length > 0 ? (
              <Table
                caption={t("statistics.read.title")}
                columns={readColumns}
                rows={data.mostRead}
                rowKey={(row) => row.article.id}
                rowLabel={(row) => row.article.title}
                onRowClick={(row) => openArticle(row.article)}
              />
            ) : (
              <p className="text-sm text-text-muted">{t("statistics.read.empty")}</p>
            )}
          </Block>
          <p className="text-sm text-text-muted">{t("statistics.privacy")}</p>
        </>
      ) : null}
      {reading ? (
        <FeedbackPanel
          spaceId={space.id}
          article={reading}
          period={period}
          onClose={() => setReading(null)}
        />
      ) : null}
    </div>
  );
}
