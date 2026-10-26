import { Button } from "@lunedo/ui";
import { RotateCw } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { ShellBanner } from "../shell/shell-banner.js";
import { hasUnsavedChanges, saveAndReload, subscribeToUpdates, updateState } from "./app-update.js";

export function UpdateBanner() {
  const { t } = useTranslation();
  const { refused } = useSyncExternalStore(subscribeToUpdates, updateState);
  const [saving, setSaving] = useState(false);
  if (!refused) return null;
  const unsaved = hasUnsavedChanges();
  return (
    <ShellBanner variant="warning" role="status" title={t("appUpdate.title")}>
      {t(unsaved ? "appUpdate.refusedUnsaved" : "appUpdate.refused")}{" "}
      <Button
        size="sm"
        variant="secondary"
        disabled={saving}
        onClick={() => {
          setSaving(true);
          void saveAndReload();
        }}
      >
        <RotateCw aria-hidden="true" className="size-icon-sm" />
        {saving ? t("appUpdate.saving") : t(unsaved ? "appUpdate.saveAndReload" : "appUpdate.reload")}
      </Button>
    </ShellBanner>
  );
}
