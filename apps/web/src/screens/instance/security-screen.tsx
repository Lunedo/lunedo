import { Section } from "@lunedo/ui";
import { useTranslation } from "react-i18next";
import { SettingsList } from "../../components/settings-list.js";
import { INSTANCE_TOKEN_KEYS, PROTECTION_KEYS, SIGN_IN_KEYS } from "../../settings/settings-index.js";
import { SettingsPage } from "../settings/settings-page.js";
import { useInstanceSettingsEditor } from "./general-screen.js";

export function InstanceSecurityScreen() {
  const { t } = useTranslation();
  const editor = useInstanceSettingsEditor();
  return (
    <SettingsPage title={t("instance.security.title")} description={t("instance.security.description")}>
      <Section title={t("instance.security.signIn")}>
        <SettingsList {...editor} keys={SIGN_IN_KEYS} level="instance" />
      </Section>
      <Section title={t("instance.security.protection")}>
        <SettingsList {...editor} keys={PROTECTION_KEYS} level="instance" />
      </Section>
      <Section title={t("instance.security.apiTokens")}>
        <SettingsList {...editor} keys={INSTANCE_TOKEN_KEYS} level="instance" />
      </Section>
    </SettingsPage>
  );
}
