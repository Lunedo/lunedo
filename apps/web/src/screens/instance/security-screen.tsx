import { Section } from "@lunedo/ui";
import { useTranslation } from "react-i18next";
import { SettingsList } from "../../components/settings-list.js";
import { POLICY_SECTIONS } from "../../settings/settings-index.js";
import { SettingsPage } from "../settings/settings-page.js";
import { useInstanceSettingsEditor } from "./general-screen.js";

export function InstanceSecurityScreen() {
  const { t } = useTranslation();
  const editor = useInstanceSettingsEditor();
  return (
    <SettingsPage title={t("instance.policies.title")} description={t("instance.policies.description")}>
      {POLICY_SECTIONS.map((policy) => (
        <Section key={policy.titleKey} title={t(policy.titleKey)}>
          <SettingsList {...editor} keys={policy.keys} level="instance" />
        </Section>
      ))}
    </SettingsPage>
  );
}
