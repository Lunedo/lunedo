import { Skeleton } from "@pagehall/ui";
import { useQuery } from "@tanstack/react-query";
import { HardDrive } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { LoadError } from "../errors/failure.js";
import { useFormat } from "../preferences/preferences-provider.js";

export function StorageUsage({ scope }: { scope: { spaceId: string } | { organizationId: string } }) {
  const { t } = useTranslation();
  const format = useFormat();
  const usage = useQuery({
    queryKey: ["storage", scope],
    queryFn: () =>
      "spaceId" in scope
        ? request(() =>
            api.GET("/api/v1/spaces/{spaceId}/storage", { params: { path: { spaceId: scope.spaceId } } }),
          )
        : request(() =>
            api.GET("/api/v1/organizations/{organizationId}/storage", {
              params: { path: { organizationId: scope.organizationId } },
            }),
          ),
    throwOnError: false,
  });
  if (usage.isPending) return <Skeleton className="h-6 w-1/2" />;
  if (usage.isError) {
    return (
      <LoadError what={t("files.storage.loadFailed")} error={usage.error} onRetry={() => usage.refetch()} />
    );
  }
  return (
    <p className="flex items-center gap-2">
      <HardDrive aria-hidden="true" className="size-icon text-text-muted" />
      <span className="tabular-nums">
        {t("files.storage.used", { size: format.bytes(usage.data.bytes), count: usage.data.files })}
      </span>
    </p>
  );
}
