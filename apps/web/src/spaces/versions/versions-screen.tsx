import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  Notice,
  PageHeader,
  SegmentedControl,
  Select,
  Skeleton,
  useToast,
} from "@pagehall/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { History, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { PageReadView } from "../../editor/read-view.js";
import { LoadError } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { translateKey } from "../../i18n/translate.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { useDocumentTitle } from "../../screens/settings/settings-page.js";
import { useContentRefresh } from "../content-actions.js";
import {
  compareQuery,
  type DiscardedDraft,
  type Draft,
  discardedDraftsQuery,
  draftQuery,
  type PageVersion,
  type VersionSide,
  versionQuery,
  versionsQuery,
} from "../content-queries.js";
import { itemSlug } from "../item-paths.js";
import { ItemActivity } from "../ownership/item-activity.js";
import { spaceDisplayName } from "../space-badge.js";
import { useSpace } from "../space-context.js";
import { type ItemDetails, itemQuery, pagePath } from "../space-queries.js";
import { type DiffLayout, DiffView } from "./diff-view.js";

const route = getRouteApi("/app/spaces/$spaceKey/pages/$itemId/history");

type View = DiffLayout;

function sideOf(value: string | undefined): VersionSide | undefined {
  if (value === "draft") return "draft";
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

export function VersionsScreen() {
  const { t } = useTranslation();
  const { itemId } = route.useParams();
  const item = useQuery(itemQuery(itemId));
  useDocumentTitle(item.data ? t("versions.historyOf", { title: item.data.title }) : "");
  if (item.isPending) return <Skeleton className="m-6 h-field" />;
  if (item.isError) {
    return (
      <div className="p-6">
        <LoadError what={t("page.loadFailed")} error={item.error} onRetry={() => item.refetch()} />
      </div>
    );
  }
  return <VersionHistory key={item.data.id} page={item.data} />;
}

function VersionHistory({ page }: { page: ItemDetails }) {
  const { t } = useTranslation();
  const { space, canEdit } = useSpace();
  const search = route.useSearch();
  const navigate = useNavigate();
  const writable = canEdit && !page.archived && !space.archived;
  const versions = useQuery(versionsQuery(page.id));
  const draft = useQuery({ ...draftQuery(page.id), enabled: writable && page.mode === "publish" });
  const discarded = useQuery({
    ...discardedDraftsQuery(page.id),
    enabled: writable && page.mode === "publish",
  });
  const [restoring, setRestoring] = useState<number | null>(null);

  const list = versions.data ?? [];
  const showDraft = writable && page.mode === "publish" && draft.data !== undefined;
  const latest = list[0]?.number ?? null;
  const defaultTo: VersionSide | null = showDraft && draft.data?.hasChanges ? "draft" : latest;
  const to = sideOf(search.to) ?? defaultTo;
  const previousOf = (side: VersionSide | null): VersionSide | null => {
    if (side === null) return null;
    if (side === "draft") return draft.data?.basedOn ?? null;
    const index = list.findIndex((version) => version.number === side);
    return list[index + 1]?.number ?? null;
  };
  const from = sideOf(search.from) ?? previousOf(to);
  const view: View = search.view === "sideBySide" ? "sideBySide" : "inline";

  const select = (next: { from?: VersionSide | null; to?: VersionSide | null; view?: View }) =>
    void navigate({
      to: "/spaces/$spaceKey/pages/$itemId/history",
      params: { spaceKey: space.key, itemId: page.id },
      search: {
        ...(next.from !== undefined
          ? next.from === null
            ? {}
            : { from: String(next.from) }
          : search.from
            ? { from: search.from }
            : {}),
        ...(next.to !== undefined
          ? next.to === null
            ? {}
            : { to: String(next.to) }
          : search.to
            ? { to: search.to }
            : {}),
        ...((next.view ?? view) === "sideBySide" ? { view: "sideBySide" } : {}),
      },
      replace: true,
    });

  const options = [
    ...(showDraft ? [{ value: "draft", label: t("versions.draft") }] : []),
    ...list.map((version) => ({
      value: String(version.number),
      label: t("versions.versionNumber", { number: version.number }),
    })),
  ];
  const pageHref = pagePath(space.key, page.id, itemSlug(page.title));

  return (
    <div className="mx-auto flex w-full max-w-page flex-col gap-4 px-4 pt-6 pb-12 md:px-8">
      <PageHeader
        title={t("versions.historyTitle")}
        description={page.title}
        icon={History}
        breadcrumbs={[
          { label: spaceDisplayName(t, space), href: `/spaces/${space.key}` },
          { label: page.title, href: pageHref },
          { label: t("versions.historyTitle") },
        ]}
        actions={
          writable && typeof to === "number" ? (
            <Button variant="secondary" icon={RotateCcw} onClick={() => setRestoring(to)}>
              {t("versions.restoreVersion", { number: to })}
            </Button>
          ) : undefined
        }
      />
      {versions.isError ? (
        <LoadError
          what={t("versions.loadFailed")}
          error={versions.error}
          onRetry={() => versions.refetch()}
        />
      ) : versions.isPending ? (
        <Skeleton className="h-field w-full" />
      ) : list.length === 0 && !showDraft ? (
        <EmptyState
          icon={History}
          title={t("versions.emptyTitle")}
          description={page.mode === "live" ? t("versions.emptyLive") : t("versions.emptyPublish")}
        />
      ) : (
        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_var(--spacing-sidebar)]">
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <Field label={t("versions.compare")}>
                <Select
                  value={from === null ? undefined : String(from)}
                  placeholder={t("versions.noEarlierVersion")}
                  onValueChange={(value) => select({ from: sideOf(value) ?? null })}
                  options={options}
                />
              </Field>
              <Field label={t("versions.with")}>
                <Select
                  value={to === null ? undefined : String(to)}
                  onValueChange={(value) => select({ to: sideOf(value) ?? null })}
                  options={options}
                />
              </Field>
              <SegmentedControl
                label={t("versions.view")}
                value={view}
                onValueChange={(value) => select({ view: value as View })}
                options={[
                  { value: "inline", label: t("versions.inline") },
                  { value: "sideBySide", label: t("versions.sideBySide") },
                ]}
              />
            </div>
            {from !== null && to !== null ? (
              <Comparison pageId={page.id} from={from} to={to} view={view} />
            ) : typeof to === "number" ? (
              <FirstVersion pageId={page.id} number={to} />
            ) : null}
          </div>
          <VersionList
            versions={list}
            draft={showDraft ? draft.data : undefined}
            selected={to}
            onSelect={(side) => select({ to: side, from: previousOf(side) })}
            discarded={writable ? (discarded.data ?? []) : []}
            page={page}
          />
        </div>
      )}
      <ItemActivity itemId={page.id} />
      {restoring !== null ? (
        <RestoreDialog
          page={page}
          number={restoring}
          draft={draft.data}
          onOpenChange={(open) => !open && setRestoring(null)}
        />
      ) : null}
    </div>
  );
}

function Comparison({
  pageId,
  from,
  to,
  view,
}: {
  pageId: string;
  from: VersionSide;
  to: VersionSide;
  view: View;
}) {
  const { t } = useTranslation();
  const comparison = useQuery(compareQuery(pageId, from, to));
  if (comparison.isPending) return <Skeleton className="h-field w-full" />;
  if (comparison.isError) {
    return (
      <LoadError
        what={t("versions.compareFailed")}
        error={comparison.error}
        onRetry={() => comparison.refetch()}
      />
    );
  }
  return (
    <DiffView
      comparison={comparison.data}
      layout={view}
      beforeLabel={sideLabel(t, from)}
      afterLabel={sideLabel(t, to)}
    />
  );
}

function FirstVersion({ pageId, number }: { pageId: string; number: number }) {
  const { t } = useTranslation();
  const version = useQuery(versionQuery(pageId, number));
  if (version.isPending) return <Skeleton className="h-field w-full" />;
  if (version.isError) {
    return (
      <LoadError what={t("versions.compareFailed")} error={version.error} onRetry={() => version.refetch()} />
    );
  }
  return (
    <section aria-label={t("versions.firstVersionTitle")} className="flex flex-col gap-3">
      <Notice variant="info" title={t("versions.firstVersionTitle")}>
        {t("versions.firstVersionDescription")}
      </Notice>
      <PageReadView pageId={pageId} document={version.data.document} references={version.data.references} />
    </section>
  );
}

function sideLabel(t: TFunction, side: VersionSide): string {
  return side === "draft" ? t("versions.draft") : t("versions.versionNumber", { number: side });
}

function VersionList({
  versions,
  draft,
  selected,
  onSelect,
  discarded,
  page,
}: {
  versions: PageVersion[];
  draft: Draft | undefined;
  selected: VersionSide | null;
  onSelect: (side: VersionSide) => void;
  discarded: DiscardedDraft[];
  page: ItemDetails;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const names = (people: { name: string | null }[]) =>
    people.map((person) => person.name ?? t("versions.formerPerson")).join(", ");
  const reason = (version: PageVersion) =>
    version.reason === "restored"
      ? t("versions.reasons.restored", { number: version.restoredFrom ?? 0 })
      : translateKey(t, `versions.reasons.${version.reason}`);
  return (
    <aside
      aria-label={t("versions.list")}
      className="flex flex-col gap-1 lg:border-l lg:border-border lg:pl-4"
    >
      <ul className="flex flex-col gap-1">
        {draft ? (
          <li>
            <VersionButton
              selected={selected === "draft"}
              onClick={() => onSelect("draft")}
              title={t("versions.draft")}
              detail={[names(draft.contributors), t("versions.now")].filter(Boolean).join(" · ")}
              status={
                draft.basedOn === null
                  ? t("versions.notPublishedYet")
                  : t("versions.draftChanges", { count: draft.changes ?? 0 })
              }
            />
          </li>
        ) : null}
        {versions.map((version) => (
          <li key={version.number}>
            <VersionButton
              selected={selected === version.number}
              onClick={() => onSelect(version.number)}
              title={t("versions.versionNumber", { number: version.number })}
              detail={[
                names(
                  version.contributors.length > 0
                    ? version.contributors
                    : version.createdBy
                      ? [version.createdBy]
                      : [],
                ),
                format.dateTime(version.createdAt),
              ]
                .filter(Boolean)
                .join(" · ")}
              status={version.note ? `${reason(version)} · ${version.note}` : reason(version)}
            />
          </li>
        ))}
      </ul>
      <p className="px-2 py-2 text-sm text-text-muted">{t("versions.historyHint")}</p>
      {discarded.length > 0 ? <DiscardedList drafts={discarded} page={page} /> : null}
    </aside>
  );
}

function VersionButton({
  selected,
  onClick,
  title,
  detail,
  status,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  detail: string;
  status: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`flex w-full flex-col gap-1 rounded-md border px-3 py-2 text-start focus-visible:focus-ring ${selected ? "border-accent bg-accent-soft" : "border-transparent hover:bg-hover"}`}
    >
      <span className="font-semibold">{title}</span>
      <span className="text-sm text-text-muted">{detail}</span>
      <span className="text-sm text-text-muted">{status}</span>
    </button>
  );
}

function DiscardedList({ drafts, page }: { drafts: DiscardedDraft[]; page: ItemDetails }) {
  const { t } = useTranslation();
  const format = useFormat();
  const { toast } = useToast();
  const refresh = useContentRefresh();
  const restore = async (draft: DiscardedDraft) => {
    try {
      await request(() =>
        api.POST("/api/v1/pages/{pageId}/discarded-drafts/{draftId}/restore", {
          params: { path: { pageId: page.id, draftId: draft.id } },
        }),
      );
      await refresh(page);
      toast({ title: t("versions.discardedRestored"), variant: "success" });
    } catch (error) {
      toast({ title: t("versions.undoFailed"), description: problemMessage(t, error), variant: "error" });
    }
  };
  return (
    <section aria-labelledby="discarded-drafts" className="flex flex-col gap-2 border-t border-border pt-3">
      <h2 id="discarded-drafts" className="px-2 text-sm font-semibold">
        {t("versions.discardedTitle")}
      </h2>
      <ul className="flex flex-col gap-2">
        {drafts.map((draft) => (
          <li key={draft.id} className="flex flex-col gap-1 rounded-md px-2 py-1">
            <span className="flex items-center gap-2">
              <Badge variant="neutral">
                {draft.reason === "replaced" ? t("versions.replacedBadge") : t("versions.discardedBadge")}
              </Badge>
              <span className="truncate text-sm" title={draft.title}>
                {draft.title}
              </span>
            </span>
            <span className="text-sm text-text-muted">
              {t("versions.discardedDetail", {
                time: format.dateTime(draft.discardedAt),
                expires: format.date(draft.expiresAt),
              })}
            </span>
            <Button size="sm" variant="secondary" onClick={() => void restore(draft)}>
              {t("versions.restoreAsDraft")}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RestoreDialog({
  page,
  number,
  draft,
  onOpenChange,
}: {
  page: ItemDetails;
  number: number;
  draft: Draft | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { space } = useSpace();
  const refresh = useContentRefresh();
  const publish = page.mode === "publish";
  const description = publish
    ? draft?.hasChanges && draft.basedOn !== null
      ? t("versions.restorePublishWithDraft", { number, count: draft.changes ?? 0 })
      : t("versions.restorePublish", { number })
    : t("versions.restoreLive", { number });
  return (
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title={t("versions.restoreTitle", { number })}
      description={description}
      confirmLabel={t("versions.restoreVersion", { number })}
      cancelLabel={t("versions.keepCurrent")}
      onConfirm={async () => {
        try {
          const result = await request(() =>
            api.POST("/api/v1/pages/{pageId}/versions/{number}/restore", {
              params: { path: { pageId: page.id, number } },
            }),
          );
          await refresh(page);
          await queryClient.invalidateQueries({ queryKey: ["items", page.id] });
          toast({
            title:
              result.version === null
                ? t("versions.restoredAsDraft", { number })
                : t("versions.restoredAsVersion", { number, version: result.version }),
            variant: "success",
          });
          if (result.version === null) {
            await navigate({
              to: pagePath(space.key, page.id, itemSlug(page.title)),
              search: { edit: true },
            });
          }
        } catch (error) {
          toast({
            title: t("versions.restoreFailed"),
            description: problemMessage(t, error),
            variant: "error",
          });
        }
      }}
    />
  );
}
