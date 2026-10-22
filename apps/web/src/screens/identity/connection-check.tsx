import { Button, Notice } from "@lunedo/ui";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { ConnectionCheckResult } from "../../api/identity-queries.js";
import { translateKey } from "../../i18n/translate.js";

export function connectionCheckMessage(t: TFunction, result: ConnectionCheckResult): string {
  return translateKey(
    t,
    `identityProviders.check.messages.${result.check}.${result.problem ?? "unreachable"}`,
    {
      url: result.url ?? "",
      status: result.status ?? "",
      detail: result.detail ?? "",
    },
  );
}

export function connectionCheckField(result: ConnectionCheckResult, oidcField: string): string {
  if (result.check === "discovery") return oidcField;
  if (result.check === "metadata") return "url";
  if (result.problem === "serviceAccount") return "bindDn";
  if (result.problem === "search") return "userBaseDn";
  return "url";
}

export function FailedCheckNotice({ busy, onSaveAnyway }: { busy: boolean; onSaveAnyway: () => void }) {
  const { t } = useTranslation();
  return (
    <Notice
      variant="warning"
      title={t("identityProviders.check.failedTitle")}
      action={
        <Button variant="secondary" size="sm" loading={busy} onClick={onSaveAnyway}>
          {t("identityProviders.check.saveAnyway")}
        </Button>
      }
    >
      {t("identityProviders.check.saveAnywayHint")}
    </Notice>
  );
}
