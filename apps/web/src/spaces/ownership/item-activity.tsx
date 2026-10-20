import { Section, Skeleton } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LoadError } from "../../errors/failure.js";
import { useFormat } from "../../preferences/preferences-provider.js";
import { type ActivityEntry, activityQuery } from "./ownership-queries.js";
import { StatusBadge } from "./page-status.js";

function Entry({ entry }: { entry: ActivityEntry }) {
  const { t } = useTranslation();
  const someone = t("ownership.someone");
  const actor = entry.actor ? (entry.actor.name ?? someone) : t("pageStatus.byImport");
  if (entry.type === "status") {
    return entry.status ? (
      <span className="inline-flex flex-wrap items-center gap-1">
        {t("pageStatus.activitySet", { actor })}
        <StatusBadge status={entry.status} />
      </span>
    ) : (
      <span>{t("pageStatus.activityRemoved", { actor })}</span>
    );
  }
  if (entry.type === "review") {
    return (
      <span>
        {entry.via === "published"
          ? t("reviews.activityPublished", { actor })
          : t("reviews.activityMarked", { actor })}
      </span>
    );
  }
  return (
    <span>
      {t("ownership.activityTransferred", {
        actor,
        from: entry.previousOwner ? (entry.previousOwner.name ?? someone) : t("ownership.nobody"),
        to: entry.owner ? (entry.owner.name ?? someone) : t("ownership.nobody"),
      })}
    </span>
  );
}

export function ItemActivity({ itemId, article = false }: { itemId: string; article?: boolean }) {
  const { t } = useTranslation();
  const format = useFormat();
  const activity = useQuery({ ...activityQuery(itemId), throwOnError: false });
  return (
    <Section title={article ? t("reviews.activityTitle") : t("ownership.activityTitle")} icon={Activity}>
      <div className="flex flex-col gap-2 p-4">
        {activity.isPending ? <Skeleton className="h-12 w-full" /> : null}
        {activity.isError ? (
          <LoadError
            what={t("ownership.activityFailed")}
            error={activity.error}
            onRetry={() => activity.refetch()}
          />
        ) : null}
        {activity.data?.length === 0 ? (
          <p className="text-sm text-text-muted">
            {article ? t("reviews.activityEmpty") : t("ownership.activityEmpty")}
          </p>
        ) : null}
        {activity.data && activity.data.length > 0 ? (
          <ul className="flex flex-col divide-y divide-border">
            {activity.data.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-col gap-1 py-2 text-sm sm:flex-row sm:items-center sm:gap-3"
              >
                <span className="min-w-0 flex-1">
                  <Entry entry={entry} />
                </span>
                <time dateTime={entry.at} className="text-text-muted tabular-nums">
                  {format.dateTime(entry.at)}
                </time>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Section>
  );
}
