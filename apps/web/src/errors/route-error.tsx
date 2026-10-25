import { Button, EmptyState, ErrorState } from "@lunedo/ui";
import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { type ErrorComponentProps, Link, useRouter } from "@tanstack/react-router";
import { Compass, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ApiError, isApiError } from "../api/request.js";
import { isRetryable } from "./failure.js";
import { problemMessage } from "./problem-message.js";

export function AppNotFoundScreen() {
  return <NotFoundScreen inShell />;
}

export function NotFoundScreen({ inShell = false }: { inShell?: boolean }) {
  const { t } = useTranslation();
  return (
    <main
      {...(inShell ? { id: "main" } : {})}
      className={
        inShell
          ? "flex min-w-0 flex-1 items-center justify-center overflow-y-auto p-6"
          : "flex min-h-full items-center justify-center p-6"
      }
    >
      <EmptyState
        icon={Compass}
        title={t("errors.notFoundTitle")}
        description={t("errors.notFoundDescription")}
        action={
          <Button variant="primary" asChild>
            <Link to="/">{t("errors.backHome")}</Link>
          </Button>
        }
      />
    </main>
  );
}

function ForbiddenScreen() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <EmptyState
        icon={Lock}
        title={t("errors.forbiddenTitle")}
        description={t("errors.forbiddenDescription")}
      />
    </div>
  );
}

function useRetry(reset: () => void) {
  const router = useRouter();
  const queries = useQueryErrorResetBoundary();
  return () => {
    queries.reset();
    reset();
    void router.invalidate();
  };
}

export function ScreenErrorScreen({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation();
  const retry = useRetry(reset);
  if (isApiError(error, "notFound")) return <NotFoundScreen />;
  if (isApiError(error, "forbidden")) return <ForbiddenScreen />;
  if (!(error instanceof ApiError)) {
    return (
      <div className="mx-auto w-full max-w-content p-6">
        <ErrorState
          title={t("errors.browserTitle")}
          cause={t("errors.browserCause")}
          onRetry={() => window.location.reload()}
          retryLabel={t("errors.reload")}
        />
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-content p-6">
      <ErrorState
        title={t("errors.failedTitle")}
        cause={problemMessage(t, error)}
        {...(isRetryable(error) ? { onRetry: retry } : {})}
      />
    </div>
  );
}

export function RouteErrorScreen(props: ErrorComponentProps) {
  return (
    <main className="flex min-h-full items-center justify-center">
      <ScreenErrorScreen {...props} />
    </main>
  );
}
