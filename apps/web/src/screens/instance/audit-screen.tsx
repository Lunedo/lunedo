import { Activity } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AuditLog } from "../../components/audit-log.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

export function InstanceAuditScreen() {
  const { t } = useTranslation();
  const state = useOrganizationState();
  return (
    <SettingsPage
      width="wide"
      title={t("audit.title")}
      description={t("audit.instanceDescription")}
      icon={Activity}
    >
      <AuditLog scope="instance" canExport={state.can("instance.audit.view")} />
    </SettingsPage>
  );
}
