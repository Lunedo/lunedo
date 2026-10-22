import { Button, Notice } from "@lunedo/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { type BackupOverview, backupsQuery, instanceKeys } from "../api/instance-queries.js";
import { request } from "../api/request.js";
import { translateKey } from "../i18n/translate.js";
import { useOrganizationState } from "../shell/shell-context.js";
import { useSaveState } from "./auto-save.js";

const REFRESH_MS = 60_000;
const BACKUP_SETTINGS = "/settings/instance/backups";

function targetLocation(target: BackupOverview["target"]): string | null {
  if (!target) return null;
  return target.kind === "local" ? target.path : `s3://${target.bucket}/${target.prefix}`;
}

function RestoredBanner({ data, onSettings }: { data: BackupOverview; onSettings: boolean }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const tracker = useSaveState();
  const location = targetLocation(data.target);
  const confirm = async () => {
    await tracker.run(async () => {
      const saved = await request(() => api.POST("/api/v1/instance/backups/target/confirmation"));
      queryClient.setQueryData(instanceKeys.backups, saved);
    });
  };
  return (
    <div className="px-4 pt-3 md:px-8">
      <Notice
        variant="warning"
        title={t("backups.banner.restored.title")}
        action={
          onSettings ? (
            location ? (
              <Button variant="secondary" loading={tracker.state === "saving"} onClick={() => void confirm()}>
                {t("backups.banner.restored.confirm")}
              </Button>
            ) : null
          ) : (
            <Link to={BACKUP_SETTINGS} className="font-medium text-accent hover:underline">
              {t("backups.banner.open")}
            </Link>
          )
        }
      >
        <span className="block">{t("backups.banner.restored.body")}</span>
        {location ? (
          <span className="mt-1 block break-all">{t("backups.banner.restored.target", { location })}</span>
        ) : null}
        {onSettings ? <span className="mt-1 block">{t("backups.banner.restored.change")}</span> : null}
        {tracker.state === "error" && tracker.error ? (
          <span role="alert" className="mt-1 block text-danger">
            {tracker.error}
          </span>
        ) : null}
      </Notice>
    </div>
  );
}

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
  if (data.restoredAt) return <RestoredBanner data={data} onSettings={onSettings} />;
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
