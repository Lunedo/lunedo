import {
  Button,
  Combobox,
  type ComboboxItem,
  type ComboboxLoader,
  ConfirmDialog,
  Dialog,
  Field,
  focusFirstInvalidSoon,
  IconButton,
  Menu,
  useToast,
} from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, ChevronDown, EyeOff, FileText, Link2, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { ActionFailure } from "../../errors/failure.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { itemHref } from "../../spaces/item-paths.js";
import {
  type ArticleReview,
  type ArticleSource,
  articleReviewQuery,
  articleSourcesQuery,
  hiddenSourcesQuery,
  reviewKeys,
} from "./queries.js";
import { ReviewStatus, useReviewAction } from "./review-status.js";

type IntervalChoice = "inherit" | "0" | "3" | "6" | "12";

const sourceLoader: ComboboxLoader = async (query) => {
  const items = await request(() =>
    api.GET("/api/v1/items", { params: { query: { q: query, kind: "page", limit: 20 } } }),
  );
  return {
    items: items.map((item) => ({ value: item.id, label: item.title, description: item.spaceName })),
    nextCursor: null,
  };
};

function IntervalControl({
  itemId,
  review,
  editable,
}: {
  itemId: string;
  review: ArticleReview;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const label = review.effectiveIntervalMonths
    ? t("reviews.interval.months", { count: review.effectiveIntervalMonths })
    : t("reviews.interval.off");
  const source = review.inherited ? t("reviews.article.inherited") : t("reviews.article.setHere");
  if (!editable) {
    return (
      <span>
        {label} <span className="text-text-muted">({source})</span>
      </span>
    );
  }
  const change = async (choice: IntervalChoice) => {
    try {
      const next = await request(() =>
        api.PUT("/api/v1/articles/{itemId}/review/interval", {
          params: { path: { itemId } },
          body: { intervalMonths: choice === "inherit" ? null : (Number(choice) as 0 | 3 | 6 | 12) },
        }),
      );
      queryClient.setQueryData(reviewKeys.article(itemId), next);
      await queryClient.invalidateQueries({ queryKey: reviewKeys.mine });
      toast({ title: t("reviews.article.intervalSaved"), variant: "success" });
    } catch (error) {
      toast({
        title: t("reviews.article.intervalFailed"),
        description: problemMessage(t, error),
        variant: "error",
        action: { label: t("errors.retry"), onSelect: () => void change(choice) },
      });
    }
  };
  return (
    <Menu
      align="start"
      trigger={
        <button
          type="button"
          className="ld-inline-button inline-flex min-h-hit items-center gap-1 rounded-sm px-1 hover:bg-hover focus-visible:focus-ring"
          aria-label={t("reviews.article.changeInterval", { interval: label })}
        >
          {label}
          <span className="text-text-muted">({source})</span>
          <ChevronDown aria-hidden="true" className="size-icon-sm" />
        </button>
      }
      items={[
        { label: t("reviews.article.inherit"), onSelect: () => void change("inherit") },
        ...(["3", "6", "12"] as const).map((months) => ({
          label: t("reviews.interval.months", { count: Number(months) }),
          onSelect: () => void change(months),
        })),
        { label: t("reviews.interval.none"), onSelect: () => void change("0") },
      ]}
    />
  );
}

function SourceDialog({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<ComboboxItem | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!target) {
      setMissing(true);
      focusFirstInvalidSoon();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await request(() =>
        api.POST("/api/v1/articles/{itemId}/sources", {
          params: { path: { itemId } },
          body: { sourceId: target.value },
        }),
      );
      queryClient.setQueryData(reviewKeys.sources(itemId), next);
      onClose();
    } catch (failure) {
      setError(problemMessage(t, failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={t("reviews.sources.addTitle")}
      description={t("reviews.sources.addDescription")}
      size="md"
    >
      <div className="flex flex-col gap-4">
        {error ? <ActionFailure title={t("reviews.sources.addFailed")} message={error} /> : null}
        <Field
          label={t("reviews.sources.page")}
          hint={t("reviews.sources.pageHint")}
          {...(missing && !target ? { error: t("reviews.sources.choosePage") } : {})}
        >
          <Combobox
            placeholder={t("reviews.sources.search")}
            emptyText={t("reviews.sources.noPages")}
            value={target?.value ?? null}
            selectedItem={target}
            load={sourceLoader}
            onValueChange={(_value, chosen) => setTarget(chosen)}
          />
        </Field>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" icon={Link2} loading={busy} onClick={() => void submit()}>
            {t("reviews.sources.addConfirm")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function HiddenSources({ itemId }: { itemId: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const hidden = useQuery({ ...hiddenSourcesQuery(itemId), throwOnError: false });
  const [confirming, setConfirming] = useState(false);
  const count = hidden.data?.count ?? 0;
  if (count === 0) return null;
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
      <EyeOff aria-hidden="true" className="size-icon-sm shrink-0" />
      <span>{t("reviews.sources.hidden", { count })}</span>
      {hidden.data?.changed ? <span className="text-warning">{t("reviews.sources.changed")}</span> : null}
      <button
        type="button"
        className="rounded-sm text-accent hover:underline focus-visible:focus-ring"
        onClick={() => setConfirming(true)}
      >
        {t("reviews.sources.removeHidden", { count })}
      </button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t("reviews.sources.removeHiddenTitle", { count })}
        description={t("reviews.sources.removeHiddenDescription", { count })}
        confirmLabel={t("reviews.sources.removeHidden", { count })}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={async () => {
          try {
            const next = await request(() =>
              api.DELETE("/api/v1/articles/{itemId}/hidden-sources", { params: { path: { itemId } } }),
            );
            queryClient.setQueryData(reviewKeys.hiddenSources(itemId), next);
            await queryClient.invalidateQueries({ queryKey: reviewKeys.article(itemId) });
            toast({ title: t("reviews.sources.hiddenRemoved", { count }), variant: "success" });
          } catch (error) {
            toast({
              title: t("reviews.sources.removeHiddenFailed", { count }),
              description: problemMessage(t, error),
              variant: "error",
            });
            throw error;
          }
        }}
      />
    </span>
  );
}

function SourceLine({ itemId, editable }: { itemId: string; editable: boolean }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const sources = useQuery({ ...articleSourcesQuery(itemId), throwOnError: false });
  const [adding, setAdding] = useState(false);
  const list = sources.data ?? [];
  if (!editable && list.length === 0) return null;
  const remove = async (source: ArticleSource) => {
    try {
      const next = await request(() =>
        api.DELETE("/api/v1/articles/{itemId}/sources/{sourceId}", {
          params: { path: { itemId, sourceId: source.id } },
        }),
      );
      queryClient.setQueryData(reviewKeys.sources(itemId), next);
      await queryClient.invalidateQueries({ queryKey: reviewKeys.article(itemId) });
      toast({ title: t("reviews.sources.removed", { title: source.title }), variant: "success" });
    } catch (error) {
      toast({
        title: t("reviews.sources.removeFailed", { title: source.title }),
        description: problemMessage(t, error),
        variant: "error",
        action: { label: t("errors.retry"), onSelect: () => void remove(source) },
      });
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-muted">
      <span>{t("reviews.sources.label")}</span>
      {sources.isError ? <span>{t("reviews.sources.loadFailed")}</span> : null}
      {list.map((source) => {
        const href =
          itemHref({ id: source.id, kind: "page", title: source.title, link: null }, source.spaceKey) ?? "";
        const full = `${source.spaceName} › ${source.title}`;
        return (
          <span key={source.id} className="inline-flex min-w-0 max-w-full items-center gap-1">
            <FileText aria-hidden="true" className="size-icon-sm shrink-0" />
            <Link
              to={href}
              className="truncate text-accent hover:underline focus-visible:focus-ring"
              title={full}
            >
              {full}
            </Link>
            {source.changedAt ? <span className="text-warning">{t("reviews.sources.changed")}</span> : null}
            {editable ? (
              <IconButton
                size="sm"
                icon={X}
                label={t("reviews.sources.remove", { title: source.title })}
                onClick={() => void remove(source)}
              />
            ) : null}
          </span>
        );
      })}
      {editable ? <HiddenSources itemId={itemId} /> : null}
      {list.length === 0 && sources.data ? <span>{t("reviews.sources.none")}</span> : null}
      {editable ? (
        <button
          type="button"
          className="rounded-sm text-accent hover:underline focus-visible:focus-ring"
          onClick={() => setAdding(true)}
        >
          {t("reviews.sources.add")}
        </button>
      ) : null}
      <span className="w-full text-xs">{t("reviews.sources.internal")}</span>
      {adding ? <SourceDialog itemId={itemId} onClose={() => setAdding(false)} /> : null}
    </div>
  );
}

export function ArticleReviewLine({
  itemId,
  title,
  editable,
  published,
}: {
  itemId: string;
  title: string;
  editable: boolean;
  published: boolean;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const review = useQuery({ ...articleReviewQuery(itemId), throwOnError: false });
  const action = useReviewAction();
  const data = review.data;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-muted">
        <span>{t("reviews.article.label")}</span>
        {review.isError ? <span>{t("reviews.article.loadFailed")}</span> : null}
        {data ? (
          <>
            <IntervalControl itemId={itemId} review={data} editable={editable} />
            {data.reviewedAt ? (
              <span>
                <span aria-hidden="true">· </span>
                {data.reviewedBy?.name
                  ? t("reviews.article.reviewedBy", {
                      date: format.date(data.reviewedAt),
                      name: data.reviewedBy.name,
                    })
                  : t("reviews.article.reviewed", { date: format.date(data.reviewedAt) })}
              </span>
            ) : null}
            {data.state === "current" && data.dueAt ? (
              <span>
                <span aria-hidden="true">· </span>
                {t("reviews.article.next", { date: format.date(data.dueAt) })}
              </span>
            ) : data.state !== "off" && data.state !== "current" ? (
              <ReviewStatus timing={data} />
            ) : null}
            {editable && published ? (
              <Button
                size="sm"
                variant="outline"
                icon={Check}
                loading={action.busy === itemId}
                onClick={() => void action.run(itemId, title)}
              >
                {t("reviews.markReviewed")}
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
      <SourceLine itemId={itemId} editable={editable} />
    </div>
  );
}
