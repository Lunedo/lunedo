import { Button, EmptyState, Notice, Skeleton } from "@lunedo/ui";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { UserRoundCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/client.js";
import { request } from "../../api/request.js";
import { LoadError } from "../../errors/failure.js";
import { itemHref } from "../item-paths.js";
import { TransferOwnerDialog } from "./owner-line.js";
import { ownershipKeys, type UnownedItem, type UnownedPage } from "./ownership-queries.js";

type Scope = { spaceId: string } | { organizationId: string };

function load(scope: Scope, cursor: string | null): Promise<UnownedPage> {
  const query = cursor ? { cursor } : {};
  return "spaceId" in scope
    ? request(() =>
        api.GET("/api/v1/spaces/{spaceId}/unowned-items", {
          params: { path: { spaceId: scope.spaceId }, query },
        }),
      )
    : request(() =>
        api.GET("/api/v1/organizations/{organizationId}/unowned-items", {
          params: { path: { organizationId: scope.organizationId }, query },
        }),
      );
}

export function UnownedItems({ scope, showSpace = false }: { scope: Scope; showSpace?: boolean }) {
  const { t } = useTranslation();
  const [assigning, setAssigning] = useState<UnownedItem | null>(null);
  const items = useInfiniteQuery({
    queryKey:
      "spaceId" in scope
        ? ownershipKeys.spaceUnowned(scope.spaceId)
        : ownershipKeys.organizationUnowned(scope.organizationId),
    queryFn: ({ pageParam }) => load(scope, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    throwOnError: false,
  });
  if (items.isPending) return <Skeleton className="h-card w-full" />;
  if (items.isError) {
    return (
      <LoadError what={t("ownership.unownedFailed")} error={items.error} onRetry={() => items.refetch()} />
    );
  }
  const list = items.data.pages.flatMap((page) => page.items);
  const hidden = items.data.pages[0]?.hidden ?? 0;
  return (
    <div className="flex flex-col gap-3">
      {hidden > 0 ? (
        <Notice variant="info" title={t("ownership.hiddenTitle", { count: hidden })}>
          {t("ownership.hiddenDescription")}
        </Notice>
      ) : null}
      {list.length === 0 ? (
        hidden > 0 ? null : (
          <EmptyState
            icon={UserRoundCheck}
            title={t("ownership.unownedEmptyTitle")}
            description={t("ownership.unownedEmpty")}
          />
        )
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {list.map((item) => {
            const href = itemHref(
              { id: item.id, kind: item.kind, title: item.title, link: null },
              item.spaceKey,
            );
            return (
              <li key={item.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
                <span className="flex min-w-0 flex-1 flex-col">
                  {href ? (
                    <Link
                      to={href}
                      className="truncate font-medium text-accent hover:underline focus-visible:focus-ring"
                      title={item.title}
                    >
                      {item.title}
                    </Link>
                  ) : (
                    <span className="truncate font-medium" title={item.title}>
                      {item.title}
                    </span>
                  )}
                  <span className="text-sm text-text-muted">
                    {showSpace ? `${item.spaceName} · ` : ""}
                    {item.reason === "deactivated"
                      ? t("ownership.reasonDeactivated", {
                          name: item.formerOwner?.name ?? t("ownership.someone"),
                        })
                      : item.reason === "membershipEnded"
                        ? t("ownership.reasonLeft", {
                            name: item.formerOwner?.name ?? t("ownership.someone"),
                          })
                        : t("ownership.reasonNone")}
                  </span>
                </span>
                <Button size="sm" variant="secondary" onClick={() => setAssigning(item)}>
                  {t("ownership.assign")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {items.hasNextPage ? (
        <Button
          variant="secondary"
          className="self-start"
          loading={items.isFetchingNextPage}
          onClick={() => void items.fetchNextPage()}
        >
          {t("ownership.showMore")}
        </Button>
      ) : null}
      {assigning ? (
        <TransferOwnerDialog
          item={{ id: assigning.id, spaceId: assigning.spaceId, title: assigning.title }}
          currentOwner={null}
          onClose={() => setAssigning(null)}
          onDone={() => items.refetch().then(() => undefined)}
        />
      ) : null}
    </div>
  );
}
