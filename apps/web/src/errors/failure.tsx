import { ErrorState, useToast } from "@pagehall/ui";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api/request.js";
import { problemMessage } from "./problem-message.js";

const NOT_RETRYABLE = new Set([
  "invalidInput",
  "passwordPolicy",
  "forbidden",
  "notFound",
  "settingLocked",
  "invalidCredentials",
  "invalidSecondFactor",
  "emailInUse",
  "slugTaken",
  "domainTaken",
  "roleNameTaken",
  "groupNameTaken",
  "alreadyMember",
  "alreadyAssigned",
  "lastOwner",
  "changeNotComparable",
  "comparisonUnavailable",
  "comparisonWithheld",
]);

export function isRetryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return !NOT_RETRYABLE.has(error.code) && !error.code.startsWith("invalid");
}

export function FailureNotice({
  what,
  error,
  onRetry,
}: {
  what: string;
  error: unknown;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ErrorState
      title={what}
      cause={problemMessage(t, error)}
      {...(onRetry && isRetryable(error) ? { onRetry } : {})}
    />
  );
}

export function LoadError({
  what,
  error,
  onRetry,
}: {
  what: string;
  error: unknown;
  onRetry: () => unknown;
}) {
  return <FailureNotice what={what} error={error} onRetry={() => void onRetry()} />;
}

export function useFailureToast() {
  const { t } = useTranslation();
  const { toast } = useToast();
  return useCallback(
    (what: string, error: unknown, retry?: () => void) =>
      toast({
        title: what,
        description: problemMessage(t, error),
        variant: "error",
        ...(retry && isRetryable(error) ? { action: { label: t("errors.retry"), onSelect: retry } } : {}),
      }),
    [t, toast],
  );
}
