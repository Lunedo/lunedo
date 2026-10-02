import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { FileClock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { membersQuery } from "../../api/organization-queries.js";
import { AuditLog } from "../../components/audit-log.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

const route = getRouteApi("/app/settings/organizations/$organizationId/audit-log");

export function OrganizationAuditScreen() {
  const { t } = useTranslation();
  const { organizationId } = route.useParams();
  const state = useOrganizationState();
  const members = useQuery({
    ...membersQuery(organizationId),
    enabled: state.can("organization.members.view"),
  });
  return (
    <SettingsPage
      width="wide"
      title={t("audit.title")}
      description={t("audit.organizationDescription")}
      icon={FileClock}
      organizationId={organizationId}
    >
      <AuditLog
        scope="organization"
        organizationId={organizationId}
        people={(members.data ?? []).map((member) => ({ id: member.accountId, name: member.name }))}
        canExport={state.can("organization.audit.view")}
      />
    </SettingsPage>
  );
}
