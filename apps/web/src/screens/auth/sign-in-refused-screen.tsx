import { Button, Notice } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isRefusalReason } from "../../api/identity-queries.js";
import { instanceInfoQuery } from "../../api/queries.js";
import { AuthCard } from "./auth-layout.js";

const route = getRouteApi("/public/sign-in/refused");

export function SignInRefusedScreen() {
  const { t } = useTranslation();
  const search = route.useSearch();
  const navigate = useNavigate();
  const info = useQuery(instanceInfoQuery);
  const reason = isRefusalReason(search.reason) ? search.reason : "invalidResponse";
  const name = info.data?.organization?.name ?? info.data?.name ?? "";
  return (
    <AuthCard title={t("auth.refused.title")}>
      <Notice variant="danger" title={t(`auth.refused.reasons.${reason}.title`, { name })}>
        <div className="flex flex-col gap-2">
          <p>{t(`auth.refused.reasons.${reason}.cause`, { name })}</p>
          <p>
            <span className="font-semibold">{t("auth.refused.whatToDo")}</span>{" "}
            {t(`auth.refused.reasons.${reason}.action`, { name })}
          </p>
        </div>
      </Notice>
      <Button
        variant="outline"
        size="lg"
        block
        icon={ArrowLeft}
        onClick={() => void navigate({ to: "/sign-in" })}
      >
        {t("auth.refused.anotherAccount")}
      </Button>
      {search.reference ? (
        <p className="text-center text-sm text-text-muted">
          {t("auth.refused.reference")} <span className="font-mono text-text">{search.reference}</span>
        </p>
      ) : null}
    </AuthCard>
  );
}
