import { Section } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { BellRing } from "lucide-react";
import { useTranslation } from "react-i18next";
import { instanceSettingsQuery } from "../../api/instance-queries.js";
import { NotificationPreferences } from "../../components/notification-preferences.js";
import { SettingsList } from "../../components/settings-list.js";
import { BrowserPushSetting } from "../../notifications/browser-push-setting.js";
import { useNotificationDelivery } from "../../notifications/watching-api.js";
import { useInstanceSettingMutation } from "../../settings/setting-mutations.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

export function InstanceNotificationDefaultsScreen() {
  const { t } = useTranslation();
  const state = useOrganizationState();
  const settings = useQuery(instanceSettingsQuery);
  const mutation = useInstanceSettingMutation();
  const delivery = useNotificationDelivery();
  const editable = state.can("instance.settings.manage");
  return (
    <SettingsPage
      title={t("notifications.defaultsTitle")}
      description={t("notifications.instanceDefaultsDescription")}
      icon={BellRing}
    >
      <NotificationPreferences
        settings={settings.data}
        loading={settings.isPending}
        level="instance"
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
          keys={["notifications.digestEnabled", "notifications.digestTime"]}
          level="instance"
          canManage={() => editable}
          onChange={async (key, change) => {
            await mutation.mutateAsync({ key, change });
          }}
        />
      </Section>
      <BrowserPushSetting settings={settings.data} editable={editable} />
    </SettingsPage>
  );
}
