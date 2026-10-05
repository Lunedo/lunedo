import { Notice, Section } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { instanceSettingsQuery, mailQuery } from "../../api/instance-queries.js";
import { SettingsList } from "../../components/settings-list.js";
import { type SettingChange, useInstanceSettingMutation } from "../../settings/setting-mutations.js";
import { useOrganizationState } from "../../shell/shell-context.js";
import { SettingsPage } from "../settings/settings-page.js";
import { InstanceAddressRow } from "./instance-address.js";

export function settingPermission(key: string): string {
  if (key.startsWith("auth.")) return "instance.signIn.manage";
  if (key.startsWith("audit.")) return "instance.audit.manage";
  if (key.startsWith("organizations.")) return "instance.organizations.manage";
  return "instance.settings.manage";
}

export function useInstanceSettingsEditor() {
  const state = useOrganizationState();
  const settings = useQuery(instanceSettingsQuery);
  const mutation = useInstanceSettingMutation();
  return {
    settings: settings.data,
    canManage: (key: string) => state.can(settingPermission(key)),
    onChange: async (key: string, change: SettingChange) => {
      await mutation.mutateAsync({ key, change });
    },
  };
}

function MailNotice() {
  const { t } = useTranslation();
  const mail = useQuery({ ...mailQuery, throwOnError: false, retry: false });
  const data = mail.data;
  if (!data) return null;
  const configured = data.method === "graph" ? data.graph !== null : data.smtp !== null;
  if (configured) return null;
  return (
    <Notice variant="warning" title={t("instance.general.mailMissingTitle")}>
      <div className="flex flex-col gap-2">
        <p>{t("instance.general.mailMissing")}</p>
        <Link to="/settings/instance/mail" className="font-medium text-accent hover:underline">
          {t("instance.general.mailSettings")}
        </Link>
      </div>
    </Notice>
  );
}

export function InstanceGeneralScreen() {
  const { t } = useTranslation();
  const editor = useInstanceSettingsEditor();
  return (
    <SettingsPage
      title={t("instance.general.title")}
      description={t("instance.general.description")}
      icon={SlidersHorizontal}
    >
      <MailNotice />
      <Section title={t("instance.general.identity")}>
        <SettingsList {...editor} keys={["instance.name"]} level="instance" />
        <InstanceAddressRow canManage={editor.canManage("instance.url")} />
        <SettingsList {...editor} keys={["branding.accentColor"]} level="instance" />
      </Section>
      <Section title={t("instance.general.localeDefaults")}>
        <SettingsList
          {...editor}
          keys={[
            "locale.language",
            "locale.timeZone",
            "locale.dateFormat",
            "locale.timeFormat",
            "locale.numberFormat",
            "locale.firstDayOfWeek",
          ]}
          level="instance"
        />
      </Section>
      <Section title={t("instance.general.organizations")}>
        <SettingsList
          {...editor}
          keys={[
            "organizations.selfServiceCreation",
            "organizations.membersCreateGroups",
            "organizations.selfRegistration",
            "organizations.guestExpiryReminderDays",
            "organizations.guestInactivityDays",
            "organizations.expiryReminderDays",
            "organizations.breakGlassMinutes",
          ]}
          level="instance"
        />
      </Section>
      <Section title={t("instance.general.retention")}>
        <SettingsList
          {...editor}
          keys={["audit.retentionDays", "notifications.retentionDays", "apiTokens.publicDocumentation"]}
          level="instance"
        />
      </Section>
    </SettingsPage>
  );
}
