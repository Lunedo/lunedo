import { Button, List, ListRow, Section, Skeleton } from "@pagehall/ui";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.js";
import { request } from "../api/request.js";
import { LoadError } from "../errors/failure.js";
import { describeUserAgent } from "../format/user-agent.js";
import { useFormat } from "../preferences/preferences-provider.js";
import { type AuditItem, actionLabel } from "./audit-presentation.js";

export function SecurityActivitySection({ accountId }: { accountId: string }) {
  const { t } = useTranslation();
  const format = useFormat();
  const activity = useInfiniteQuery({
    queryKey: ["account", "securityActivity", accountId],
    initialPageParam: null as string | null,
    throwOnError: false,
    queryFn: ({ pageParam }) =>
      request(() =>
        api.GET("/api/v1/accounts/{accountId}/security-activity", {
          params: { path: { accountId }, query: { limit: 20, ...(pageParam ? { cursor: pageParam } : {}) } },
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? null,
  });
  const items = (activity.data?.pages.flatMap((page) => page.items) ?? []) as AuditItem[];

  const details = (item: AuditItem) => {
    const client = item.userAgent ? describeUserAgent(item.userAgent) : null;
    const browser = client
      ? [client.browser, client.system].filter(Boolean).join(t("security.activity.on"))
      : null;
    return [format.dateTime(item.occurredAt), browser, item.clientIp].filter(Boolean).join(" · ");
  };

  return (
    <Section title={t("security.activity.title")}>
      {activity.isPending ? <Skeleton className="m-4 h-12" /> : null}
      {activity.isError ? (
        <div className="p-4">
          <LoadError
            what={t("failures.loadSecurityActivity")}
            error={activity.error}
            onRetry={() => activity.refetch()}
          />
        </div>
      ) : null}
      {activity.isSuccess && items.length === 0 ? (
        <p className="p-4 text-text-muted">{t("security.activity.none")}</p>
      ) : null}
      {items.length > 0 ? (
        <List label={t("security.activity.title")}>
          {items.map((item) => (
            <ListRow key={item.id} title={actionLabel(t, item)} description={details(item)} />
          ))}
        </List>
      ) : null}
      {activity.hasNextPage ? (
        <div className="p-4">
          <Button
            variant="secondary"
            size="sm"
            loading={activity.isFetchingNextPage}
            onClick={() => void activity.fetchNextPage()}
          >
            {t("security.activity.more")}
          </Button>
        </div>
      ) : null}
    </Section>
  );
}
