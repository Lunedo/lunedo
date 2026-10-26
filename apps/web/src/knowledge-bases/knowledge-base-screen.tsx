import { Badge, Button, EmptyState, PageHeader, Skeleton, Table, type TableColumn } from "@lunedo/ui";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { BookOpen, Folder, FolderPlus, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadError } from "../errors/failure.js";
import { translateKey } from "../i18n/translate.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { useDocumentTitle } from "../screens/settings/settings-page.js";
import { contentLanguageLabel } from "../search/content-language.js";
import { itemHref } from "../spaces/item-paths.js";
import { PageBar } from "../spaces/page-bar.js";
import { spaceDisplayName } from "../spaces/space-badge.js";
import { useSpace } from "../spaces/space-context.js";
import { ARTICLE_TYPES, articleTypeIcon, articleTypeLabel } from "./article-types.js";
import { NamedIcon } from "./icons.js";
import {
  type ArticleSummary,
  type ArticleTypeFilter,
  articlesQuery,
  type Category,
  categoriesQuery,
  languagesQuery,
} from "./queries.js";

function ArticleGroup({
  heading,
  icon,
  count,
  drafts,
  categoryId,
  type,
}: {
  heading: string;
  icon: string | null;
  count: number | null;
  drafts: number;
  categoryId: string | null;
  type: ArticleTypeFilter;
}) {
  const { t, i18n } = useTranslation();
  const format = useFormat();
  const { space } = useSpace();
  const navigate = useNavigate();
  const articles = useInfiniteQuery({ ...articlesQuery(space.id, categoryId, type), throwOnError: false });
  const languages = useQuery({ ...languagesQuery(space.id), throwOnError: false });
  const translated = (languages.data?.languages ?? []).filter(
    (language) => language !== languages.data?.defaultLanguage,
  );
  const rows = articles.data?.pages.flatMap((page) => page.items) ?? [];
  if (categoryId === null && articles.data && rows.length === 0) return null;
  const columns: TableColumn<ArticleSummary>[] = [
    {
      key: "title",
      header: t("knowledgeBase.list.title"),
      grow: true,
      cell: (article) => {
        const Icon = articleTypeIcon(article.type);
        const href = itemHref({ id: article.id, kind: "page", title: article.title, link: null }, space.key);
        return (
          <span className="flex min-w-0 items-center gap-2">
            <Icon aria-hidden="true" className="size-icon-md shrink-0 text-text-muted" />
            <span className="sr-only">{articleTypeLabel(t, article.type)}: </span>
            {href ? (
              <Link
                to={href}
                title={article.title}
                className="min-w-0 truncate text-text hover:underline focus-visible:focus-ring"
              >
                {article.title}
              </Link>
            ) : (
              <span className="truncate">{article.title}</span>
            )}
            {article.published ? null : (
              <span className="shrink-0 rounded-sm bg-warning-soft px-1 text-xs">
                {t("knowledgeBase.list.unpublished")}
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: "subcategory",
      header: t("knowledgeBase.list.subcategory"),
      hideBelow: "md",
      cell: (article) => {
        const sub = article.categoryPath
          .slice(1)
          .map((category) => category.title)
          .join(" › ");
        return sub ? (
          <span className="block max-w-56 truncate" title={sub}>
            {sub}
          </span>
        ) : (
          <span className="text-text-muted">{t("knowledgeBase.list.noSubcategory")}</span>
        );
      },
    },
    {
      key: "owner",
      header: t("knowledgeBase.list.owner"),
      hideBelow: "sm",
      cell: (article) =>
        article.ownerName ? (
          <span className="block max-w-48 truncate" title={article.ownerName}>
            {article.ownerName}
          </span>
        ) : (
          <span className="text-text-muted">{t("knowledgeBase.list.noOwner")}</span>
        ),
    },
    ...(translated.length > 0
      ? [
          {
            key: "languages",
            header: t("knowledgeBase.list.languages"),
            hideBelow: "md" as const,
            cell: (article: ArticleSummary) => (
              <span className="flex flex-wrap gap-1">
                {translated.map((language) => {
                  const state =
                    article.translations.find((entry) => entry.language === language)?.state ?? "missing";
                  const text = t("knowledgeBase.translations.badge", {
                    language: language.toUpperCase(),
                    state: translateKey(t, `knowledgeBase.translations.states.${state}`),
                  });
                  return (
                    <Badge key={language} variant={state === "current" ? "neutral" : "warning"}>
                      <span
                        title={`${contentLanguageLabel(t, language, i18n.language)}: ${translateKey(t, `knowledgeBase.translations.states.${state}`)}`}
                      >
                        {text}
                      </span>
                    </Badge>
                  );
                })}
              </span>
            ),
          },
        ]
      : []),
    {
      key: "updated",
      header: t("knowledgeBase.list.updated"),
      cell: (article) => <span className="whitespace-nowrap">{format.short(article.contentUpdatedAt)}</span>,
    },
  ];
  return (
    <section aria-label={heading} className="flex flex-col gap-2">
      <h2 className="flex min-w-0 items-baseline gap-2 font-semibold">
        {icon ? (
          <NamedIcon name={icon} className="size-icon-md shrink-0 text-text-muted" />
        ) : (
          <Folder aria-hidden="true" className="size-icon-md shrink-0 text-text-muted" />
        )}
        <span className="truncate" title={heading}>
          {heading}
        </span>
        {count !== null ? (
          <span className="text-sm font-normal text-text-muted">
            {t("knowledgeBase.list.articleCount", { count, formatted: format.number(count) })}
            {drafts > 0
              ? ` · ${t("knowledgeBase.list.draftCount", { count: drafts, formatted: format.number(drafts) })}`
              : null}
          </span>
        ) : null}
      </h2>
      {articles.isError ? (
        <LoadError
          what={t("knowledgeBase.list.loadFailed")}
          error={articles.error}
          onRetry={() => articles.refetch()}
        />
      ) : (
        <Table
          caption={t("knowledgeBase.list.caption", { category: heading })}
          columns={columns}
          rows={rows}
          rowKey={(article) => article.id}
          loading={articles.isPending}
          empty={
            <p className="px-4 py-3 text-sm text-text-muted">
              {type === "all" ? t("knowledgeBase.list.emptyCategory") : t("knowledgeBase.list.emptyFiltered")}
            </p>
          }
          onRowClick={(article) => {
            const href = itemHref(
              { id: article.id, kind: "page", title: article.title, link: null },
              space.key,
            );
            if (href) void navigate({ to: href });
          }}
        />
      )}
      {articles.hasNextPage ? (
        <div>
          <Button
            variant="secondary"
            size="sm"
            loading={articles.isFetchingNextPage}
            onClick={() => void articles.fetchNextPage()}
          >
            {t("knowledgeBase.list.more", { category: heading })}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

export function KnowledgeBaseScreen() {
  const { t } = useTranslation();
  const { space, canEdit, openCreate } = useSpace();
  const name = spaceDisplayName(t, space);
  useDocumentTitle(name);
  const [type, setType] = useState<ArticleTypeFilter>("all");
  const categories = useQuery({ ...categoriesQuery(space.id), throwOnError: false });
  const topLevel = (categories.data ?? []).filter((category: Category) => category.level === 1);
  const total = topLevel.reduce((sum, category) => sum + category.articles, 0);
  const filters: { value: ArticleTypeFilter; label: string }[] = [
    { value: "all", label: t("knowledgeBase.list.allTypes") },
    ...ARTICLE_TYPES.map((value) => ({ value, label: translateKey(t, `knowledgeBase.list.types.${value}`) })),
  ];
  return (
    <>
      <PageBar breadcrumbs={[{ label: name }]}>
        {canEdit ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              icon={FolderPlus}
              onClick={() => openCreate("folder", null)}
            >
              {t("knowledgeBase.newCategory")}
            </Button>
            <Button size="sm" variant="primary" icon={Plus} onClick={() => openCreate("page", null)}>
              {t("knowledgeBase.newArticle")}
            </Button>
          </>
        ) : null}
      </PageBar>
      <div className="mx-auto flex w-full max-w-page flex-col gap-6 px-4 pt-4 pb-12 md:px-8">
        <PageHeader
          title={t("knowledgeBase.articles")}
          description={[
            space.description || t("knowledgeBase.list.description"),
            categories.data && topLevel.length > 0
              ? `${t("knowledgeBase.list.total", { count: total })}.`
              : null,
          ]
            .filter(Boolean)
            .join(" ")}
        />
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">{t("knowledgeBase.list.typeFilter")}</legend>
          {filters.map((filter) => (
            <button
              key={filter.value}
              type="button"
              aria-pressed={type === filter.value}
              onClick={() => setType(filter.value)}
              className="h-control-sm rounded-sm bg-surface-sunken px-2 text-sm text-text-muted hover:bg-hover hover:text-text focus-visible:focus-ring aria-pressed:bg-accent-soft aria-pressed:font-medium aria-pressed:text-accent"
            >
              {filter.label}
            </button>
          ))}
        </fieldset>
        {categories.isPending ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-field w-full" />
            <Skeleton className="h-field w-full" />
          </div>
        ) : null}
        {categories.isError ? (
          <LoadError
            what={t("knowledgeBase.list.categoriesFailed")}
            error={categories.error}
            onRetry={() => categories.refetch()}
          />
        ) : null}
        {categories.data && topLevel.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title={t("knowledgeBase.list.noCategoriesTitle")}
            description={
              canEdit
                ? t("knowledgeBase.list.noCategoriesEditor")
                : t("knowledgeBase.list.noCategoriesReader")
            }
            action={
              canEdit ? (
                <Button variant="primary" icon={FolderPlus} onClick={() => openCreate("folder", null)}>
                  {t("knowledgeBase.newCategory")}
                </Button>
              ) : undefined
            }
          />
        ) : null}
        {topLevel.map((category) => (
          <ArticleGroup
            key={`${category.id}-${type}`}
            heading={category.title}
            icon={category.icon}
            count={type === "all" ? category.articles : null}
            drafts={type === "all" && canEdit ? category.drafts : 0}
            categoryId={category.id}
            type={type}
          />
        ))}
        {categories.data ? (
          <ArticleGroup
            key={`top-${type}`}
            heading={t("knowledgeBase.list.withoutCategory")}
            icon={null}
            count={null}
            drafts={0}
            categoryId={null}
            type={type}
          />
        ) : null}
      </div>
    </>
  );
}
