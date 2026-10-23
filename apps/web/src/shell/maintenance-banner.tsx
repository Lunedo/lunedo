import { useTranslation } from "react-i18next";
import { useMaintenance } from "../api/maintenance.js";
import { ShellBanner } from "./shell-banner.js";

export function MaintenanceBanner() {
  const { t } = useTranslation();
  const maintenance = useMaintenance();
  if (!maintenance) return null;
  return (
    <ShellBanner variant="warning" role="status" title={t("maintenance.banner.title")}>
      {t("maintenance.banner.readOnly")}
      {maintenance.blockSignIn ? ` ${t("maintenance.banner.signInPaused")}` : null}
      {maintenance.message ? (
        <>
          {" "}
          <span className="font-medium">{t("maintenance.banner.message")}</span> {maintenance.message}
        </>
      ) : null}
    </ShellBanner>
  );
}
