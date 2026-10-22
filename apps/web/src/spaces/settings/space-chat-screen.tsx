import { spaceChatEvents } from "@lunedo/shared";
import { MessagesSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ChatChannelsPanel } from "../../chat/chat-channels-panel.js";
import { useSpace } from "../space-context.js";
import { SpaceSettingsPage } from "./space-settings-page.js";

export function SpaceChatScreen() {
  const { t } = useTranslation();
  const { space } = useSpace();
  const unavailable = space.confidential
    ? t("chatChannels.confidential")
    : space.personal
      ? t("chatChannels.personal")
      : undefined;
  return (
    <SpaceSettingsPage
      tab="chat"
      title={t("chatChannels.title")}
      description={t("chatChannels.spaceDescription")}
      icon={MessagesSquare}
    >
      <ChatChannelsPanel
        owner={{ kind: "space", spaceId: space.id }}
        events={spaceChatEvents}
        title={t("chatChannels.title")}
        description={t("chatChannels.spacePanelDescription")}
        canManage={space.role === "admin"}
        unavailable={unavailable}
      />
    </SpaceSettingsPage>
  );
}
