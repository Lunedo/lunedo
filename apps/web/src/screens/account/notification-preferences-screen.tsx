import { Button, Section, SettingRow } from "@pagehall/ui";
import { Link } from "@tanstack/react-router";
import { BellRing } from "lucide-react";
import { useTranslation } from "react-i18next";
import { FollowedBlogs } from "../../collaboration/blog/followed-blogs.js";
import { NotificationPreferences } from "../../components/notification-preferences.js";
import { SettingsList } from "../../components/settings-list.js";
import { useNotificationDelivery, useWatchedList } from "../../notifications/watching-api.js";
import { usePreferenceList, useUpdatePreference } from "../../preferences/preferences.js";
import type { SettingChange } from "../../settings/setting-mutations.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";

export function NotificationPreferencesScreen() {
  const { t } = useTranslation();
  const list = usePreferenceList();
  const update = useUpdatePreference();
  const organization = useOrganizationState();
  const delivery = useNotificationDelivery();
  const watched = useWatchedList();
  const home = organization.organizations.find((entry) => entry.membershipKind === "member");
  const save = async (key: string, change: SettingChange) => {
    if ("locked" in change) return;
    await update.mutateAsync({ key, value: "value" in change ? change.value : undefined });
  };
  const counts = watched.data?.counts;
  const organizationName = home ? { organizationName: home.name } : {};
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
        {...organizationName}
        editable
        emailMethod={delivery.data?.emailMethod}
        onChange={(key, value) => update.mutateAsync({ key, value })}
      />
      <Section title={t("notifications.digest.title")}>
        <SettingsList
          settings={list.data}
          keys={["notifications.digestEnabled", "notifications.digestTime"]}
          level="user"
          {...organizationName}
          canManage={() => true}
          onChange={save}
        />
      </Section>
      <Section title={t("notifications.watching.title")}>
        <SettingsList
          settings={list.data}
          keys={["notifications.watchAutomatically"]}
          level="user"
          {...organizationName}
          canManage={() => true}
          onChange={save}
        />
        <SettingRow
          label={t("notifications.watching.watched")}
          description={
            counts
              ? t("notifications.watching.counts", {
                  watched: counts.watchedItems + counts.watchedSpaces,
                  muted: counts.mutedItems + counts.mutedSpaces,
                })
              : undefined
          }
          control={
            <Button asChild variant="secondary">
              <Link to="/settings/notifications/watching">{t("notifications.watching.manage")}</Link>
            </Button>
          }
        />
      </Section>
      <FollowedBlogs />
    </SettingsPage>
  );
}
