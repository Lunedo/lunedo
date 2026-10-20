import { classNames, useToast } from "@pagehall/ui";
import { useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { ownershipKeys } from "../../spaces/ownership/ownership-queries.js";
import { type ReviewState, reviewKeys } from "./queries.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const RADIUS = 5.5;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export interface ReviewTiming {
  state: ReviewState;
  dueAt: string | null;
  reviewedAt: string | null;
  publishedAt: string | null;
}

function daysBetween(from: number, to: number): number {
  return Math.max(0, Math.floor((to - from) / DAY_MS));
}

export function reviewProgress(timing: ReviewTiming, now: number): number {
  const base = timing.reviewedAt ?? timing.publishedAt;
  if (!timing.dueAt || !base) return 0;
  const start = new Date(base).getTime();
  const end = new Date(timing.dueAt).getTime();
  if (end <= start) return 1;
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
}

export function reviewStateText(
  t: TFunction,
  format: ReturnType<typeof useFormat>,
  timing: ReviewTiming,
  now: number,
): string {
  const due = timing.dueAt ? new Date(timing.dueAt).getTime() : null;
  switch (timing.state) {
    case "overdue": {
      const days = due === null ? 0 : daysBetween(due, now);
      return days === 0 ? t("reviews.state.dueToday") : t("reviews.state.overdue", { count: days });
    }
    case "sourceChanged":
      return t("reviews.state.sourceChanged");
    case "dueSoon": {
      const days = due === null ? 0 : Math.max(1, Math.ceil((due - now) / DAY_MS));
      return t("reviews.state.dueSoon", { count: days });
    }
    case "current":
      return timing.dueAt ? t("reviews.state.current", { date: format.date(timing.dueAt) }) : "";
    default:
      return t("reviews.state.off");
  }
}

const TONES: Record<ReviewState, string> = {
  overdue: "text-danger",
  sourceChanged: "text-warning",
  dueSoon: "text-warning",
  current: "text-text-muted",
  off: "text-text-muted",
};

export function ReviewRing({ timing, now }: { timing: ReviewTiming; now: number }) {
  const progress = Math.max(0.04, reviewProgress(timing, now));
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="size-icon-md shrink-0">
      <circle cx="8" cy="8" r={RADIUS} fill="none" stroke="var(--color-border)" strokeWidth="2" />
      {timing.state === "overdue" ? (
        <>
          <circle cx="8" cy="8" r="6.5" fill="currentColor" />
          <path d="M8 4.8v3.6M8 10.9v.1" stroke="var(--color-bg)" strokeWidth="1.8" strokeLinecap="round" />
        </>
      ) : timing.state === "off" ? null : (
        <circle
          cx="8"
          cy="8"
          r={RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray={`${(progress * CIRCUMFERENCE).toFixed(2)} ${CIRCUMFERENCE.toFixed(2)}`}
          transform="rotate(-90 8 8)"
          strokeLinecap="round"
        />
      )}
      {timing.state === "sourceChanged" ? <circle cx="8" cy="8" r="1.7" fill="currentColor" /> : null}
    </svg>
  );
}

export function ReviewStatus({
  timing,
  now = Date.now(),
  fixed = false,
}: {
  timing: ReviewTiming;
  now?: number;
  fixed?: boolean;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  const text = reviewStateText(t, format, timing, now);
  return (
    <span
      className={classNames(
        "inline-flex items-center gap-2 font-medium",
        fixed ? "shrink-0" : "min-w-0",
        TONES[timing.state],
      )}
    >
      <ReviewRing timing={timing} now={now} />
      <span className="truncate" title={text}>
        {text}
      </span>
    </span>
  );
}

export function useMarkReviewed() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const format = useFormat();
  const refresh = async (itemId: string) => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["spaces"],
        predicate: (query) => query.queryKey.includes("reviews"),
      }),
      queryClient.invalidateQueries({ queryKey: reviewKeys.article(itemId) }),
      queryClient.invalidateQueries({ queryKey: reviewKeys.mine }),
      queryClient.invalidateQueries({ queryKey: ownershipKeys.activity(itemId) }),
    ]);
  };
  const undo = async (itemId: string, title: string, reviewId: string) => {
    try {
      await request(() =>
        api.DELETE("/api/v1/articles/{itemId}/reviews/{reviewId}", {
          params: { path: { itemId, reviewId } },
        }),
      );
      await refresh(itemId);
      toast({ title: t("reviews.undone", { title }) });
    } catch (error) {
      toast({
        variant: "error",
        title: t("reviews.undoFailed", { title }),
        description: problemMessage(t, error),
        action: { label: t("errors.retry"), onSelect: () => void undo(itemId, title, reviewId) },
      });
    }
  };
  const mark = async (itemId: string, title: string): Promise<boolean> => {
    try {
      const record = await request(() =>
        api.POST("/api/v1/articles/{itemId}/reviews", { params: { path: { itemId } } }),
      );
      await refresh(itemId);
      toast({
        title: record.dueAt
          ? t("reviews.marked", { title, date: format.date(record.dueAt) })
          : t("reviews.markedWithoutDue", { title }),
        undo: { onUndo: () => void undo(itemId, title, record.reviewId) },
      });
      return true;
    } catch (error) {
      toast({
        variant: "error",
        title: t("reviews.markFailed", { title }),
        description: problemMessage(t, error),
        action: { label: t("errors.retry"), onSelect: () => void mark(itemId, title) },
      });
      return false;
    }
  };
  return mark;
}

export function useReviewAction() {
  const markReviewed = useMarkReviewed();
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (itemId: string, title: string) => {
    setBusy(itemId);
    try {
      await markReviewed(itemId, title);
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}
