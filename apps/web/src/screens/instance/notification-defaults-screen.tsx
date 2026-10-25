import { Section, Skeleton } from "@lunedo/ui";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { instanceSettingsQuery, storageQuery } from "../../api/instance-queries.js";
import { NotificationPreferences } from "../../components/notification-preferences.js";
import { SettingsList } from "../../components/settings-list.js";
import { LoadError } from "../../errors/failure.js";
import { BrowserPushSetting } from "../../notifications/browser-push-setting.js";
import { useNotificationDelivery } from "../../notifications/watching-api.js";
import { useInstanceSettingMutation } from "../../settings/setting-mutations.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";
import { OperationsContactsSection } from "./storage-screen.js";

export function InstanceNotificationDefaultsScreen() {
  const { t } = useTranslation();
  const state = useOrganizationState();
  const settings = useQuery(instanceSettingsQuery);
  const mutation = useInstanceSettingMutation();
  const delivery = useNotificationDelivery();
  const storage = useQuery({ ...storageQuery, throwOnError: false });
  const editable = state.can("instance.settings.manage");
  return (
    <SettingsPage
      title={t("notifications.defaultsTitle")}
      description={t("notifications.instanceDefaultsDescription")}
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
      {storage.isPending ? <Skeleton className="h-32 w-full" /> : null}
      {storage.isError ? (
        <LoadError
          what={t("storage.contacts.loadFailed")}
          error={storage.error}
          onRetry={() => storage.refetch()}
        />
      ) : null}
      {storage.data ? <OperationsContactsSection status={storage.data} canManage={editable} /> : null}
    </SettingsPage>
  );
}
