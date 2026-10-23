import { Badge, Section, SettingRow } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { organizationQuery, organizationSettingsQuery } from "../../api/organization-queries.js";
import { NotificationPreferences } from "../../components/notification-preferences.js";
import { SettingsList } from "../../components/settings-list.js";
import { useNotificationDelivery } from "../../notifications/watching-api.js";
import { useOrganizationSettingMutation } from "../../settings/setting-mutations.js";
import { NOTIFICATION_DELIVERY_KEYS } from "../../settings/settings-index.js";
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
  const delivery = useNotificationDelivery();
  const editable = state.can("organization.settings.manage");
  const organizationName = organization.data ? { organizationName: organization.data.name } : {};
  return (
    <SettingsPage
      title={t("notifications.defaultsTitle")}
      description={t("notifications.organizationDefaultsDescription", {
        name: organization.data?.name ?? "",
      })}
    >
      <NotificationPreferences
        settings={settings.data}
        loading={settings.isPending}
        level="organization"
        {...organizationName}
        editable={editable}
        emailMethod={delivery.data?.emailMethod}
        browserPush={delivery.data?.browserPush ?? false}
        onChange={(key, value) =>
          mutation.mutateAsync({ key, change: value === undefined ? { clear: true } : { value } })
        }
      />
      <Section title={t("notifications.delivery")}>
        <SettingsList
          settings={settings.data}
          keys={NOTIFICATION_DELIVERY_KEYS}
          level="organization"
          {...organizationName}
          canManage={() => editable}
          onChange={async (key, change) => {
            await mutation.mutateAsync({ key, change });
          }}
        />
        {delivery.data ? (
          <SettingRow
            label={t("notifications.push.title")}
            description={
              delivery.data.browserPush
                ? t("notifications.push.organizationOn")
                : t("notifications.push.organizationOff")
            }
            control={
              <Badge variant={delivery.data.browserPush ? "success" : "neutral"}>
                {delivery.data.browserPush ? t("notifications.push.on") : t("notifications.push.off")}
              </Badge>
            }
          />
        ) : null}
      </Section>
    </SettingsPage>
  );
}
