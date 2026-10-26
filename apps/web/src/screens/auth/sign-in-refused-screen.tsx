import { Button, Notice } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Lock, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { isRefusalReason } from "../../api/identity-queries.js";
import { instanceInfoQuery } from "../../api/queries.js";
import { problemMessage } from "../../errors/problem-message.js";
import { startProviderSignIn } from "../../session/provider-sign-in.js";
import { AuthCard } from "./auth-layout.js";

const route = getRouteApi("/public/sign-in/refused");

const RETRY_REASONS = new Set(["invalidResponse", "groupRequired", "accountCreationDisabled"]);

export function SignInRefusedScreen() {
  const { t } = useTranslation();
  const search = route.useSearch();
  const navigate = useNavigate();
  const info = useQuery(instanceInfoQuery);
  const reason = isRefusalReason(search.reason) ? search.reason : "invalidResponse";
  const name = info.data?.organization?.name ?? info.data?.name ?? "";
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retry = async () => {
    setError(null);
    if (!search.provider) {
      await navigate({ to: "/sign-in" });
      return;
    }
    setRetrying(true);
    try {
      await startProviderSignIn(search.provider);
    } catch (failure) {
      setError(problemMessage(t, failure));
      setRetrying(false);
    }
  };
  const canRetry = RETRY_REASONS.has(reason);
  return (
    <AuthCard
      banner={
        <p className="flex items-center gap-2 rounded-md bg-danger-soft px-3 py-2 font-medium text-danger text-sm">
          <Lock aria-hidden="true" className="size-icon-md shrink-0" />
          {t("auth.refused.title")}
        </p>
      }
      title={t(`auth.refused.reasons.${reason}.title`, { name })}
      description={t(`auth.refused.reasons.${reason}.cause`, { name })}
      links={
        search.reference ? (
          <p className="text-center text-text-muted">
            {t("auth.refused.reference")} <span className="font-mono text-text">{search.reference}</span>
          </p>
        ) : null
      }
    >
      <p>
        <span className="font-semibold">{t("auth.refused.whatToDo")}</span>{" "}
        {t(`auth.refused.reasons.${reason}.action`, { name })}
      </p>
      {error ? (
        <Notice variant="danger" title={t("auth.signInFailed")}>
          {error}
        </Notice>
      ) : null}
      <div className="flex flex-col gap-2">
        {canRetry ? (
          <Button
            variant="primary"
            size="lg"
            block
            icon={RotateCcw}
            loading={retrying}
            onClick={() => void retry()}
          >
            {t("auth.refused.retry")}
          </Button>
        ) : null}
        <Button
          variant={canRetry ? "outline" : "primary"}
          size="lg"
          block
          icon={ArrowLeft}
          onClick={() => void navigate({ to: "/sign-in" })}
        >
          {t("auth.refused.anotherAccount")}
        </Button>
      </div>
    </AuthCard>
  );
}
