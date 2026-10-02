import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { BellRing } from "lucide-react";
import { useTranslation } from "react-i18next";
import { organizationQuery, organizationSettingsQuery } from "../../api/organization-queries.js";
import { NotificationPreferences } from "../../components/notification-preferences.js";
import { useOrganizationSettingMutation } from "../../settings/setting-mutations.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

const route = getRouteApi("/app/settings/organizations/$organizationId/notifications");

export function OrganizationNotificationDefaultsScreen() {
  const { t } = useTranslation();
  const { organizationId } = route.useParams();
  const state = useOrganizationState();
  const organization = useQuery(organizationQuery(organizationId));
  const settings = useQuery(organizationSettingsQuery(organizationId));
  const mutation = useOrganizationSettingMutation(organizationId);
  return (
    <SettingsPage
      title={t("notifications.defaultsTitle")}
      description={t("notifications.organizationDefaultsDescription")}
      icon={BellRing}
      organizationId={organizationId}
    >
      <NotificationPreferences
        settings={settings.data}
        loading={settings.isPending}
        level="organization"
        {...(organization.data ? { organizationName: organization.data.name } : {})}
        editable={state.can("organization.settings.manage")}
        onChange={(key, value) =>
          mutation.mutateAsync({ key, change: value === undefined ? { clear: true } : { value } })
        }
      />
    </SettingsPage>
  );
}
