import { useToast } from "@pagehall/ui";
import { BellRing } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NotificationPreferences } from "../../components/notification-preferences.js";
import { problemMessage } from "../../errors/problem-message.js";
import { usePreferenceList, useUpdatePreference } from "../../preferences/preferences.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

export function NotificationPreferencesScreen() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const list = usePreferenceList();
  const update = useUpdatePreference();
  const organization = useOrganizationState();
  const home = organization.organizations.find((entry) => entry.membershipKind === "member");
  return (
    <SettingsPage
      title={t("notifications.preferencesTitle")}
      description={t("notifications.preferencesDescription")}
      icon={BellRing}
    >
      <NotificationPreferences
        settings={list.data}
        loading={list.isPending}
        level="user"
        {...(home ? { organizationName: home.name } : {})}
        editable
        onChange={(key, value) =>
          update.mutate(
            { key, value },
            { onError: (error) => toast({ title: problemMessage(t, error), variant: "error" }) },
          )
        }
      />
    </SettingsPage>
  );
}
