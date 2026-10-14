import { Megaphone } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useOrganizationState } from "../../shell/shell-context.js";
import { AnnouncementSettings } from "../settings/announcement-settings.js";
import { SettingsPage } from "../settings/settings-page.js";

export function InstanceAnnouncementsScreen() {
  const { t } = useTranslation();
  const state = useOrganizationState();
  return (
    <SettingsPage
      title={t("announcements.title")}
      description={t("announcements.instanceDescription")}
      icon={Megaphone}
    >
      <AnnouncementSettings level="instance" editable={state.can("instance.settings.manage")} />
    </SettingsPage>
  );
}
