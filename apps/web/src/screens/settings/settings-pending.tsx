import { Skeleton } from "@lunedo/ui";
import { useTranslation } from "react-i18next";
import { ContentPending } from "../../shell/navigation-pending.js";

const ENTRIES = ["w-2/3", "w-1/2", "w-3/4", "w-3/5", "w-1/2", "w-2/3"];

export function SettingsPending() {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 flex-1" data-settings-pending="">
      <div
        aria-hidden="true"
        className="hidden w-sidebar shrink-0 flex-col gap-3 border-r border-border bg-bg px-4 py-4 md:flex"
      >
        <Skeleton className="h-control-sm w-1/2" />
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="w-2/3" />
        {ENTRIES.map((width, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity besides their position
          <Skeleton key={index} className={`my-1 ${width}`} />
        ))}
      </div>
      <ContentPending label={t("navigation.loadingSettings")} />
    </div>
  );
}
