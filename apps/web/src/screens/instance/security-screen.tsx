import { Section } from "@pagehall/ui";
import { LockKeyhole } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SettingsList } from "../../components/settings-list.js";
import { SettingsPage } from "../settings/settings-page.js";
import { useInstanceSettingsEditor } from "./general-screen.js";

export function InstanceSecurityScreen() {
  const { t } = useTranslation();
  const editor = useInstanceSettingsEditor();
  return (
    <SettingsPage
      title={t("instance.security.title")}
      description={t("instance.security.description")}
      icon={LockKeyhole}
    >
      <Section title={t("instance.security.signIn")}>
        <SettingsList
          {...editor}
          keys={[
            "auth.twoFactorRequired",
            "auth.passwordMinLength",
            "auth.reauthenticationMinutes",
            "auth.sessionIdleTimeoutMinutes",
            "auth.sessionLifetimeMinutes",
            "auth.maxSessionsPerAccount",
          ]}
          level="instance"
        />
      </Section>
      <Section title={t("instance.security.protection")}>
        <SettingsList
          {...editor}
          keys={[
            "auth.signInAttemptsPerAccountPerMinute",
            "auth.signInAttemptsPerClientPerMinute",
            "auth.lockoutFailuresPerAccount",
            "auth.lockoutFailuresPerClient",
            "auth.lockoutWindowMinutes",
            "auth.lockoutMinutes",
            "auth.lockoutMaxMinutes",
          ]}
          level="instance"
        />
      </Section>
      <Section title={t("instance.security.apiTokens")}>
        <SettingsList
          {...editor}
          keys={["apiTokens.maxLifetimeDays", "apiTokens.requestsPerMinute", "apiTokens.expiryReminderDays"]}
          level="instance"
        />
      </Section>
    </SettingsPage>
  );
}
