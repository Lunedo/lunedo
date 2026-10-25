import { organizationChatEvents } from "@lunedo/shared";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { organizationQuery } from "../../api/organization-queries.js";
import { ChatChannelsPanel } from "../../chat/chat-channels-panel.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { AnnouncementSettings } from "../settings/announcement-settings.js";
import { SettingsPage } from "../settings/settings-page.js";

const route = getRouteApi("/app/settings/organizations/$organizationId/announcements");

export function OrganizationAnnouncementsScreen() {
  const { t } = useTranslation();
  const { organizationId } = route.useParams();
  const state = useOrganizationState();
  const organization = useQuery(organizationQuery(organizationId));
  return (
    <SettingsPage title={t("announcements.title")} description={t("announcements.organizationDescription")}>
      <AnnouncementSettings
        level="organization"
        organizationId={organizationId}
        organizationName={organization.data?.name}
        editable={state.can("organization.settings.manage")}
        beforeDangerZone={
          <ChatChannelsPanel
            owner={{ kind: "organization", organizationId }}
            events={organizationChatEvents}
            title={t("chatChannels.announcementsTitle")}
            canManage={state.can("organization.integrations.manage")}
            secondaryAction
          />
        }
      />
    </SettingsPage>
  );
}
