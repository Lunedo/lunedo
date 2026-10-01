import { useToast } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { BellRing } from "lucide-react";
import { useTranslation } from "react-i18next";
import { instanceSettingsQuery } from "../../api/instance-queries.js";
import { NotificationPreferences } from "../../components/notification-preferences.js";
import { problemMessage } from "../../errors/problem-message.js";
import { useInstanceSettingMutation } from "../../settings/setting-mutations.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

export function InstanceNotificationDefaultsScreen() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const state = useOrganizationState();
  const settings = useQuery(instanceSettingsQuery);
  const mutation = useInstanceSettingMutation();
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
        editable={state.can("instance.settings.manage")}
        onChange={(key, value) =>
          mutation.mutate(
            { key, change: value === undefined ? { clear: true } : { value } },
            { onError: (error) => toast({ title: problemMessage(t, error), variant: "error" }) },
          )
        }
      />
    </SettingsPage>
  );
}
