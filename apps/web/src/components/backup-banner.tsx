import { Notice } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { backupsQuery } from "../api/instance-queries.js";
import { translateKey } from "../i18n/translate.js";
import { useOrganizationState } from "../shell/shell-context.js";

const REFRESH_MS = 60_000;
const BACKUP_SETTINGS = "/settings/instance/backups";

export function BackupBanner() {
  const { t } = useTranslation();
  const allowed = useOrganizationState().can("instance.operations.manage");
  const onSettings = useLocation({ select: (location) => location.pathname === BACKUP_SETTINGS });
  const status = useQuery({
    ...backupsQuery,
    enabled: allowed,
    throwOnError: false,
    retry: false,
    refetchInterval: REFRESH_MS,
  });
  const data = status.data;
  if (!allowed || !data) return null;
  const kind = data.alert !== "none" ? data.alert : data.warning;
  if (!kind) return null;
  return (
    <div className="px-4 pt-3 md:px-8">
      <Notice
        variant={kind === "failing" ? "danger" : "warning"}
        title={translateKey(t, `backups.banner.${kind}.title`)}
        {...(onSettings
          ? {}
          : {
              action: (
                <Link to={BACKUP_SETTINGS} className="font-medium text-accent hover:underline">
                  {t("backups.banner.open")}
                </Link>
              ),
            })}
      >
        {translateKey(t, `backups.banner.${kind}.body`, { count: data.settings.missingDays })}
      </Notice>
    </div>
  );
}
