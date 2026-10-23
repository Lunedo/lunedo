import { getRouteApi } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AuditLog } from "../../components/audit-log.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

const route = getRouteApi("/app/settings/organizations/$organizationId/audit-log");

export function OrganizationAuditScreen() {
  const { t } = useTranslation();
  const { organizationId } = route.useParams();
  const state = useOrganizationState();
  return (
    <SettingsPage
      width="wide"
      title={t("audit.title")}
      description={t("audit.organizationDescription")}
      organizationId={organizationId}
    >
      <AuditLog
        scope="organization"
        organizationId={organizationId}
        canExport={state.can("organization.audit.view")}
      />
    </SettingsPage>
  );
}
