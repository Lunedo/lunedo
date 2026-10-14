import { FileArchive } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SettingsPage } from "../screens/settings/settings-page.js";
import { ExportsList } from "./exports-list.js";

export function ExportsScreen() {
  const { t } = useTranslation();
  return (
    <SettingsPage
      title={t("exports.screen.title")}
      description={t("exports.screen.description")}
      icon={FileArchive}
    >
      <ExportsList />
    </SettingsPage>
  );
}
