import { CopyButton, Input } from "@pagehall/ui";
import { useId } from "react";
import { useTranslation } from "react-i18next";

export function FolderPath({ path }: { path: string }) {
  const { t } = useTranslation();
  const hintId = useId();
  const label = t("imports.folder.path");
  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium">{label}</span>
      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
        <Input readOnly value={path} aria-label={label} aria-describedby={hintId} className="font-mono" />
        <CopyButton value={path} />
      </div>
      <span id={hintId} className="text-sm text-text-muted">
        {t("imports.folder.pathHint")}
      </span>
    </div>
  );
}
