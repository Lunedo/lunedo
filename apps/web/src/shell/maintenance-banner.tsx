import { Notice } from "@lunedo/ui";
import { useTranslation } from "react-i18next";
import { useMaintenance } from "../api/maintenance.js";

export function MaintenanceBanner() {
  const { t } = useTranslation();
  const maintenance = useMaintenance();
  if (!maintenance) return null;
  return (
    <div className="px-4 pt-3" role="status">
      <Notice variant="warning" title={t("maintenance.banner.title")}>
        <p>{t("maintenance.banner.readOnly")}</p>
        {maintenance.blockSignIn ? <p>{t("maintenance.banner.signInPaused")}</p> : null}
        {maintenance.message ? (
          <p>
            <span className="font-medium">{t("maintenance.banner.message")}</span> {maintenance.message}
          </p>
        ) : null}
      </Notice>
    </div>
  );
}
