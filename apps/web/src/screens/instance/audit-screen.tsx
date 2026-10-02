import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { useTranslation } from "react-i18next";
import { instanceAccountsQuery } from "../../api/instance-queries.js";
import { AuditLog } from "../../components/audit-log.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

export function InstanceAuditScreen() {
  const { t } = useTranslation();
  const state = useOrganizationState();
  const accounts = useQuery({ ...instanceAccountsQuery, enabled: state.can("instance.accounts.view") });
  return (
    <SettingsPage
      width="wide"
      title={t("audit.title")}
      description={t("audit.instanceDescription")}
      icon={Activity}
    >
      <AuditLog
        scope="instance"
        people={(accounts.data ?? []).map((account) => ({ id: account.id, name: account.name }))}
        canExport={state.can("instance.audit.view")}
      />
    </SettingsPage>
  );
}
