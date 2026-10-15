import { Notice } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { storageQuery } from "../api/instance-queries.js";
import { translateKey } from "../i18n/translate.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { useOrganizationState } from "../shell/shell-context.js";

const REFRESH_MS = 60_000;

export function StorageBanner() {
  const { t } = useTranslation();
  const format = useFormat();
  const allowed = useOrganizationState().can("instance.settings.view");
  const status = useQuery({
    ...storageQuery,
    enabled: allowed,
    throwOnError: false,
    retry: false,
    refetchInterval: REFRESH_MS,
  });
  const data = status.data;
  if (!allowed || !data || data.level === 0) return null;
  const level = data.level === 3 ? 3 : data.level === 2 ? 2 : 1;
  return (
    <div className="px-4 pt-3 md:px-8">
      <Notice
        variant={level === 3 ? "danger" : "warning"}
        title={translateKey(t, `storage.banner.${level}.title`)}
        action={
          <Link to="/settings/instance/storage" className="font-medium text-accent hover:underline">
            {t("storage.banner.open")}
          </Link>
        }
      >
        {translateKey(t, `storage.banner.${level}.body`, {
          percent: format.percent((data.percent ?? 0) / 100),
        })}
      </Notice>
    </div>
  );
}
